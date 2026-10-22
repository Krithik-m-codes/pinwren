import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { WidgetFeedbackCreate } from "@pinwren/core";
import { seedFor } from "./seed";

// The in-memory backend behind /demo: one sandbox per visitor, keyed by the visitor's demo project key
// (`pk_demo_<id>`, minted in the browser and kept in a cookie). No database; everything is bounded and
// forgotten after a few hours, so the demo can run on any single Node process.

export const DEMO_KEY = /^pk_demo_[A-Za-z0-9_-]{16,40}$/;
const VISITOR_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_VISITORS = 2_000;
const MAX_ITEMS = 60;
const MAX_REPLIES = 40;
/** Screenshots and attachments kept per visitor; larger ones are dropped (the report itself is kept). */
const MAX_VISITOR_BYTES = 6 * 1024 * 1024;
const MAX_TOTAL_BYTES = 192 * 1024 * 1024;

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

type Visitor = { key: string; counter: number; items: DemoItem[]; bytes: number; seenAt: number };

type DemoState = { visitors: Map<string, Visitor>; bytes: number };
const g = globalThis as unknown as { __pinwrenDemo?: DemoState };
// Survives dev-server module reloads; one map per process in production.
const state: DemoState = (g.__pinwrenDemo ??= { visitors: new Map(), bytes: 0 });

const now = () => new Date().toISOString();
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function evict() {
  const cutoff = Date.now() - VISITOR_TTL_MS;
  for (const [key, v] of state.visitors) {
    if (v.seenAt < cutoff) drop(key);
  }
  // Least recently seen first (Map keeps insertion order; `touch` re-inserts).
  for (const key of state.visitors.keys()) {
    if (state.visitors.size <= MAX_VISITORS && state.bytes <= MAX_TOTAL_BYTES) break;
    drop(key);
  }
}

function drop(key: string) {
  const v = state.visitors.get(key);
  if (!v) return;
  state.bytes -= v.bytes;
  state.visitors.delete(key);
}

/** The visitor's sandbox, created (and seeded with a few comments) on first use. */
export function visitor(key: string): Visitor {
  let v = state.visitors.get(key);
  if (v) {
    state.visitors.delete(key);
  } else {
    evict();
    const items = seedFor();
    v = { key, counter: items.length, items, bytes: 0, seenAt: Date.now() };
  }
  v.seenAt = Date.now();
  state.visitors.set(key, v);
  return v;
}

export function peekVisitor(key: string): Visitor | undefined {
  return state.visitors.get(key);
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

export function listPins(v: Visitor, url: string | null, includeClosed: boolean) {
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
    }));
}

export type CreateResult =
  | { ok: true; replay: boolean; feedback: { id: string; number: number; reporterToken?: string } }
  | { ok: false; status: number; code: string; title: string };

export function createFeedback(v: Visitor, input: WidgetFeedbackCreate): CreateResult {
  const existing = v.items.find((i) => i.clientId === input.clientId);
  if (existing) return { ok: true, replay: true, feedback: { id: existing.id, number: existing.number } };
  if (v.items.length >= MAX_ITEMS) {
    return {
      ok: false,
      status: 429,
      code: "DEMO_FULL",
      title: "This demo sandbox is full — reset it from the demo page to keep going",
    };
  }

  const assets: DemoAsset[] = [];
  const files: { kind: DemoAsset["kind"]; name: string | null; dataUrl: string; contentType?: string }[] = [];
  if (input.screenshot) files.push({ kind: "screenshot", name: null, dataUrl: input.screenshot });
  for (const a of input.attachments ?? [])
    files.push({ kind: "attachment", name: a.name, dataUrl: a.dataUrl, contentType: a.contentType });
  for (const f of files) {
    const contentType = f.contentType ?? /^data:([^;]+);/.exec(f.dataUrl)?.[1] ?? "application/octet-stream";
    // base64 → bytes, roughly; good enough for the sandbox budget.
    const bytes = Math.floor((f.dataUrl.length - f.dataUrl.indexOf(",") - 1) * 0.75);
    if (v.bytes + bytes > MAX_VISITOR_BYTES) continue;
    v.bytes += bytes;
    state.bytes += bytes;
    assets.push({ id: randomUUID(), kind: f.kind, name: f.name, contentType, bytes, dataUrl: f.dataUrl });
  }

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
  v.items.push(item);
  return { ok: true, replay: false, feedback: { id: item.id, number: item.number, reporterToken } };
}

export function findItem(v: Visitor, id: string) {
  return v.items.find((i) => i.id === id);
}

export function addReply(item: DemoItem, body: string, authorName: string | null): DemoReply | null {
  if (item.replies.length >= MAX_REPLIES) return null;
  const reply: DemoReply = { id: randomUUID(), body, createdAt: now(), authorName, team: false };
  item.replies.push(reply);
  item.updatedAt = now();
  return reply;
}

export function setStatus(item: DemoItem, status: "resolved" | "open") {
  if (item.status !== status) {
    item.status = status;
    item.updatedAt = now();
  }
  return { id: item.id, status: item.status };
}
