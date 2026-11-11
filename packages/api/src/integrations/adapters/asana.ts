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
import { asRecord, byName, plainBody, str } from "../sdk/util";

// Asana (ADR 0035): a task per feedback item in one project (optionally one section), authenticated with a
// personal access token. Completing a task closes the item and unchecking it reopens. The project webhook is
// registered through the API; Asana hands over the signing secret in a one-time handshake.

export const ASANA_API_URL = "https://app.asana.com/api/1.0";

const call = trackerClient({
  name: "Asana",
  base: () => ASANA_API_URL,
  headers: (cfg) => ({
    "content-type": "application/json",
    accept: "application/json",
    authorization: `Bearer ${cfg.token}`,
  }),
  hint: (_cfg, status) =>
    status === 401
      ? " (check the personal access token)"
      : status === 403 || status === 404
        ? " (check the project id and the token's access)"
        : "",
  retries: 2,
});

const settingsOf = (cfg: TrackerConfig) => cfg.settings ?? {};
const PRIORITY_KEY: Record<string, string> = {
  low: "priorityLow",
  medium: "priorityMedium",
  high: "priorityHigh",
  urgent: "priorityUrgent",
};

type Data<T> = { data?: T };
type AsanaTask = { gid?: unknown; name?: unknown; permalink_url?: unknown; completed?: unknown };

function taskRef(t: AsanaTask): IssueRef {
  const gid = str(t.gid);
  const url = str(t.permalink_url);
  if (!gid || !url || !/^https?:\/\//.test(url)) throw new TrackerError("Asana did not return a task", null);
  return { number: null, url, externalId: gid };
}

/** Tag gids for the configured names, among the tags of the project's workspace; unknown names are skipped. */
async function tagGids(cfg: TrackerConfig, names: string[], f: OutboundFetch): Promise<string[]> {
  if (!names.length) return [];
  const p = await call<Data<{ workspace?: { gid?: string } }>>(
    cfg,
    "GET",
    `/projects/${encodeURIComponent(cfg.repo)}?opt_fields=workspace.gid`,
    undefined,
    f,
  );
  const ws = p.data?.workspace?.gid;
  if (!ws) return [];
  const tags = await call<Data<{ gid: string; name: string }[]>>(
    cfg,
    "GET",
    `/workspaces/${encodeURIComponent(ws)}/tags?opt_fields=name&limit=100`,
    undefined,
    f,
  );
  const list = (tags.data ?? []).map((t) => ({ gid: t.gid, name: t.name }));
  return [...new Set(names.map((n) => byName(list, n)?.gid).filter((g): g is string => !!g))];
}

const webhooks: WebhookAdapter = {
  mode: "register",
  async register(cfg, callbackUrl, f) {
    // Asana calls the target while this request is open (the handshake) and expects the secret echoed back.
    const w = await call<Data<{ gid?: unknown }>>(
      cfg,
      "POST",
      "/webhooks",
      {
        data: {
          resource: cfg.repo,
          target: callbackUrl,
          filters: [{ resource_type: "task", action: "changed", fields: ["completed"] }],
        },
      },
      f,
    );
    const ref = str(w.data?.gid);
    if (!ref) throw new TrackerError("Asana did not register the webhook", null);
    return { ref };
  },
  async unregister(cfg, ref, f) {
    await call(cfg, "DELETE", `/webhooks/${encodeURIComponent(ref)}`, undefined, f);
  },
  handshake(req) {
    const secret = req.headers.get("x-hook-secret");
    return secret && secret.length <= 200 ? { secret, reply: { "x-hook-secret": secret } } : null;
  },
  /** `X-Hook-Signature`: hex HMAC-SHA256 of the raw body, keyed by the secret from the handshake. */
  verify(secret, req) {
    const sig = req.headers.get("x-hook-signature") ?? "";
    return (
      /^[0-9a-f]{64}$/.test(sig) &&
      safeEqualStr(createHmac("sha256", secret).update(req.raw).digest("hex"), sig)
    );
  },
  deliveryId: () => undefined,
  async events(cfg, req, f) {
    const events = Array.isArray(req.body.events) ? req.body.events.map(asRecord) : [];
    // Asana sends ids, not values: read each changed task once.
    const gids = [
      ...new Set(
        events
          .filter(
            (e) =>
              asRecord(e.resource).resource_type === "task" &&
              asRecord(e.change).field === "completed" &&
              e.action === "changed",
          )
          .map((e) => str(asRecord(e.resource).gid))
          .filter((g): g is string => !!g),
      ),
    ].slice(0, 20);
    const out: InboundEvent[] = [];
    for (const gid of gids) {
      const t = await call<Data<AsanaTask>>(
        cfg,
        "GET",
        `/tasks/${encodeURIComponent(gid)}?opt_fields=completed`,
        undefined,
        f,
      );
      if (typeof t.data?.completed === "boolean") {
        out.push({ number: null, externalId: gid, state: t.data.completed ? "closed" : "open" });
      }
    }
    return out;
  },
};

export const asana: TrackerAdapter = {
  provider: "asana",
  name: "Asana",
  async createIssue(cfg, issue, f) {
    const s = settingsOf(cfg);
    const tags = await tagGids(cfg, issue.labels, f);
    const option = issue.priority ? s[PRIORITY_KEY[issue.priority] ?? ""] : undefined;
    const t = await call<Data<AsanaTask>>(
      cfg,
      "POST",
      "/tasks",
      {
        data: {
          name: issue.title,
          // Plain text: Asana does not read markup in `notes`, so the reporter's words stay words.
          notes: plainBody(issue),
          projects: [cfg.repo],
          ...(tags.length ? { tags } : {}),
          ...(s.priorityField && option ? { custom_fields: { [s.priorityField]: option } } : {}),
        },
      },
      f,
    );
    const ref = taskRef(t.data ?? {});
    if (s.sectionGid && ref.externalId) {
      await call(
        cfg,
        "POST",
        `/sections/${encodeURIComponent(s.sectionGid)}/addTask`,
        { data: { task: ref.externalId } },
        f,
      );
    }
    return ref;
  },
  async setIssueState(cfg, target, state, f) {
    if (!target.externalId) throw new TrackerError("Asana task id missing", null);
    await call(
      cfg,
      "PUT",
      `/tasks/${encodeURIComponent(target.externalId)}`,
      { data: { completed: state === "closed" } },
      f,
    );
  },
  async checkAccess(cfg, f): Promise<AccessResult> {
    try {
      const p = await call<Data<{ name?: unknown }>>(
        cfg,
        "GET",
        `/projects/${encodeURIComponent(cfg.repo)}?opt_fields=name`,
        undefined,
        f,
      );
      const section = settingsOf(cfg).sectionGid;
      if (section) {
        const s = await call<Data<{ project?: { gid?: string } | null }>>(
          cfg,
          "GET",
          `/sections/${encodeURIComponent(section)}?opt_fields=project.gid`,
          undefined,
          f,
        );
        if (s.data?.project?.gid !== cfg.repo)
          return { ok: false, message: "The section is not in this project" };
      }
      return { ok: true, name: str(p.data?.name) ?? cfg.repo };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "failed" };
    }
  },
  async findExisting(cfg, issue, f) {
    const r = await call<Data<AsanaTask[]>>(
      cfg,
      "GET",
      `/projects/${encodeURIComponent(cfg.repo)}/tasks?opt_fields=name,permalink_url&limit=100`,
      undefined,
      f,
    );
    const hit = (r.data ?? []).find((t) => t.name === issue.title);
    return hit ? taskRef(hit) : null;
  },
  webhooks,
};
