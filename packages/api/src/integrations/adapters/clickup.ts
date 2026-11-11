import { createHmac } from "node:crypto";
import type { OutboundFetch } from "../../outbound/safe-fetch";
import { safeEqualStr } from "../../crypto";
import { trackerClient } from "../sdk/http";
import {
  type AccessResult,
  type InboundEvent,
  type IssueRef,
  type TrackerAdapter,
  type TrackerConfig,
  TrackerError,
  type WebhookAdapter,
} from "../sdk/types";
import { asRecord, str } from "../sdk/util";

// ClickUp (ADR 0035): a task per feedback item in one list, authenticated with a personal API token (sent
// bare in `Authorization`). Closing sets the list's closed status; reopening its first open status. The
// workspace webhook is registered through the API and ClickUp returns the signing secret with it.

export const CLICKUP_API_URL = "https://api.clickup.com/api/v2";

const call = trackerClient({
  name: "ClickUp",
  base: () => CLICKUP_API_URL,
  headers: (cfg) => ({
    "content-type": "application/json",
    accept: "application/json",
    authorization: cfg.token,
  }),
  hint: (_cfg, status) =>
    status === 401
      ? " (check the API token)"
      : status === 403 || status === 404
        ? " (check the list id and the token's access)"
        : "",
  retries: 2,
});

const settingsOf = (cfg: TrackerConfig) => cfg.settings ?? {};

/** ClickUp priorities: 1 urgent, 2 high, 3 normal, 4 low. Overridable per project. */
const DEFAULT_PRIORITY: Record<string, number> = { urgent: 1, high: 2, medium: 3, low: 4 };
const PRIORITY_KEY: Record<string, string> = {
  low: "priorityLow",
  medium: "priorityMedium",
  high: "priorityHigh",
  urgent: "priorityUrgent",
};

type ClickUpTask = { id?: unknown; custom_id?: unknown; url?: unknown; name?: unknown };
type ClickUpStatus = { status: string; type?: string; orderindex?: number };

function taskRef(t: ClickUpTask): IssueRef {
  const id = str(t.id);
  const url = str(t.url);
  if (!id || !url || !/^https?:\/\//.test(url)) throw new TrackerError("ClickUp did not return a task", null);
  return { number: null, url, externalId: id, key: str(t.custom_id) ?? id };
}

const priorityOf = (cfg: TrackerConfig, priority: string | undefined): number | undefined => {
  if (!priority) return undefined;
  const mapped = Number(settingsOf(cfg)[PRIORITY_KEY[priority] ?? ""]);
  return Number.isInteger(mapped) && mapped >= 1 && mapped <= 4 ? mapped : DEFAULT_PRIORITY[priority];
};

async function listStatuses(
  cfg: TrackerConfig,
  f: OutboundFetch,
): Promise<{ name: string; statuses: ClickUpStatus[] }> {
  const l = await call<{ name?: unknown; statuses?: ClickUpStatus[] }>(
    cfg,
    "GET",
    `/list/${encodeURIComponent(cfg.repo)}`,
    undefined,
    f,
  );
  return { name: str(l.name) ?? cfg.repo, statuses: Array.isArray(l.statuses) ? l.statuses : [] };
}

/** The status to set: the configured one, else the list's "closed" (then "done") or first "open" status. */
function targetStatus(cfg: TrackerConfig, statuses: ClickUpStatus[], state: "open" | "closed"): string {
  const s = settingsOf(cfg);
  const configured = state === "closed" ? s.closedStatus : s.openStatus;
  if (configured) return configured;
  const ordered = [...statuses].sort((a, b) => (a.orderindex ?? 0) - (b.orderindex ?? 0));
  const pick =
    state === "closed"
      ? (ordered.find((x) => x.type === "closed") ?? ordered.find((x) => x.type === "done"))
      : ordered.find((x) => x.type === "open");
  if (!pick) {
    throw new TrackerError(
      `The ClickUp list has no ${state === "closed" ? "closed" : "open"} status — set one in the settings`,
      null,
    );
  }
  return pick.status;
}

async function teamId(cfg: TrackerConfig, f: OutboundFetch): Promise<string> {
  const configured = settingsOf(cfg).teamId;
  if (configured) return configured;
  const r = await call<{ teams?: { id?: unknown }[] }>(cfg, "GET", "/team", undefined, f);
  const teams = (r.teams ?? []).map((t) => str(t.id)).filter((t): t is string => !!t);
  if (teams.length !== 1 || !teams[0]) {
    throw new TrackerError(
      "This token sees several workspaces — set the workspace id (settings › teamId)",
      null,
    );
  }
  return teams[0];
}

const webhooks: WebhookAdapter = {
  mode: "register",
  async register(cfg, callbackUrl, f) {
    const team = await teamId(cfg, f);
    const r = await call<{ id?: unknown; webhook?: { id?: unknown; secret?: unknown } }>(
      cfg,
      "POST",
      `/team/${encodeURIComponent(team)}/webhook`,
      { endpoint: callbackUrl, events: ["taskStatusUpdated"], list_id: Number(cfg.repo) || cfg.repo },
      f,
    );
    const ref = str(r.webhook?.id) ?? str(r.id);
    const secret = str(r.webhook?.secret);
    if (!ref || !secret) throw new TrackerError("ClickUp did not return the webhook", null);
    return { ref, secret };
  },
  async unregister(cfg, ref, f) {
    await call(cfg, "DELETE", `/webhook/${encodeURIComponent(ref)}`, undefined, f);
  },
  /** `X-Signature`: hex HMAC-SHA256 of the raw body, keyed by the secret ClickUp returned with the webhook. */
  verify(secret, req) {
    const sig = req.headers.get("x-signature") ?? "";
    return (
      /^[0-9a-f]{64}$/.test(sig) &&
      safeEqualStr(createHmac("sha256", secret).update(req.raw).digest("hex"), sig)
    );
  },
  deliveryId(req) {
    const item = asRecord(Array.isArray(req.body.history_items) ? req.body.history_items[0] : null);
    const hook = str(req.body.webhook_id);
    const id = str(item.id);
    return hook && id ? `${hook}:${id}` : undefined;
  },
  events(cfg, req) {
    if (req.body.event !== "taskStatusUpdated") return Promise.resolve([]);
    const taskId = str(req.body.task_id);
    const items: unknown[] = Array.isArray(req.body.history_items) ? req.body.history_items : [];
    const change = items.map(asRecord).find((i) => i.field === "status");
    if (!taskId || !change) return Promise.resolve([]);
    const after = asRecord(change.after);
    const closedName = settingsOf(cfg).closedStatus;
    const status = str(after.status);
    const closed = closedName
      ? status?.toLowerCase() === closedName.toLowerCase()
      : after.type === "closed" || after.type === "done";
    const state: InboundEvent["state"] = closed ? "closed" : "open";
    return Promise.resolve([{ number: null, externalId: taskId, state }]);
  },
};

export const clickup: TrackerAdapter = {
  provider: "clickup",
  name: "ClickUp",
  async createIssue(cfg, issue, f) {
    const priority = priorityOf(cfg, issue.priority);
    const t = await call<ClickUpTask>(
      cfg,
      "POST",
      `/list/${encodeURIComponent(cfg.repo)}/task`,
      {
        name: issue.title,
        markdown_description: issue.body,
        ...(priority ? { priority } : {}),
      },
      f,
    );
    const ref = taskRef(t);
    // Tags are added one by one afterwards: a tag the space doesn't have must not fail the create.
    for (const tag of issue.labels) {
      await call(
        cfg,
        "POST",
        `/task/${encodeURIComponent(ref.externalId ?? "")}/tag/${encodeURIComponent(tag)}`,
        undefined,
        f,
      ).catch(() => undefined);
    }
    return ref;
  },
  async setIssueState(cfg, target, state, f) {
    if (!target.externalId) throw new TrackerError("ClickUp task id missing", null);
    const s = settingsOf(cfg);
    const configured = state === "closed" ? s.closedStatus : s.openStatus;
    const status = configured ?? targetStatus(cfg, (await listStatuses(cfg, f)).statuses, state);
    await call(cfg, "PUT", `/task/${encodeURIComponent(target.externalId)}`, { status }, f);
  },
  async checkAccess(cfg, f): Promise<AccessResult> {
    try {
      const { name, statuses } = await listStatuses(cfg, f);
      const s = settingsOf(cfg);
      for (const [key, value] of [
        ["closedStatus", s.closedStatus],
        ["openStatus", s.openStatus],
      ] as const) {
        if (value && !statuses.some((x) => x.status.toLowerCase() === value.toLowerCase())) {
          return { ok: false, message: `The list has no status called "${value}" (${key})` };
        }
      }
      targetStatus(cfg, statuses, "closed");
      return { ok: true, name };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "failed" };
    }
  },
  async findExisting(cfg, issue, f) {
    const r = await call<{ tasks?: ClickUpTask[] }>(
      cfg,
      "GET",
      `/list/${encodeURIComponent(cfg.repo)}/task?include_closed=true&page=0`,
      undefined,
      f,
    );
    const hit = (r.tasks ?? []).find((t) => t.name === issue.title);
    return hit ? taskRef(hit) : null;
  },
  webhooks,
};
