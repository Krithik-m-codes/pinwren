import { getDb, slackWorkspace, withOrg } from "@pinwren/db";
import { and, eq } from "drizzle-orm";
import { decryptSecret } from "../crypto";
import { slackClient, type SlackApi } from "./client";

export type SlackWorkspaceRow = typeof slackWorkspace.$inferSelect;

/** Test seam: the Slack client for a bot token. Production uses the guarded fetch. */
export type SlackApiFactory = (token: string) => SlackApi;
let factory: SlackApiFactory = (token) => slackClient(token);
export const setSlackApiFactory = (f: SlackApiFactory | null) => {
  factory = f ?? ((token) => slackClient(token));
};

/** A client for a bot token that isn't stored yet (the settings form checks it before saving). */
export const slackApiForToken = (token: string): SlackApi => factory(token);

/** The API client for a stored workspace; null when its token can't be decrypted (PINWREN_SECRET changed). */
export function slackApiFor(ws: Pick<SlackWorkspaceRow, "botToken">): SlackApi | null {
  try {
    return factory(decryptSecret(ws.botToken));
  } catch {
    return null;
  }
}

/** The organisation's Slack workspace, if connected. */
export async function workspaceOfOrg(orgId: string): Promise<SlackWorkspaceRow | null> {
  return withOrg(orgId, async () => {
    const [ws] = await getDb().select().from(slackWorkspace).where(eq(slackWorkspace.orgId, orgId));
    return ws ?? null;
  });
}

/** Is an active Slack app connected? Cheap enough to ask for every event (runs inside the event's scope). */
export async function slackConnected(orgId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: slackWorkspace.id })
    .from(slackWorkspace)
    .where(and(eq(slackWorkspace.orgId, orgId), eq(slackWorkspace.active, true)))
    .limit(1);
  return !!row;
}

/** Remember why the last Slack call failed (shown in settings); null clears it. */
export async function recordSlackError(ws: Pick<SlackWorkspaceRow, "id" | "orgId">, error: string | null) {
  await withOrg(ws.orgId, (db) =>
    db
      .update(slackWorkspace)
      .set({ lastError: error ? error.slice(0, 200) : null })
      .where(eq(slackWorkspace.id, ws.id)),
  ).catch((err: unknown) => console.warn("[pinwren] could not record the Slack error", err));
}

/** Slack error codes that mean the connection itself is broken (as opposed to one channel or message). */
export const SLACK_AUTH_ERRORS = new Set([
  "invalid_auth",
  "account_inactive",
  "token_revoked",
  "token_expired",
  "not_authed",
  "missing_scope",
]);
