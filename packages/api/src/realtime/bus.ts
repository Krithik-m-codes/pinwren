import { randomBytes } from "node:crypto";
import { PRESENCE_TTL_MS, type PresenceUser, type StreamEventName } from "@pinwren/core";
import { notifyRealtime, REALTIME_CHANNEL } from "../db/system";
import postgres from "postgres";
import { env } from "../env";

// Real-time fan-out (F-050, wave-4 contract §1). Every server process — each cluster worker, each
// replica — LISTENs on one Postgres channel; a change anywhere is NOTIFYed once and reaches every
// process, which forwards it to its own SSE clients. Postgres stays the only required service. NOTIFY
// payloads are capped by Postgres at 8000 bytes, so messages carry ids and small fields only; clients
// refetch details.

export const CHANNEL = REALTIME_CHANNEL;
export const MAX_PAYLOAD_BYTES = 7000;
const RING_SIZE = 500;
const SWEEP_MS = 5_000;

/** A feedback/comment event, as broadcast. */
export type BusEvent = {
  t: "e";
  /** Global event id, set by `publish`: every process receives the same id, so `Last-Event-ID` can
   *  resume on whichever cluster worker or replica the reconnect lands on. */
  id?: string;
  orgId: string;
  projectId: string;
  event: Exclude<StreamEventName, "presence" | "ping">;
  data: Record<string, unknown>;
};
/** A presence heartbeat (`feedbackId` null = left). */
export type BusPresence = {
  t: "p";
  orgId: string;
  projectId: string | null;
  feedbackId: string | null;
  user: PresenceUser;
};
/**
 * A new bell entry for one person (wave-5 contract §3.2): published by the dispatch job after it inserts
 * the notification row, so the client refetches only once the row exists. Delivered only to that user's
 * streams in that workspace, never stored in the replay ring (the bell refetches on reconnect).
 */
export type BusNotification = {
  t: "n";
  orgId: string;
  userId: string;
  data: {
    id: string;
    type: string;
    feedbackId: string | null;
    orgId: string;
    data: Record<string, unknown>;
    createdAt: string;
  };
};
export type BusMessage = BusEvent | BusPresence | BusNotification;

export type Delivered = { id: string | null; event: StreamEventName; data: Record<string, unknown> };

export type Subscriber = {
  orgId: string;
  /** Who is listening: `notification.created` reaches only their own streams. */
  userId?: string;
  /** null = every project of the organisation. */
  projectIds: ReadonlySet<string> | null;
  send: (msg: Delivered) => void;
};

type PresenceEntry = { user: PresenceUser; feedbackId: string; projectId: string; expires: number };
type Stored = {
  id: string;
  orgId: string;
  projectId: string;
  event: BusEvent["event"];
  data: BusEvent["data"];
};

type State = {
  bootId: string;
  seq: number;
  ring: Stored[];
  subscribers: Set<Subscriber>;
  /** orgId → userId → where they are. */
  presence: Map<string, Map<string, PresenceEntry>>;
  listening: Promise<void> | null;
  client: postgres.Sql | null;
  sweeper: ReturnType<typeof setInterval> | null;
};

// One bus per process; Next.js dev reloads modules, so it lives on globalThis.
const g = globalThis as unknown as { __pinwrenBus?: State };
const state = (): State =>
  (g.__pinwrenBus ??= {
    bootId: randomBytes(6).toString("base64url"),
    seq: 0,
    ring: [],
    subscribers: new Set(),
    presence: new Map(),
    listening: null,
    client: null,
    sweeper: null,
  });

const visibleTo = (s: Subscriber, orgId: string, projectId: string | null) =>
  s.orgId === orgId && (s.projectIds === null || (projectId !== null && s.projectIds.has(projectId)));

/** Shrink an oversized message: `changes` values are the only thing that can grow. */
export function encodeMessage(msg: BusMessage): string {
  let text = JSON.stringify(msg);
  if (Buffer.byteLength(text) <= MAX_PAYLOAD_BYTES) return text;
  if (msg.t === "e" && msg.event === "feedback.updated") {
    const changes = (msg.data.changes ?? {}) as Record<string, unknown>;
    const slim: BusEvent = {
      ...msg,
      data: {
        ...msg.data,
        changes: Object.fromEntries(Object.keys(changes).map((k) => [k, null])),
        truncated: true,
      },
    };
    text = JSON.stringify(slim);
    if (Buffer.byteLength(text) <= MAX_PAYLOAD_BYTES) return text;
  }
  throw new Error(`realtime message too large (${Buffer.byteLength(text)} bytes)`);
}

/** Broadcast to every process. Never throws: real time is best effort and must not fail a write. */
export async function publish(msg: BusMessage): Promise<void> {
  if (msg.t === "e") msg.id ??= `${Date.now().toString(36)}-${randomBytes(6).toString("base64url")}`;
  try {
    await notifyRealtime(encodeMessage(msg));
  } catch (err) {
    console.warn("[pinwren] realtime publish failed", err);
  }
}

function presenceUsers(orgId: string, feedbackId: string): PresenceUser[] {
  const org = state().presence.get(orgId);
  if (!org) return [];
  const now = Date.now();
  return [...org.values()]
    .filter((p) => p.feedbackId === feedbackId && p.expires > now)
    .map((p) => p.user)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function broadcastPresence(orgId: string, projectId: string, feedbackId: string) {
  const data = { feedbackId, projectId, users: presenceUsers(orgId, feedbackId) };
  for (const s of state().subscribers) {
    if (visibleTo(s, orgId, projectId)) s.send({ id: null, event: "presence", data });
  }
}

/** Apply one message received from the channel (exported for tests). */
export function receive(msg: BusMessage): void {
  const st = state();
  if (msg.t === "n") {
    const out: Delivered = { id: null, event: "notification.created", data: msg.data };
    for (const s of st.subscribers) if (s.orgId === msg.orgId && s.userId === msg.userId) s.send(out);
    return;
  }
  if (msg.t === "e") {
    const stored: Stored = {
      id: msg.id ?? `${st.bootId}.${++st.seq}`,
      orgId: msg.orgId,
      projectId: msg.projectId,
      event: msg.event,
      data: msg.data,
    };
    st.ring.push(stored);
    if (st.ring.length > RING_SIZE) st.ring.splice(0, st.ring.length - RING_SIZE);
    const out: Delivered = { id: stored.id, event: msg.event, data: msg.data };
    for (const s of st.subscribers) if (visibleTo(s, msg.orgId, msg.projectId)) s.send(out);
    return;
  }
  let org = st.presence.get(msg.orgId);
  if (!org) st.presence.set(msg.orgId, (org = new Map<string, PresenceEntry>()));
  const before = org.get(msg.user.id);
  if (msg.feedbackId && msg.projectId) {
    org.set(msg.user.id, {
      user: msg.user,
      feedbackId: msg.feedbackId,
      projectId: msg.projectId,
      expires: Date.now() + PRESENCE_TTL_MS,
    });
  } else {
    org.delete(msg.user.id);
  }
  // A plain heartbeat for the same item changes nothing anyone sees.
  if (before?.feedbackId === msg.feedbackId && before.expires > Date.now()) return;
  if (before && before.feedbackId !== msg.feedbackId)
    broadcastPresence(msg.orgId, before.projectId, before.feedbackId);
  if (msg.feedbackId && msg.projectId) broadcastPresence(msg.orgId, msg.projectId, msg.feedbackId);
}

/** Drop expired presence and tell watchers (runs every few seconds while anyone is subscribed). */
export function sweepPresence(now = Date.now()): void {
  for (const [orgId, org] of state().presence) {
    for (const [userId, p] of org) {
      if (p.expires > now) continue;
      org.delete(userId);
      broadcastPresence(orgId, p.projectId, p.feedbackId);
    }
    if (!org.size) state().presence.delete(orgId);
  }
}

function startListening(): Promise<void> {
  const st = state();
  st.listening ??= (async () => {
    // A dedicated connection: LISTEN holds it for the life of the process (postgres.js reconnects it).
    st.client ??= postgres(env().DATABASE_URL, { max: 1, onnotice: () => undefined });
    await st.client.listen(CHANNEL, (payload) => {
      try {
        receive(JSON.parse(payload) as BusMessage);
      } catch (err) {
        console.warn("[pinwren] bad realtime message", err);
      }
    });
    st.sweeper ??= setInterval(() => sweepPresence(), SWEEP_MS);
    st.sweeper.unref();
  })().catch((err: unknown) => {
    st.listening = null;
    throw err;
  });
  return st.listening;
}

/**
 * Subscribe an SSE client. `lastEventId` (from `Last-Event-ID`) replays what came after that event.
 * Every process receives every event in the same (commit) order with the same global id, so this works
 * on whichever worker the reconnect lands on. An id older than the last 500 events replays nothing; the
 * client refetches on reconnect anyway. Returns the replayed events, the current presence for the
 * client's scope and an unsubscribe function.
 */
export async function subscribe(
  s: Subscriber,
  lastEventId?: string | null,
): Promise<{ backlog: Delivered[]; presence: Delivered[]; unsubscribe: () => void }> {
  await startListening();
  const st = state();
  st.subscribers.add(s);
  const backlog: Delivered[] = [];
  const from = lastEventId ? st.ring.findIndex((e) => e.id === lastEventId) : -1;
  if (from >= 0) {
    for (const e of st.ring.slice(from + 1)) {
      if (visibleTo(s, e.orgId, e.projectId)) backlog.push({ id: e.id, event: e.event, data: e.data });
    }
  }
  const presence: Delivered[] = [];
  const seen = new Set<string>();
  const now = Date.now();
  for (const p of st.presence.get(s.orgId)?.values() ?? []) {
    if (p.expires <= now || seen.has(p.feedbackId) || !visibleTo(s, s.orgId, p.projectId)) continue;
    seen.add(p.feedbackId);
    presence.push({
      id: null,
      event: "presence",
      data: { feedbackId: p.feedbackId, projectId: p.projectId, users: presenceUsers(s.orgId, p.feedbackId) },
    });
  }
  return { backlog, presence, unsubscribe: () => st.subscribers.delete(s) };
}

/** For tests: forget everything this process holds. */
export function resetBusForTests(): void {
  const st = state();
  st.ring = [];
  st.seq = 0;
  st.subscribers.clear();
  st.presence.clear();
}
