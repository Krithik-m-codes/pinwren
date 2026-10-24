import { getDb, member, organization, user } from "@pinwren/db";
import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireInstanceAdmin, type SessionVars } from "../context";
import { ApiError, notFound } from "../errors";
import { requirePermission } from "../permissions";
import {
  addInstanceAdmin,
  claimedAdminIds,
  listedAdminUsers,
  listedEmails,
  removeInstanceAdmin,
} from "../services/setup";
import { deleteWorkspace, isOwnerRole } from "../services/workspace";

// Settings › Workspace (wave-5 §3.1): rename, transfer ownership, delete. Leaving uses Better Auth's own
// `organization.leave` (it refuses the only owner). Plus Settings › Security › Instance administrators.
// Mounted after the dashboard router, so its session and viewer guards have already run.

const workspaceRename = z.object({ name: z.string().trim().min(1, "Name the workspace").max(80) });
const ownershipTransfer = z.object({ userId: z.string().min(1).max(64) });
const workspaceDelete = z.object({ confirm: z.string().max(200) });
const instanceAdminAdd = z.object({ userId: z.string().min(1).max(64) });

const requireOwner = async (orgId: string, userId: string) => {
  const [m] = await getDb()
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)));
  if (!m || !isOwnerRole(m.role)) {
    throw new ApiError(403, "OWNER_REQUIRED", "Only the workspace owner can do this");
  }
};

const ADMIN_CHANGE_ERRORS = {
  unknown_user: [404, "NOT_FOUND", "Account not found"],
  env_locked: [409, "ENV_LOCKED", "Listed in PINWREN_ADMIN_EMAILS: change it in the server's environment"],
  last_admin: [400, "LAST_ADMIN", "The instance needs at least one administrator"],
  not_admin: [404, "NOT_FOUND", "Not an instance administrator"],
} as const;

function assertAdminChange(result: keyof typeof ADMIN_CHANGE_ERRORS | "ok") {
  if (result === "ok") return;
  const [status, code, message] = ADMIN_CHANGE_ERRORS[result];
  throw new ApiError(status, code, message);
}

export const workspace = new Hono<{ Variables: SessionVars }>()
  .patch(
    "/workspace",
    requirePermission("settings.manage"),
    zValidator("json", workspaceRename),
    async (c) => {
      const [org] = await getDb()
        .update(organization)
        .set({ name: c.req.valid("json").name })
        .where(eq(organization.id, c.var.orgId))
        .returning({ id: organization.id, name: organization.name });
      if (!org) throw notFound("Workspace");
      return c.json({ workspace: org });
    },
  )

  /** The owner hands the workspace to another member, who becomes owner; the old owner stays an Admin. */
  .post("/workspace/transfer", zValidator("json", ownershipTransfer), async (c) => {
    await requireOwner(c.var.orgId, c.var.userId);
    const { userId } = c.req.valid("json");
    if (userId === c.var.userId) throw new ApiError(400, "OWN_ROLE", "You already own this workspace");
    const db = getDb();
    await db.transaction(async (tx) => {
      const [target] = await tx
        .update(member)
        .set({ role: "owner" })
        .where(and(eq(member.organizationId, c.var.orgId), eq(member.userId, userId)))
        .returning({ id: member.id });
      if (!target) throw notFound("Member");
      await tx
        .update(member)
        .set({ role: "admin" })
        .where(and(eq(member.organizationId, c.var.orgId), eq(member.userId, c.var.userId)));
    });
    return c.json({ ownerId: userId });
  })

  /** Delete the workspace with everything in it. The owner types its name to confirm. */
  .delete("/workspace", zValidator("json", workspaceDelete), async (c) => {
    await requireOwner(c.var.orgId, c.var.userId);
    const [org] = await getDb()
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, c.var.orgId));
    if (!org) throw notFound("Workspace");
    if (c.req.valid("json").confirm.trim() !== org.name.trim()) {
      throw new ApiError(400, "CONFIRM_MISMATCH", "Type the workspace name exactly to delete it");
    }
    await deleteWorkspace(c.var.orgId);
    return c.body(null, 204);
  })

  // --- Instance administrators (Settings › Security) -----------------------------------------------
  .get("/admin/instance-admins", requireInstanceAdmin, async (c) => {
    const [claimed, listed] = await Promise.all([claimedAdminIds(), listedAdminUsers()]);
    const claimedUsers = claimed.length
      ? await getDb()
          .select({ id: user.id, name: user.name, email: user.email })
          .from(user)
          .where(inArray(user.id, claimed))
      : [];
    const listedIds = new Set(listed.map((u) => u.id));
    const signedUp = new Set(listed.map((u) => u.email.toLowerCase()));
    return c.json({
      admins: [
        ...listed.map((u) => ({ ...u, source: "env" as const })),
        ...claimedUsers
          .filter((u) => !listedIds.has(u.id))
          .map((u) => ({ ...u, source: "dashboard" as const })),
      ],
      // Listed addresses with no account yet: they become admins when they sign up.
      pendingEmails: listedEmails().filter((e) => !signedUp.has(e)),
    });
  })

  .post("/admin/instance-admins", requireInstanceAdmin, zValidator("json", instanceAdminAdd), async (c) => {
    assertAdminChange(await addInstanceAdmin(c.req.valid("json").userId, c.var.userId));
    return c.json({ ok: true }, 201);
  })

  .delete("/admin/instance-admins/:userId", requireInstanceAdmin, async (c) => {
    assertAdminChange(await removeInstanceAdmin(c.req.param("userId"), c.var.userId));
    return c.body(null, 204);
  });
