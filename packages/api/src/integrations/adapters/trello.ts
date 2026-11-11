import { createHmac } from "node:crypto";
import type { OutboundFetch } from "../../outbound/safe-fetch";
import { safeEqualStr } from "../../crypto";
import { trackerClient } from "../sdk/http";
import {
  type AccessResult,
  type InboundEvent,
  type IssueRef,
  type NewIssue,
  type TrackerAdapter,
  type TrackerConfig,
  TrackerError,
  type WebhookAdapter,
} from "../sdk/types";
import { asRecord, byName, str } from "../sdk/util";

// Trello (ADR 0032): a card per feedback item on one board's list, with the API key + token of the
// Power-Up. Closing moves the card to the "done" list (or archives it when none is set); reopening moves
// it back. The board's webhook is registered through the API and signed with the Power-Up's app secret.

export const TRELLO_API_URL = "https://api.trello.com/1";

const call = trackerClient({
  name: "Trello",
  base: () => TRELLO_API_URL,
  // The key and token go in the Authorization header, not the query string (which proxies and logs keep).
  headers: (cfg) => ({
    "content-type": "application/json",
    accept: "application/json",
    authorization: `OAuth oauth_consumer_key="${cfg.apiKey ?? ""}", oauth_token="${cfg.token}"`,
  }),
  hint: (_cfg, status) =>
    status === 401
      ? " (check the API key and the token)"
      : status === 404
        ? " (check the board and list ids and the token's access)"
        : "",
  // Trello answers errors with plain text ("invalid id").
  plainTextErrors: true,
  retries: 2,
});

const settingsOf = (cfg: TrackerConfig) => cfg.settings ?? {};
const PRIORITY_KEY: Record<string, string> = {
  low: "priorityLow",
  medium: "priorityMedium",
  high: "priorityHigh",
  urgent: "priorityUrgent",
};

type TrelloCard = { id?: unknown; idShort?: unknown; shortUrl?: unknown; url?: unknown; name?: unknown };

function cardRef(c: TrelloCard): IssueRef {
  const url = str(c.shortUrl) ?? str(c.url);
  const id = str(c.id);
  if (!id || !url || !/^https?:\/\//.test(url)) throw new TrackerError("Trello did not return a card", null);
  const n = Number(c.idShort);
  return { number: Number.isInteger(n) && n > 0 ? n : null, url, externalId: id };
}

/** The board's long id: webhooks name the board by it, and a short link would never match. */
async function boardId(cfg: TrackerConfig, f: OutboundFetch): Promise<string> {
  if (/^[a-f0-9]{24}$/.test(cfg.repo)) return cfg.repo;
  const b = await call<{ id?: unknown }>(
    cfg,
    "GET",
    `/boards/${encodeURIComponent(cfg.repo)}?fields=id`,
    undefined,
    f,
  );
  const id = str(b.id);
  if (!id) throw new TrackerError("Trello did not return the board", null);
  return id;
}

/** Label ids for the configured names and the item's priority; names the board doesn't have are skipped. */
async function labelIds(cfg: TrackerConfig, issue: NewIssue, f: OutboundFetch): Promise<string[]> {
  const names = [...issue.labels];
  const mapped = issue.priority ? settingsOf(cfg)[PRIORITY_KEY[issue.priority] ?? ""] : undefined;
  if (mapped) names.push(mapped);
  if (!names.length) return [];
  const labels = await call<{ id: string; name: string }[]>(
    cfg,
    "GET",
    `/boards/${encodeURIComponent(cfg.repo)}/labels?fields=name&limit=1000`,
    undefined,
    f,
  );
  const ids = names.map((n) => byName(Array.isArray(labels) ? labels : [], n)?.id);
  return [...new Set(ids.filter((i): i is string => !!i))];
}

const listOf = (cfg: TrackerConfig) => {
  const id = settingsOf(cfg).listId;
  if (!id) throw new TrackerError("Choose the Trello list new cards go to (settings › listId)", null);
  return id;
};

const SIGNATURE_RE = /^[A-Za-z0-9+/]{27}=$/;

const webhooks: WebhookAdapter = {
  mode: "register",
  async register(cfg, callbackUrl, f) {
    const w = await call<{ id?: unknown }>(
      cfg,
      "POST",
      "/webhooks",
      { callbackURL: callbackUrl, idModel: await boardId(cfg, f), description: "Pinwren" },
      f,
    );
    const ref = str(w.id);
    if (!ref) throw new TrackerError("Trello did not register the webhook", null);
    // Trello signs with the Power-Up's app secret, which the admin pastes into the integration.
    return { ref };
  },
  async unregister(cfg, ref, f) {
    await call(cfg, "DELETE", `/webhooks/${encodeURIComponent(ref)}`, undefined, f);
  },
  /** `X-Trello-Webhook`: base64 HMAC-SHA1 of the raw body followed by the callback URL, keyed by the app secret. */
  verify(secret, req) {
    const sig = req.headers.get("x-trello-webhook") ?? "";
    if (!SIGNATURE_RE.test(sig)) return false;
    const expected = createHmac("sha1", secret).update(req.raw).update(req.callbackUrl).digest("base64");
    return safeEqualStr(expected, sig);
  },
  deliveryId: (req) => str(asRecord(req.body.action).id),
  events(cfg, req) {
    const action = asRecord(req.body.action);
    if (action.type !== "updateCard") return Promise.resolve([]);
    const data = asRecord(action.data);
    const card = asRecord(data.card);
    const id = str(card.id);
    if (!id) return Promise.resolve([]);
    const done = settingsOf(cfg).doneListId;
    const after = str(asRecord(data.listAfter).id);
    const before = str(asRecord(data.listBefore).id);
    let state: InboundEvent["state"] | null = null;
    if (done && after === done) state = "closed";
    else if (done && before === done && after) state = "open";
    else if (!done && typeof asRecord(data.old).closed === "boolean" && typeof card.closed === "boolean") {
      // No done list: archiving is what closes.
      state = card.closed ? "closed" : "open";
    }
    if (!state) return Promise.resolve([]);
    const n = Number(card.idShort);
    return Promise.resolve([{ number: Number.isInteger(n) && n > 0 ? n : null, externalId: id, state }]);
  },
};

export const trello: TrackerAdapter = {
  provider: "trello",
  name: "Trello",
  async createIssue(cfg, issue, f) {
    const idLabels = await labelIds(cfg, issue, f);
    const c = await call<TrelloCard>(
      cfg,
      "POST",
      "/cards",
      {
        idList: listOf(cfg),
        name: issue.title,
        desc: issue.body.slice(0, 16_000),
        pos: "top",
        ...(idLabels.length ? { idLabels: idLabels.join(",") } : {}),
      },
      f,
    );
    return cardRef(c);
  },
  async setIssueState(cfg, target, state, f) {
    if (!target.externalId) throw new TrackerError("Trello card id missing", null);
    const done = settingsOf(cfg).doneListId;
    const id = encodeURIComponent(target.externalId);
    await call(
      cfg,
      "PUT",
      `/cards/${id}`,
      done
        ? { idList: state === "closed" ? done : listOf(cfg), closed: false }
        : { closed: state === "closed" },
      f,
    );
  },
  async checkAccess(cfg, f): Promise<AccessResult> {
    try {
      const board = await call<{ id?: unknown; name?: unknown }>(
        cfg,
        "GET",
        `/boards/${encodeURIComponent(cfg.repo)}?fields=name`,
        undefined,
        f,
      );
      const id = str(board.id);
      for (const key of ["listId", "doneListId"]) {
        const list = settingsOf(cfg)[key];
        if (!list) continue;
        const l = await call<{ idBoard?: unknown }>(
          cfg,
          "GET",
          `/lists/${encodeURIComponent(list)}?fields=idBoard`,
          undefined,
          f,
        );
        if (id && l.idBoard !== id) {
          return {
            ok: false,
            message: `The ${key === "listId" ? "list" : "done list"} is not on this board`,
          };
        }
      }
      return { ok: true, name: str(board.name) ?? cfg.repo, ...(id ? { repo: id } : {}) };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "failed" };
    }
  },
  async findExisting(cfg, issue, f) {
    const cards = await call<TrelloCard[]>(
      cfg,
      "GET",
      `/lists/${encodeURIComponent(listOf(cfg))}/cards?fields=name,idShort,shortUrl`,
      undefined,
      f,
    );
    const hit = (Array.isArray(cards) ? cards : []).find((c) => c.name === issue.title);
    return hit ? cardRef(hit) : null;
  },
  webhooks,
};
