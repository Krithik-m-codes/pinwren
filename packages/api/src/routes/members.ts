import { assertSeatQuota } from "../billing/service";
import { appRoleOf, memberCreate, memberUpdate, ORG_ROLE_FOR } from "@pinwren/core";
import { getDb, invitation, member, user } from "@pinwren/db";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import { getAuth, resetPasswordUrl } from "../auth";
import { requireInstanceAdmin, type SessionVars } from "../context";
import { ApiError, notFound } from "../errors";
import { requirePermission } from "../permissions";
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
  createdAt: member.createdAt,
};

async function membership(orgId: string, userId: string) {
  const [m] = await getDb()
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)));
  return m ?? null;
}

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
      .where(eq(member.organizationId, c.var.orgId))
      .orderBy(asc(user.name));
    return c.json({ members: rows.map((r) => ({ ...r, appRole: appRoleOf(r.role) })) });
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
        role: ORG_ROLE_FOR[body.role],
      })
      .returning({ id: member.id, createdAt: member.createdAt });
    if (!m) throw new Error("member insert failed");
    return c.json(
      {
        member: {
          id: m.id,
          userId: created.id,
          name: created.name,
          email: created.email,
          appRole: body.role,
          createdAt: m.createdAt,
        },
      },
      201,
    );
  })

  /** Change someone's role (not your own, never the owner's, never the last Admin's). */
  .patch(
    "/members/:userId",
    requirePermission("users.manage"),
    zValidator("json", memberUpdate),
    async (c) => {
      const userId = c.req.param("userId");
      const { role } = c.req.valid("json");
      const target = await membership(c.var.orgId, userId);
      if (!target) throw notFound("Member");
      assertChange(
        memberChangeVerdict({
          actorId: c.var.userId,
          target: { userId, role: target.role },
          adminCount: await adminCount(c.var.orgId),
          nextRole: role,
        }),
      );
      await getDb().update(member).set({ role: ORG_ROLE_FOR[role] }).where(eq(member.id, target.id));
      const [row] = await getDb()
        .select(memberRow)
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(eq(member.id, target.id));
      if (!row) throw notFound("Member");
      return c.json({ member: { ...row, appRole: appRoleOf(row.role) } });
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
    await getDb().delete(member).where(eq(member.id, target.id));
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
