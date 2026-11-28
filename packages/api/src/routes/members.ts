import { audit } from "../services/audit";
import { assertSeatQuota } from "../billing/service";
import {
  appRoleOf,
  baseRoleForPermissions,
  holdsAll,
  memberCreate,
  memberUpdate,
  normalizePermissions,
  ORG_ROLE_FOR,
  permissionsOf,
  permissionsOfAppRole,
  type AppRole,
  type Permission,
} from "@pinwren/core";
import { customRole, getDb, invitation, member, user } from "@pinwren/db";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import { getAuth, resetPasswordUrl } from "../auth";
import { requireInstanceAdmin, type SessionVars } from "../context";
import { ApiError, notFound } from "../errors";
import { hasFeature } from "../license";
import { accessOf, requirePermission } from "../permissions";
import { assertCustomRolesEntitled, escalation, getRole, resolveAccess } from "../services/custom-roles";
import { isAdminRole, memberChangeVerdict } from "../services/workspace";

// Users (BugPin model, wave-5 contract §3.1): Admins add accounts directly (name, email, password, role),
// change roles and remove people; invitations by email stay the second option (Better Auth's endpoints).
// Mounted after the dashboard router, so its session and viewer guards have already run.

/** An admin-made reset link works longer than an emailed one: it travels through chat or a call. */
const ADMIN_RESET_HOURS = 24;

const memberRow = {
  id: user.id,
  userId: user.id,
  memberId: member.id,
  name: user.name,
  email: user.email,
  image: user.image,
  role: member.role,
  customRoleId: member.customRoleId,
  customRoleName: customRole.name,
  createdAt: member.createdAt,
};

async function membership(orgId: string, userId: string) {
  const [m] = await getDb()
    .select({ id: member.id, role: member.role, customRoleId: member.customRoleId })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)));
  return m ?? null;
}

/** What the target can do today (custom role included), so nobody edits or removes someone above them. */
async function permissionsOfMember(orgId: string, target: { role: string; customRoleId: string | null }) {
  const access = await resolveAccess(orgId, target.customRoleId, target.role);
  return permissionsOf(access);
}

/** The custom role an assignment names: it must exist here, and the actor must hold everything it grants. */
async function assignableRole(c: { var: { orgId: string } } & Parameters<typeof accessOf>[0], id: string) {
  await assertCustomRolesEntitled();
  const role = await getRole(c.var.orgId, id);
  if (!role) throw new ApiError(400, "ROLE_NOT_FOUND", "That role doesn't exist in this workspace");
  const permissions: Permission[] = normalizePermissions(role.permissions);
  if (!holdsAll(accessOf(c), permissions)) throw escalation();
  return { role, permissions };
}

/** A member row as the API returns it. */
const withApp = <R extends { role: string }>(r: R) => ({ ...r, appRole: appRoleOf(r.role) });

async function adminCount(orgId: string) {
  const rows = await getDb()
    .select({ role: member.role })
    .from(member)
    .where(eq(member.organizationId, orgId));
  return rows.filter((r) => isAdminRole(r.role)).length;
}

function assertChange(v: ReturnType<typeof memberChangeVerdict>) {
  if (!v.ok) throw new ApiError(400, v.code, v.message);
}

export const members = new Hono<{ Variables: SessionVars }>()
  /** Everyone in the workspace (every role: assignee pickers, mentions). `id` is the user id. */
  .get("/members", async (c) => {
    const rows = await getDb()
      .select(memberRow)
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .leftJoin(
        customRole,
        and(eq(customRole.id, member.customRoleId), eq(customRole.orgId, member.organizationId)),
      )
      .where(eq(member.organizationId, c.var.orgId))
      .orderBy(asc(user.name));
    // Without the licence feature a custom role isn't in force, so it isn't shown as the member's role.
    const entitled = await hasFeature("custom_roles");
    return c.json({
      members: rows.map((r) => withApp(entitled ? r : { ...r, customRoleId: null, customRoleName: null })),
    });
  })

  /** Pending, unexpired invitations of the active organisation. Create/cancel via Better Auth. */
  .get("/invitations", async (c) => {
    const rows = await getDb()
      .select({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt,
        inviter: { id: user.id, name: user.name, email: user.email },
      })
      .from(invitation)
      .leftJoin(user, eq(user.id, invitation.inviterId))
      .where(
        and(
          eq(invitation.organizationId, c.var.orgId),
          eq(invitation.status, "pending"),
          gt(invitation.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(invitation.createdAt));
    return c.json({
      invitations: rows.map((r) => ({ ...r, appRole: appRoleOf(r.role ?? "member") })),
    });
  })

  /**
   * Users › Add User: create the account (verified, with the password the Admin chose) and add it to this
   * workspace. Goes through Better Auth's internal adapter, so its hooks run and the caller's session is
   * untouched; sign-up policy doesn't apply (an Admin is vouching for the person).
   */
  .post("/members", requirePermission("users.manage"), zValidator("json", memberCreate), async (c) => {
    const body = c.req.valid("json");
    const email = body.email.trim().toLowerCase();
    // Never hand out more than you hold: a custom `users.manage` holder can't add an Admin.
    let custom: Awaited<ReturnType<typeof assignableRole>> | null = null;
    if (body.customRoleId) custom = await assignableRole(c, body.customRoleId);
    else if (!holdsAll(accessOf(c), permissionsOfAppRole(body.role))) throw escalation();
    const baseRole: AppRole = custom ? baseRoleForPermissions(custom.permissions) : body.role;
    await assertSeatQuota(getDb(), c.var.orgId);
    const ctx = await getAuth().$context;
    if (await ctx.internalAdapter.findUserByEmail(email)) {
      throw new ApiError(409, "EMAIL_TAKEN", "An account with that email already exists. Invite it instead.");
    }
    let created: { id: string; name: string; email: string };
    try {
      const u = await ctx.internalAdapter.createUser(
        { email, name: body.name, emailVerified: true },
        { method: "admin" },
      );
      created = u;
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } };
      if ((e.cause?.code ?? e.code) === "23505") {
        throw new ApiError(
          409,
          "EMAIL_TAKEN",
          "An account with that email already exists. Invite it instead.",
        );
      }
      throw err;
    }
    await ctx.internalAdapter.linkAccount({
      providerId: "credential",
      accountId: created.id,
      userId: created.id,
      password: await ctx.password.hash(body.password),
    });
    const [m] = await getDb()
      .insert(member)
      .values({
        id: crypto.randomUUID(),
        organizationId: c.var.orgId,
        userId: created.id,
        role: ORG_ROLE_FOR[baseRole],
        customRoleId: custom?.role.id ?? null,
      })
      .returning({ id: member.id, createdAt: member.createdAt });
    if (!m) throw new Error("member insert failed");
    await audit(
      c,
      "member.created",
      { type: "member", id: created.id },
      { email, role: baseRole, ...(custom && { customRole: custom.role.name }) },
    );
    return c.json(
      {
        member: {
          id: m.id,
          userId: created.id,
          name: created.name,
          email: created.email,
          appRole: baseRole,
          customRoleId: custom?.role.id ?? null,
          customRoleName: custom?.role.name ?? null,
          createdAt: m.createdAt,
        },
      },
      201,
    );
  })

  /**
   * Change someone's role: a built-in one, or a custom role (F-093). Not your own, never the owner's, never the
   * last Admin's, and never above yourself: you must hold the new role's permissions and the target's current
   * ones (a custom `users.manage` holder can't demote an Admin or mint one).
   */
  .patch(
    "/members/:userId",
    requirePermission("users.manage"),
    zValidator("json", memberUpdate),
    async (c) => {
      const userId = c.req.param("userId");
      const body = c.req.valid("json");
      const target = await membership(c.var.orgId, userId);
      if (!target) throw notFound("Member");
      const custom = "customRoleId" in body ? await assignableRole(c, body.customRoleId) : null;
      const nextRole: AppRole = custom
        ? baseRoleForPermissions(custom.permissions)
        : "role" in body
          ? body.role
          : "viewer";
      assertChange(
        memberChangeVerdict({
          actorId: c.var.userId,
          target: { userId, role: target.role },
          adminCount: await adminCount(c.var.orgId),
          nextRole,
        }),
      );
      const actor = accessOf(c);
      if (
        !holdsAll(actor, await permissionsOfMember(c.var.orgId, target)) ||
        (!custom && !holdsAll(actor, permissionsOfAppRole(nextRole)))
      ) {
        throw escalation();
      }
      const [from] = await getDb()
        .select({ name: customRole.name })
        .from(customRole)
        .where(eq(customRole.id, target.customRoleId ?? "00000000-0000-0000-0000-000000000000"));
      await getDb()
        .update(member)
        .set({ role: ORG_ROLE_FOR[nextRole], customRoleId: custom?.role.id ?? null })
        .where(eq(member.id, target.id));
      if (custom) {
        await audit(
          c,
          "member.custom_role_assigned",
          { type: "member", id: userId },
          { from: from?.name ?? appRoleOf(target.role), to: custom.role.name, roleId: custom.role.id },
        );
      } else {
        await audit(
          c,
          "member.role_changed",
          { type: "member", id: userId },
          { from: from?.name ?? appRoleOf(target.role), to: nextRole },
        );
      }
      const [row] = await getDb()
        .select(memberRow)
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .leftJoin(
          customRole,
          and(eq(customRole.id, member.customRoleId), eq(customRole.orgId, member.organizationId)),
        )
        .where(eq(member.id, target.id));
      if (!row) throw notFound("Member");
      return c.json({ member: withApp(row) });
    },
  )

  /** Remove someone from the workspace (their account stays; their comments keep their name). */
  .delete("/members/:userId", requirePermission("users.manage"), async (c) => {
    const userId = c.req.param("userId");
    const target = await membership(c.var.orgId, userId);
    if (!target) throw notFound("Member");
    assertChange(
      memberChangeVerdict({
        actorId: c.var.userId,
        target: { userId, role: target.role },
        adminCount: await adminCount(c.var.orgId),
        nextRole: null,
      }),
    );
    if (!holdsAll(accessOf(c), await permissionsOfMember(c.var.orgId, target))) throw escalation();
    await getDb().delete(member).where(eq(member.id, target.id));
    await audit(c, "member.removed", { type: "member", id: userId }, { role: appRoleOf(target.role) });
    return c.body(null, 204);
  })

  /**
   * A password-reset link for a member, for servers without SMTP (the instance admin sends it themselves).
   * Better Auth's own reset token, so `/reset-password` and its checks treat it like an emailed one.
   */
  .post("/members/:userId/reset-link", requireInstanceAdmin, async (c) => {
    const userId = c.req.param("userId");
    if (!(await membership(c.var.orgId, userId))) throw notFound("Member");
    const ctx = await getAuth().$context;
    const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
    const expiresAt = new Date(Date.now() + ADMIN_RESET_HOURS * 3600 * 1000);
    await ctx.internalAdapter.createVerificationValue({
      value: userId,
      identifier: `reset-password:${token}`,
      expiresAt,
    });
    return c.json({ url: resetPasswordUrl(token), expiresAt: expiresAt.toISOString() });
  });
