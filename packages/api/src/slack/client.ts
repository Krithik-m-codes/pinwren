import { env } from "../env";
import { type OutboundFetch, outboundErrorText, safeFetch } from "../outbound/safe-fetch";

// The few Slack Web API methods Pinwren calls. Every call is form-encoded (the one encoding all methods
// accept, with block/view arguments as JSON strings), has a timeout, and never throws: callers get
// `{ ok: false, error }` where `error` is Slack's error code or a short category, never a response body.

export type SlackResult<T> = { ok: true; data: T } | { ok: false; error: string; retryAfter?: number };

export type SlackBlocks = readonly object[];

export type SlackUser = {
  id: string;
  name: string;
  email: string | null;
  isBot: boolean;
  /** Single/multi-channel guests, Slack Connect strangers: never mapped to a member. */
  isRestricted: boolean;
  deleted: boolean;
};

export type SlackChannel = { id: string; name: string; isMember: boolean; isPrivate: boolean };

export type SlackApi = {
  authTest(): Promise<
    SlackResult<{ teamId: string; teamName: string; teamUrl: string | null; botUserId: string | null }>
  >;
  postMessage(a: {
    channel: string;
    text: string;
    blocks?: SlackBlocks;
    threadTs?: string;
  }): Promise<SlackResult<{ channel: string; ts: string }>>;
  updateMessage(a: {
    channel: string;
    ts: string;
    text: string;
    blocks?: SlackBlocks;
  }): Promise<SlackResult<{ ts: string }>>;
  postEphemeral(a: {
    channel: string;
    user: string;
    text: string;
    blocks?: SlackBlocks;
  }): Promise<SlackResult<Record<string, never>>>;
  openView(a: { triggerId: string; view: object }): Promise<SlackResult<Record<string, never>>>;
  userInfo(id: string): Promise<SlackResult<SlackUser>>;
  listUsers(): Promise<SlackResult<SlackUser[]>>;
  listChannels(): Promise<SlackResult<SlackChannel[]>>;
};

/** Slack gives an interaction three seconds; a call must finish well inside that. */
const TIMEOUT_MS = 2_500;
/** Pages read by list calls: bounds a huge workspace to a few requests. */
const MAX_PAGES = 5;

type Raw = Record<string, unknown>;
const rec = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

function toUser(raw: unknown): SlackUser | null {
  const u = rec(raw);
  const id = str(u.id);
  if (!id) return null;
  const profile = rec(u.profile);
  return {
    id,
    name: str(profile.display_name) ?? str(profile.real_name) ?? str(u.name) ?? id,
    email: str(profile.email)?.toLowerCase() ?? null,
    isBot: u.is_bot === true || id === "USLACKBOT",
    isRestricted: u.is_restricted === true || u.is_ultra_restricted === true || u.is_stranger === true,
    deleted: u.deleted === true,
  };
}

export function slackClient(token: string, fetchImpl: OutboundFetch = safeFetch): SlackApi {
  async function call(method: string, args: Record<string, unknown>): Promise<SlackResult<Raw>> {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(args)) {
      if (v === undefined || v === null) continue;
      form.set(
        k,
        typeof v === "string"
          ? v
          : typeof v === "number" || typeof v === "boolean"
            ? String(v)
            : JSON.stringify(v),
      );
    }
    try {
      const res = await fetchImpl(`${env().SLACK_API_URL.replace(/\/$/, "")}/${method}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/x-www-form-urlencoded; charset=utf-8",
        },
        body: form.toString(),
        timeoutMs: TIMEOUT_MS,
        maxBytes: 4 * 1024 * 1024,
        // The base URL is operator configuration (SLACK_API_URL), never user input.
        trusted: true,
      });
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after"));
        return { ok: false, error: "ratelimited", ...(retryAfter > 0 ? { retryAfter } : {}) };
      }
      if (res.status < 200 || res.status >= 300) return { ok: false, error: `http_${res.status}` };
      const body = rec(await res.json().catch(() => null));
      if (body.ok !== true) return { ok: false, error: str(body.error) ?? "unknown_error" };
      return { ok: true, data: body };
    } catch (err) {
      return { ok: false, error: outboundErrorText(err) };
    }
  }

  /** Cursor-paginated list call, at most MAX_PAGES pages. */
  async function pages(
    method: string,
    args: Record<string, unknown>,
    key: string,
  ): Promise<SlackResult<unknown[]>> {
    const items: unknown[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const r: SlackResult<Raw> = await call(method, { ...args, limit: 200, ...(cursor ? { cursor } : {}) });
      if (!r.ok) return r;
      const batch = r.data[key];
      if (Array.isArray(batch)) items.push(...(batch as unknown[]));
      cursor = str(rec(r.data.response_metadata).next_cursor);
      if (!cursor) break;
    }
    return { ok: true, data: items };
  }

  return {
    async authTest() {
      const r = await call("auth.test", {});
      if (!r.ok) return r;
      const teamId = str(r.data.team_id);
      if (!teamId) return { ok: false, error: "invalid_response" };
      return {
        ok: true,
        data: {
          teamId,
          teamName: str(r.data.team) ?? teamId,
          teamUrl: str(r.data.url),
          botUserId: str(r.data.user_id),
        },
      };
    },
    async postMessage(a) {
      const r = await call("chat.postMessage", {
        channel: a.channel,
        text: a.text,
        blocks: a.blocks,
        thread_ts: a.threadTs,
        unfurl_links: false,
        unfurl_media: false,
        // Mentions in untrusted text are already escaped; this is the second lock.
        link_names: false,
      });
      if (!r.ok) return r;
      const ts = str(r.data.ts);
      const channel = str(r.data.channel);
      return ts && channel ? { ok: true, data: { channel, ts } } : { ok: false, error: "invalid_response" };
    },
    async updateMessage(a) {
      const r = await call("chat.update", { channel: a.channel, ts: a.ts, text: a.text, blocks: a.blocks });
      return r.ok ? { ok: true, data: { ts: str(r.data.ts) ?? a.ts } } : r;
    },
    async postEphemeral(a) {
      const r = await call("chat.postEphemeral", {
        channel: a.channel,
        user: a.user,
        text: a.text,
        blocks: a.blocks,
      });
      return r.ok ? { ok: true, data: {} } : r;
    },
    async openView(a) {
      const r = await call("views.open", { trigger_id: a.triggerId, view: a.view });
      return r.ok ? { ok: true, data: {} } : r;
    },
    async userInfo(id) {
      const r = await call("users.info", { user: id });
      if (!r.ok) return r;
      const u = toUser(r.data.user);
      return u ? { ok: true, data: u } : { ok: false, error: "user_not_found" };
    },
    async listUsers() {
      const r = await pages("users.list", {}, "members");
      if (!r.ok) return r;
      return { ok: true, data: r.data.flatMap((m) => toUser(m) ?? []) };
    },
    async listChannels() {
      const r = await pages(
        "conversations.list",
        { types: "public_channel,private_channel", exclude_archived: true },
        "channels",
      );
      if (!r.ok) return r;
      return {
        ok: true,
        data: r.data.flatMap((c) => {
          const ch = rec(c);
          const id = str(ch.id);
          const name = str(ch.name);
          return id && name
            ? [{ id, name, isMember: ch.is_member === true, isPrivate: ch.is_private === true }]
            : [];
        }),
      };
    },
  };
}
