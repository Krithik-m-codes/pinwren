import { widgetCommentCreate, widgetFeedbackCreate, widgetFeedbackStatusUpdate } from "@pinwren/core";
import { demoConfig } from "@/lib/demo/config";
import { DEMO_PAGE_TITLE, seedFor } from "@/lib/demo/seed";
import type { DemoItem, DemoReply } from "@/lib/demo/store";
import { type PlaygroundSettings, withPlayground } from "./settings";

// The playground's "Local" mode: the widget's `/w/*` API answered inside this browser from IndexedDB, so
// feedback never leaves the machine. It follows the same contract as the demo API (app/demo-api/w), with the
// same seed; the reporter token is kept as is (it never leaves the browser either).

type LocalItem = Omit<DemoItem, "reporterTokenHash"> & { token: string | null };

const DB = "pinwren-playground";
const STORE = "items";
const MAX_ITEMS = 60;
const OPEN = new Set(["open", "in_progress", "in_review"]);

let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"));
  });
  // A failed open (private mode in some browsers) is retried on the next request.
  dbp.catch(() => (dbp = null));
  return dbp;
}

async function tx<T>(
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T> | undefined,
): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    t.oncomplete = () => resolve(req ? req.result : (undefined as T));
    t.onerror = () => reject(t.error ?? new Error("IndexedDB error"));
  });
}

const all = () => tx<LocalItem[]>("readonly", (s) => s.getAll() as IDBRequest<LocalItem[]>);
const put = (item: LocalItem) => tx("readwrite", (s) => s.put(item));
const remove = (id: string) => tx("readwrite", (s) => s.delete(id));

/** The browser copy of the sandbox, seeded on first use. */
async function items(): Promise<LocalItem[]> {
  const list = await all();
  if (list.length) return list;
  const seeded = seedFor().map(({ reporterTokenHash: _drop, ...i }) => ({ ...i, token: null }));
  for (const i of seeded) await put(i);
  return seeded;
}

/** Start over from the seed (the playground's Reset in Local mode). */
export async function resetLocal() {
  await tx("readwrite", (s) => s.clear());
}

const json = (data: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

const problem = (status: number, code: string, title: string) =>
  new Response(JSON.stringify({ title, status, code }), {
    status,
    headers: { "content-type": "application/problem+json" },
  });

function pathOf(raw: string): string {
  try {
    const u = new URL(raw);
    return u.pathname.replace(/\/$/, "") || "/";
  } catch {
    return "/";
  }
}

const pinOf = (i: LocalItem, origin: string) => ({
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
  replyCount: i.replies.length,
  pageUrl: `${origin}${i.page.path}`,
});

async function body(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** Answer one widget request (`<base>/w/...`). */
export async function handleLocal(req: Request, base: string, s: PlaygroundSettings): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.slice(new URL(base).pathname.length);
  const origin = url.origin;
  const now = new Date().toISOString();
  const m = /^\/w\/feedback\/([^/]+)(\/comments)?$/.exec(path);
  const list = await items();

  if (path === "/w/config" && req.method === "GET") return json(withPlayground(demoConfig(origin), s));
  if (path === "/w/mine") return json({ items: [] });

  if (path === "/w/feedback" && req.method === "GET") {
    const page = url.searchParams.get("url");
    const closed = url.searchParams.get("include") === "closed";
    const want = page ? pathOf(page) : null;
    return json({
      items: list
        .filter((i) => (closed || OPEN.has(i.status)) && (!want || i.page.path === want))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((i) => pinOf(i, origin)),
    });
  }

  if (path === "/w/feedback" && req.method === "POST") {
    const parsed = widgetFeedbackCreate.safeParse(await body(req));
    if (!parsed.success) return problem(400, "VALIDATION_ERROR", "Invalid request");
    const input = parsed.data;
    const dup = list.find((i) => i.clientId === input.clientId);
    if (dup) return json({ feedback: { id: dup.id, number: dup.number } });
    if (list.length >= MAX_ITEMS)
      return problem(429, "DEMO_FULL", "This sandbox is full — reset it to keep going");
    const token = crypto.randomUUID();
    const console_ = input.diagnostics?.console ?? [];
    const network = input.diagnostics?.network ?? [];
    const item: LocalItem = {
      id: crypto.randomUUID(),
      number: Math.max(0, ...list.map((i) => i.number)) + 1,
      clientId: input.clientId,
      kind: input.kind,
      status: "open",
      priority: input.priority ?? "none",
      title: input.title ?? null,
      body: input.body,
      anchor: input.anchor ?? null,
      page: { url: input.page.url, path: pathOf(input.page.url), title: input.page.title ?? DEMO_PAGE_TITLE },
      environment: input.environment,
      diagnostics: {
        console: console_.length,
        network: network.length,
        errors: console_
          .filter((e) => e.level === "error")
          .map((e) => e.message.slice(0, 300))
          .slice(0, 5),
        failed: network
          .slice(0, 5)
          .map((n) => `${n.method} ${n.url.slice(0, 200)} → ${n.status || "failed"}`),
      },
      reporter: { name: input.reporter?.name ?? null, email: input.reporter?.email ?? null },
      assets: [],
      replies: [],
      createdAt: now,
      updatedAt: now,
      token,
      seeded: false,
    };
    await put(item);
    return json({ feedback: { id: item.id, number: item.number, reporterToken: token } }, 201);
  }

  const item = m ? list.find((i) => i.id === decodeURIComponent(m[1] ?? "")) : undefined;
  if (!m || !item) return problem(404, "NOT_FOUND", "Feedback not found");

  if (m[2]) {
    if (req.method === "GET") return json({ items: item.replies });
    if (req.method !== "POST") return problem(405, "METHOD_NOT_ALLOWED", "Not allowed");
    const parsed = widgetCommentCreate.safeParse(await body(req));
    if (!parsed.success) return problem(400, "VALIDATION_ERROR", "Invalid request");
    const reply: DemoReply = {
      id: crypto.randomUUID(),
      body: parsed.data.body,
      createdAt: now,
      authorName: parsed.data.author?.name ?? null,
      team: false,
    };
    await put({ ...item, replies: [...item.replies, reply], updatedAt: now });
    return json({ comment: { ...reply, authorVerified: false } }, 201);
  }

  if (req.method === "GET") return json(pinOf(item, origin));
  if (req.method === "PATCH") {
    const parsed = widgetFeedbackStatusUpdate.safeParse(await body(req));
    if (!parsed.success) return problem(400, "VALIDATION_ERROR", "Invalid request");
    await put({ ...item, status: parsed.data.status, updatedAt: now });
    return json({ feedback: { id: item.id, status: parsed.data.status } });
  }
  if (req.method === "DELETE") {
    const token = req.headers.get("x-pinwren-reporter-token");
    if (!token || token !== item.token)
      return problem(403, "DELETE_NOT_ALLOWED", "Only the person who sent this feedback can delete it");
    await remove(item.id);
    return json(null, 204);
  }
  return problem(405, "METHOD_NOT_ALLOWED", "Not allowed");
}
