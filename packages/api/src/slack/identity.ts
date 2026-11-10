import { getDb, member, slackUserLink, user, withOrg } from "@pinwren/db";
import { and, eq } from "drizzle-orm";
import { verifiedMemberByEmail } from "../db/identity";
import type { SlackApi } from "./client";
import type { SlackWorkspaceRow } from "./workspace";

// Slack user -> Pinwren member. A mapping is made once, by verified email (Slack confirms workspace emails,
// and the Pinwren account's email must be confirmed too), and stored. A Slack user that can't be matched
// gets a "link your account" message instead of any access; guests, bots and deactivated users never map.

export type SlackActor = { userId: string; role: string; name: string };

export type ActorResult =
  | { ok: true; actor: SlackActor }
  | { ok: false; reason: "unlinked" | "no_email" | "not_allowed" | "lookup_failed"; email?: string };

type Ws = Pick<SlackWorkspaceRow, "id" | "orgId">;

/** The member mapped to `slackUserId` in this workspace, if the mapping and the membership still stand. */
async function linkedActor(ws: Ws, slackUserId: string): Promise<SlackActor | null> {
  return withOrg(ws.orgId, async () => {
    const db = getDb();
    const [row] = await db
      .select({ linkId: slackUserLink.id, userId: user.id, name: user.name, role: member.role })
      .from(slackUserLink)
      .innerJoin(user, eq(user.id, slackUserLink.userId))
      .leftJoin(member, and(eq(member.userId, user.id), eq(member.organizationId, ws.orgId)))
      .where(
        and(
          eq(slackUserLink.workspaceId, ws.id),
          eq(slackUserLink.orgId, ws.orgId),
          eq(slackUserLink.slackUserId, slackUserId),
        ),
      );
    if (!row) return null;
    if (!row.role) {
      // Removed from the workspace since: the mapping goes with the membership.
      await db.delete(slackUserLink).where(eq(slackUserLink.id, row.linkId));
      return null;
    }
    return { userId: row.userId, role: row.role, name: row.name };
  });
}

/** The member of this organisation whose confirmed email is `email`. */
export async function memberByEmail(orgId: string, email: string): Promise<SlackActor | null> {
  return (await verifiedMemberByEmail(orgId, email)) ?? null;
}

/** Store a mapping; an existing one for that Slack user is kept (first writer wins, races are harmless). */
export async function saveLink(
  ws: Ws,
  slackUserId: string,
  userId: string,
  source: "email" | "manual",
): Promise<void> {
  await withOrg(ws.orgId, async (db) => {
    const insert = db
      .insert(slackUserLink)
      .values({ orgId: ws.orgId, workspaceId: ws.id, slackUserId, userId, source });
    const target = [slackUserLink.workspaceId, slackUserLink.slackUserId];
    // An explicit, signed-in confirmation replaces an email guess; an email match never overrides one.
    await (source === "manual"
      ? insert.onConflictDoUpdate({ target, set: { userId, source } })
      : insert.onConflictDoNothing({ target }));
  });
}

/**
 * Who is this Slack user in Pinwren? Mapped members come straight from the database; a first-time user is
 * looked up in Slack (`users.info`) and matched by email.
 */
export async function resolveActor(ws: Ws, slackUserId: string, api: SlackApi): Promise<ActorResult> {
  const known = await linkedActor(ws, slackUserId);
  if (known) return { ok: true, actor: known };
  const info = await api.userInfo(slackUserId);
  if (!info.ok) return { ok: false, reason: "lookup_failed" };
  const u = info.data;
  if (u.isBot || u.isRestricted || u.deleted) return { ok: false, reason: "not_allowed" };
  if (!u.email) return { ok: false, reason: "no_email" };
  const found = await memberByEmail(ws.orgId, u.email);
  if (!found) return { ok: false, reason: "unlinked", email: u.email };
  await saveLink(ws, slackUserId, found.userId, "email");
  return { ok: true, actor: found };
}
