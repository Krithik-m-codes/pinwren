import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { WidgetFeedbackCreate } from "@pinwren/core";
import { seedFor } from "./seed";

// The in-memory backend behind /demo: one sandbox per visitor, keyed by the visitor's demo project key
// (`pk_demo_<id>`, minted in the browser and kept in a cookie). No database; everything is bounded, a
// sandbox starts over from the seed 10 minutes after it was made (`DEMO_RESET_MINUTES`), and idle ones are
// forgotten after a few hours, so the demo can run on any single Node process.
//
// Memory is bounded three ways: every byte a sandbox keeps (item text, metadata, replies, screenshot and
// attachment data URLs) counts toward its own cap; the number of live sandboxes is capped; and the bytes of
// all sandboxes together are capped. Visitor keys are minted by the browser, so anyone can open as many
// sandboxes as they like; the global caps evict the least recently used ones instead of growing.

export const DEMO_KEY = /^pk_demo_[A-Za-z0-9_-]{16,40}$/;
const VISITOR_TTL_MS = 6 * 60 * 60 * 1000;
/** A sandbox's lifetime before it is re-seeded (the playground says "resets every 10 minutes"). */
export const resetAfterMs = () => envInt("DEMO_RESET_MINUTES", 10) * 60_000;
const MAX_ITEMS = 60;
const MAX_REPLIES = 40;
/** Fixed bookkeeping per sandbox (the map entry, counters), on top of what it stores. */
const VISITOR_OVERHEAD_BYTES = 512;

/** A positive integer from the environment, or the default. Read per call so operators and tests can tune it. */
function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

/**
 * The store's caps. Defaults fit a small single-process host (about 192 MB worst case):
 * - `DEMO_MAX_SANDBOXES` (2,000) live sandboxes; the least recently used is evicted to make room.
 * - `DEMO_MAX_SANDBOX_BYTES` (6 MiB) stored per sandbox; a write that alone is larger is refused (413), one
 *   that would overfill the sandbox is refused (429). Screenshots and attachments that don't fit are
 *   dropped and the report is kept.
 * - `DEMO_MAX_TOTAL_BYTES` (192 MiB) across all sandboxes; least recently used sandboxes are evicted.
 */
export function demoLimits() {
  return {
    maxSandboxes: envInt("DEMO_MAX_SANDBOXES", 2_000),
    maxSandboxBytes: envInt("DEMO_MAX_SANDBOX_BYTES", 6 * 1024 * 1024),
    maxTotalBytes: envInt("DEMO_MAX_TOTAL_BYTES", 192 * 1024 * 1024),
  };
}

/** Bytes a stored value takes, estimated as its UTF-8 JSON size (data URLs are stored as strings, so they count in full). */
export function sizeOf(value: object): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export type DemoReply = {
  id: string;
  body: string;
  createdAt: string;
  authorName: string | null;
  team: boolean;
};

export type DemoAsset = {
  id: string;
  kind: "screenshot" | "attachment";
  name: string | null;
  contentType: string;
  bytes: number;
  dataUrl: string;
};

export type DemoItem = {
  id: string;
  number: number;
  clientId: string;
  kind: WidgetFeedbackCreate["kind"];
  status: "open" | "in_progress" | "in_review" | "resolved" | "wont_fix" | "duplicate";
  priority: NonNullable<WidgetFeedbackCreate["priority"]>;
  title: string | null;
  body: string;
  anchor: WidgetFeedbackCreate["anchor"] | null;
  page: { url: string; path: string; title: string | null };
  environment: WidgetFeedbackCreate["environment"] | null;
  diagnostics: { console: number; network: number; errors: string[]; failed: string[] };
  reporter: { name: string | null; email: string | null };
  assets: DemoAsset[];
  replies: DemoReply[];
  createdAt: string;
  updatedAt: string;
  reporterTokenHash: string | null;
  seeded: boolean;
};

type Visitor = {
  key: string;
  counter: number;
  items: DemoItem[];
  bytes: number;
  seenAt: number;
  bornAt: number;
};

type DemoState = { visitors: Map<string, Visitor>; bytes: number };
const g = globalThis as unknown as { __pinwrenDemo?: DemoState };
// Survives dev-server module reloads; one map per process in production.
const state: DemoState = (g.__pinwrenDemo ??= { visitors: new Map(), bytes: 0 });

const now = () => new Date().toISOString();
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Drop expired sandboxes, then the least recently seen ones (Map keeps insertion order; `visitor()`
 * re-inserts on every use) until there is room for `room` more sandboxes and the total is under its cap.
 * `keep`, the sandbox being written to, is never evicted.
 */
function evict(room: number, keep?: string) {
  const { maxSandboxes, maxTotalBytes } = demoLimits();
  const cutoff = Date.now() - VISITOR_TTL_MS;
  for (const [key, v] of state.visitors) {
    if (v.seenAt < cutoff && key !== keep) drop(key);
  }
  for (const key of state.visitors.keys()) {
    if (state.visitors.size + room <= maxSandboxes && state.bytes <= maxTotalBytes) break;
    if (key !== keep) drop(key);
  }
}

/** Account `bytes` more to a sandbox, evicting others if the store went over its total. */
function charge(v: Visitor, bytes: number) {
  v.bytes += bytes;
  state.bytes += bytes;
  if (state.bytes > demoLimits().maxTotalBytes) evict(0, v.key);
}

/** Live sandboxes and their stored bytes, for tests and diagnostics. */
export function storeStats() {
  return { sandboxes: state.visitors.size, bytes: state.bytes };
}

function drop(key: string) {
  const v = state.visitors.get(key);
  if (!v) return;
  state.bytes -= v.bytes;
  state.visitors.delete(key);
}

const expired = (v: Visitor) => Date.now() - v.bornAt > resetAfterMs();

/** The visitor's sandbox, created (and seeded with a few comments) on first use and again after a reset. */
export function visitor(key: string): Visitor {
  let v = state.visitors.get(key);
  if (v && expired(v)) {
    drop(key);
    v = undefined;
  }
  if (v) {
    state.visitors.delete(key);
    v.seenAt = Date.now();
    state.visitors.set(key, v);
    return v;
  }
  evict(1);
  const items = seedFor();
  v = { key, counter: items.length, items, bytes: 0, seenAt: Date.now(), bornAt: Date.now() };
  state.visitors.set(key, v);
  charge(v, VISITOR_OVERHEAD_BYTES + key.length + sizeOf(items));
  return v;
}

export function peekVisitor(key: string): Visitor | undefined {
  const v = state.visitors.get(key);
  return v && !expired(v) ? v : undefined;
}

export function resetVisitor(key: string) {
  drop(key);
}

/** Page grouping for the demo: path + sorted query, ignoring the host (localhost vs. the live site). */
export function pagePath(raw: string): string {
  try {
    const u = new URL(raw);
    u.searchParams.sort();
    u.searchParams.delete("pinwren");
    const q = u.searchParams.toString();
    return `${u.pathname.replace(/\/$/, "") || "/"}${q ? `?${q}` : ""}`;
  } catch {
    return "/";
  }
}

const OPEN = new Set(["open", "in_progress", "in_review"]);

/** Pins of one page (or of every page without `url`); `origin` turns stored paths into page URLs. */
export function listPins(v: Visitor, url: string | null, includeClosed: boolean, origin = "") {
  const path = url ? pagePath(url) : null;
  return v.items
    .filter((i) => (includeClosed || OPEN.has(i.status)) && (!path || i.page.path === path))
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 100)
    .map((i) => ({
      id: i.id,
      number: i.number,
      kind: i.kind,
      status: i.status,
      priority: i.priority,
      title: i.title,
      body: i.body.slice(0, 500),
      anchor: i.anchor,
      createdAt: i.createdAt,
      reporterName: i.reporter.name,
      replyCount: i.replies.filter((r) => r.body).length,
      pageUrl: `${origin}${i.page.path}`,
    }));
}

type Refusal = { ok: false; status: number; code: string; title: string };

export type CreateResult =
  { ok: true; replay: boolean; feedback: { id: string; number: number; reporterToken?: string } } | Refusal;

const SANDBOX_FULL: Refusal = {
  ok: false,
  status: 429,
  code: "DEMO_FULL",
  title: "This demo sandbox is full — reset it from the demo page to keep going",
};
const TOO_LARGE: Refusal = {
  ok: false,
  status: 413,
  code: "PAYLOAD_TOO_LARGE",
  title: "This is too large for the demo",
};

/** Whether `bytes` more fit the sandbox; a write larger than any sandbox may hold is refused outright. */
function fits(v: Visitor, bytes: number): Refusal | null {
  const { maxSandboxBytes } = demoLimits();
  if (bytes > maxSandboxBytes) return TOO_LARGE;
  if (v.bytes + bytes > maxSandboxBytes) return SANDBOX_FULL;
  return null;
}

export function createFeedback(v: Visitor, input: WidgetFeedbackCreate): CreateResult {
  const existing = v.items.find((i) => i.clientId === input.clientId);
  if (existing) return { ok: true, replay: true, feedback: { id: existing.id, number: existing.number } };
  if (v.items.length >= MAX_ITEMS) return SANDBOX_FULL;

  const assets: DemoAsset[] = [];
  const reporterToken = randomBytes(32).toString("base64url");
  const consoleEntries = input.diagnostics?.console ?? [];
  const networkEntries = input.diagnostics?.network ?? [];
  const item: DemoItem = {
    id: randomUUID(),
    number: ++v.counter,
    clientId: input.clientId,
    kind: input.kind,
    status: "open",
    priority: input.priority ?? "none",
    title: input.title ?? null,
    body: input.body,
    anchor: input.anchor ?? null,
    page: { url: input.page.url, path: pagePath(input.page.url), title: input.page.title ?? null },
    environment: input.environment,
    diagnostics: {
      console: consoleEntries.length,
      network: networkEntries.length,
      errors: consoleEntries
        .filter((e) => e.level === "error")
        .slice(0, 5)
        .map((e) => e.message.slice(0, 300)),
      failed: networkEntries
        .slice(0, 5)
        .map((n) => `${n.method} ${n.url.slice(0, 200)} → ${n.status || "failed"}`),
    },
    reporter: { name: input.reporter?.name ?? null, email: input.reporter?.email ?? null },
    assets,
    replies: [],
    createdAt: now(),
    updatedAt: now(),
    reporterTokenHash: sha256(reporterToken),
    seeded: false,
  };

  // The report itself (text, anchor, page, environment, diagnostics summary) must fit; screenshots and
  // attachments are then kept while they still fit, and dropped otherwise.
  let bytes = sizeOf(item);
  const refused = fits(v, bytes);
  if (refused) return refused;
  const files: { kind: DemoAsset["kind"]; name: string | null; dataUrl: string; contentType?: string }[] = [];
  if (input.screenshot) files.push({ kind: "screenshot", name: null, dataUrl: input.screenshot });
  for (const a of input.attachments ?? [])
    files.push({ kind: "attachment", name: a.name, dataUrl: a.dataUrl, contentType: a.contentType });
  for (const f of files) {
    const contentType = f.contentType ?? /^data:([^;]+);/.exec(f.dataUrl)?.[1] ?? "application/octet-stream";
    const asset: DemoAsset = {
      id: randomUUID(),
      kind: f.kind,
      name: f.name,
      contentType,
      // Decoded size, shown in the inbox; the budget counts the stored data URL instead.
      bytes: Math.floor((f.dataUrl.length - f.dataUrl.indexOf(",") - 1) * 0.75),
      dataUrl: f.dataUrl,
    };
    const size = sizeOf(asset) + 1;
    if (fits(v, bytes + size)) continue;
    assets.push(asset);
    bytes += size;
  }

  v.items.push(item);
  charge(v, bytes);
  return { ok: true, replay: false, feedback: { id: item.id, number: item.number, reporterToken } };
}

export function findItem(v: Visitor, id: string) {
  return v.items.find((i) => i.id === id);
}

export type ReplyResult = { ok: true; reply: DemoReply } | Refusal;

export function addReply(v: Visitor, item: DemoItem, body: string, authorName: string | null): ReplyResult {
  if (item.replies.length >= MAX_REPLIES) {
    return { ok: false, status: 429, code: "DEMO_FULL", title: "This thread is full in the demo" };
  }
  const reply: DemoReply = { id: randomUUID(), body, createdAt: now(), authorName, team: false };
  const bytes = sizeOf(reply) + 1;
  const refused = fits(v, bytes);
  if (refused) return refused;
  item.replies.push(reply);
  item.updatedAt = now();
  charge(v, bytes);
  return { ok: true, reply };
}

/** The reporter deletes their own item (the widget sidebar's Delete): only with its reporter token. */
export function removeItem(v: Visitor, item: DemoItem, token: string | null): Refusal | null {
  if (!token || !item.reporterTokenHash || sha256(token) !== item.reporterTokenHash) {
    return {
      ok: false,
      status: 403,
      code: "DELETE_NOT_ALLOWED",
      title: "Only the person who sent this feedback can delete it",
    };
  }
  // What the item holds now (text, assets, replies), give or take what it was charged when it came in.
  const bytes = Math.min(sizeOf(item), v.bytes);
  v.items = v.items.filter((i) => i !== item);
  v.bytes -= bytes;
  state.bytes -= bytes;
  return null;
}

export function setStatus(item: DemoItem, status: "resolved" | "open") {
  if (item.status !== status) {
    item.status = status;
    item.updatedAt = now();
  }
  return { id: item.id, status: item.status };
}
