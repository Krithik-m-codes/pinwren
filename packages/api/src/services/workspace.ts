import { brandAsset, feedbackAsset, getDb, member, orgSetting, organization } from "@pinwren/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { storage } from "../storage";

// Workspace (Better Auth organisation) lifecycle that the dashboard needs beyond Better Auth's own
// endpoints: deleting one with its stored files, and the ownership rules account deletion and the
// Users page share.

export const isOwnerRole = (role: string) => role.split(",").some((r) => r.trim() === "owner");
export const isAdminRole = (role: string) =>
  role.split(",").some((r) => r.trim() === "owner" || r.trim() === "admin");

/**
 * Delete a workspace: every row goes with the organisation (`on delete cascade` from projects down to
 * comments, assets, webhooks, settings…), then the files those rows pointed at. Files go after the rows:
 * a crash in between leaves an orphan file, never a row pointing at nothing.
 */
export async function deleteWorkspace(orgId: string): Promise<boolean> {
  const db = getDb();
  const [assets, logos, exports] = await Promise.all([
    db.select({ key: feedbackAsset.storageKey }).from(feedbackAsset).where(eq(feedbackAsset.orgId, orgId)),
    db.select({ key: brandAsset.storageKey }).from(brandAsset).where(eq(brandAsset.orgId, orgId)),
    // Project exports keep their file's key in the export state (org_setting).
    db
      .select({ key: sql<string | null>`${orgSetting.value}->>'storageKey'` })
      .from(orgSetting)
      .where(and(eq(orgSetting.orgId, orgId), sql`${orgSetting.value} ? 'storageKey'`)),
  ]);
  const deleted = await db
    .delete(organization)
    .where(eq(organization.id, orgId))
    .returning({ id: organization.id });
  if (!deleted.length) return false;
  for (const { key } of [...assets, ...logos, ...exports]) {
    if (!key) continue;
    await storage()
      .remove(key)
      .catch((err: unknown) => console.warn(`[pinwren] could not remove file ${key}`, err));
  }
  return true;
}

export type OwnedWorkspace = { orgId: string; name: string; owners: number; members: number };

/** The workspaces `userId` owns, with how many owners and members each has. */
export async function ownedWorkspaces(userId: string): Promise<OwnedWorkspace[]> {
  const db = getDb();
  const mine = await db
    .select({ orgId: member.organizationId, name: organization.name, role: member.role })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId));
  const owned = mine.filter((m) => isOwnerRole(m.role));
  if (!owned.length) return [];
  const all = await db
    .select({ orgId: member.organizationId, role: member.role })
    .from(member)
    .where(
      inArray(
        member.organizationId,
        owned.map((o) => o.orgId),
      ),
    );
  return owned.map((o) => {
    const rows = all.filter((r) => r.orgId === o.orgId);
    return {
      orgId: o.orgId,
      name: o.name,
      owners: rows.filter((r) => isOwnerRole(r.role)).length,
      members: rows.length,
    };
  });
}

/**
 * Account deletion (pure rule): a workspace the person alone owns blocks it while anyone else is in it
 * (transfer ownership first); one where they are the only member is deleted with the account.
 */
export function accountDeletionPlan(owned: readonly OwnedWorkspace[]): {
  blockedBy: string[];
  deleteWith: string[];
} {
  const sole = owned.filter((o) => o.owners === 1);
  return {
    blockedBy: sole.filter((o) => o.members > 1).map((o) => o.name),
    deleteWith: sole.filter((o) => o.members === 1).map((o) => o.orgId),
  };
}

export type MemberChange = { ok: true } | { ok: false; code: string; message: string };

/**
 * Users page rules (pure): the owner can't be demoted or removed, nobody changes or removes themselves
 * here (Leave workspace does that), and the last Admin stays one.
 */
export function memberChangeVerdict(o: {
  actorId: string;
  target: { userId: string; role: string };
  /** Admins (owner or admin) in the workspace, the target included. */
  adminCount: number;
  /** The new role, or null when removing. */
  nextRole: "admin" | "editor" | "viewer" | null;
}): MemberChange {
  if (o.target.userId === o.actorId) {
    return {
      ok: false,
      code: "OWN_ROLE",
      message:
        o.nextRole === null
          ? "Use Leave workspace to remove yourself"
          : "Another Admin has to change your role",
    };
  }
  if (isOwnerRole(o.target.role)) {
    return {
      ok: false,
      code: "OWNER_LOCKED",
      message: "The workspace owner can't be demoted or removed. Transfer ownership first.",
    };
  }
  const losesAdmin = isAdminRole(o.target.role) && o.nextRole !== "admin";
  if (losesAdmin && o.adminCount <= 1) {
    return { ok: false, code: "LAST_ADMIN", message: "A workspace needs at least one Admin" };
  }
  return { ok: true };
}
