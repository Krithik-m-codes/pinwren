import { SLACK_CALLBACKS } from "@pinwren/core";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { decryptSecret } from "../crypto";
import { slackWorkspaceByTeam } from "../db/bootstrap";
import { ApiError } from "../errors";
import { clientIp } from "../net";
import { consume } from "../rate-limit";
import {
  handleBlockActions,
  handleCommand,
  handleGlobalShortcut,
  handleMessageShortcut,
  handleViewSubmission,
  rec,
  type SlackCtx,
} from "../slack/interactions";
import { verifySlackSignature } from "../slack/signature";
import { slackApiFor, workspaceOfOrg } from "../slack/workspace";

// Slack's side of the integration (F-071): interactivity (card buttons, the message shortcut, the capture
// modal) and the /pinwren slash command. No session: the capability is the Slack app's signing secret, so
// each request is verified against the secret of the workspace it names before anything is acted on.
// Mounted before the session middleware, like the tracker webhooks.

const MAX_BODY = 512 * 1024;
/** Requests per sender address and minute, counted before the body is read (Slack sends from shared ranges). */
const PER_IP_PER_MIN = 600;
/** Verified requests per workspace and minute. */
const PER_WORKSPACE_PER_MIN = 600;
/** How long a trigger id is remembered: far longer than Slack's replay window. */
const SEEN_WINDOW_S = 24 * 3600;

const invalid = () => new ApiError(401, "INVALID_SIGNATURE", "Signature verification failed");

const guard = [
  createMiddleware(async (c, next) => {
    if (!(await consume(`slack:ip:${clientIp(c)}`, PER_IP_PER_MIN, 60))) {
      throw new ApiError(429, "RATE_LIMITED", "Too many requests: slow down");
    }
    await next();
  }),
  bodyLimit({
    maxSize: MAX_BODY,
    onError: () => {
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Payload too large");
    },
  }),
] as const;

type Verified = { ctx: SlackCtx; triggerId: string | null; fresh: boolean };

/**
 * Find the workspace the request names, verify its signature and replay window, apply the per-workspace
 * limit and de-duplicate by trigger id. Every failure before the signature checks out is the same 401, so
 * a caller learns nothing about which team ids are connected.
 */
async function verify(
  raw: string,
  headers: { timestamp: string | undefined; signature: string | undefined },
  teamId: unknown,
  triggerId: string | null,
): Promise<Verified> {
  const found = await slackWorkspaceByTeam(teamId);
  if (!found?.active) throw invalid();
  let secret: string;
  try {
    secret = decryptSecret(found.signingSecret);
  } catch {
    throw invalid();
  }
  const verdict = verifySlackSignature(secret, raw, headers);
  if (verdict === "stale") throw new ApiError(401, "STALE_REQUEST", "Request timestamp is too old");
  if (verdict !== "ok") throw invalid();
  if (!(await consume(`slack:ws:${found.id}`, PER_WORKSPACE_PER_MIN, 60))) {
    throw new ApiError(429, "RATE_LIMITED", "Too many requests: slow down");
  }
  const fresh = triggerId ? await consume(`slack:seen:${found.id}:${triggerId}`, 1, SEEN_WINDOW_S) : true;
  const ws = await workspaceOfOrg(found.orgId);
  const api = ws?.id === found.id ? slackApiFor(ws) : null;
  if (!ws || !api) throw invalid();
  return { ctx: { ws, api }, triggerId, fresh };
}

const sigHeaders = (h: (name: string) => string | undefined) => ({
  timestamp: h("x-slack-request-timestamp"),
  signature: h("x-slack-signature"),
});

function jsonObject(text: string | null): Record<string, unknown> {
  try {
    return rec(JSON.parse(text ?? ""));
  } catch {
    throw new ApiError(400, "INVALID_PAYLOAD", "Expected a Slack payload");
  }
}

export const slackInbound = new Hono()
  /**
   * Interactivity: `application/x-www-form-urlencoded` with a `payload` JSON field. Handles the card's
   * buttons and menus (`block_actions`), the message and global shortcuts and the capture modal's submit.
   */
  .post("/slack/interactivity", ...guard, async (c) => {
    const raw = await c.req.text();
    const payload = jsonObject(new URLSearchParams(raw).get("payload"));
    const team = rec(payload.team).id ?? rec(payload.user).team_id;
    const trigger = typeof payload.trigger_id === "string" ? payload.trigger_id : null;
    const { ctx, fresh } = await verify(
      raw,
      sigHeaders((n) => c.req.header(n)),
      team,
      trigger,
    );
    if (!fresh) return c.json({ ok: true, duplicate: true });

    try {
      switch (payload.type) {
        case "block_actions":
          await handleBlockActions(ctx, payload);
          break;
        case "message_action":
          if (payload.callback_id === SLACK_CALLBACKS.messageShortcut)
            await handleMessageShortcut(ctx, payload);
          break;
        case "shortcut":
          if (payload.callback_id === SLACK_CALLBACKS.globalShortcut)
            await handleGlobalShortcut(ctx, payload);
          break;
        case "view_submission": {
          const answer = await handleViewSubmission(ctx, payload);
          if (answer) return c.json(answer);
          break;
        }
        default:
          // view_closed and anything newer: nothing to do.
          break;
      }
    } catch (err) {
      // Slack shows its own generic error; the details stay in our logs.
      console.error("[pinwren] slack interaction failed", err);
    }
    return c.body(null, 200);
  })

  /** The `/pinwren` slash command: `application/x-www-form-urlencoded`. */
  .post("/slack/commands", ...guard, async (c) => {
    const raw = await c.req.text();
    const form = new URLSearchParams(raw);
    const { ctx, fresh } = await verify(
      raw,
      sigHeaders((n) => c.req.header(n)),
      form.get("team_id"),
      form.get("trigger_id"),
    );
    if (!fresh) return c.body(null, 200);
    try {
      const reply = await handleCommand(ctx, form);
      if (reply) return c.json(reply);
    } catch (err) {
      console.error("[pinwren] slack command failed", err);
      return c.json({ response_type: "ephemeral", text: "Something went wrong in Pinwren: try again." });
    }
    return c.body(null, 200);
  });
