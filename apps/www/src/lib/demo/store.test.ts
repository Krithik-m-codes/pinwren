import { randomUUID } from "node:crypto";
import { widgetFeedbackCreate, type WidgetFeedbackCreate } from "@pinwren/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Store from "./store";

let store: typeof Store;

const key = (n: number | string) => `pk_demo_${String(n).padStart(16, "0")}`;

function report(extra: Partial<WidgetFeedbackCreate> = {}): WidgetFeedbackCreate {
  return widgetFeedbackCreate.parse({
    clientId: randomUUID(),
    kind: "comment",
    body: "Hello",
    page: { url: "https://pinwren.dev/demo" },
    environment: { userAgent: "test", viewport: { w: 1, h: 1 }, dpr: 1 },
    ...extra,
  });
}

const png = (chars: number) => `data:image/png;base64,${"A".repeat(chars)}`;

beforeEach(async () => {
  // The store lives on globalThis (to survive dev reloads); start each test from an empty one.
  delete (globalThis as { __pinwrenDemo?: unknown }).__pinwrenDemo;
  vi.resetModules();
  store = await import("./store");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("demo store byte accounting", () => {
  it("counts the seed, report bodies, metadata and replies toward the sandbox", () => {
    const v = store.visitor(key(1));
    const seeded = v.bytes;
    expect(seeded).toBeGreaterThan(1000);
    expect(store.storeStats().bytes).toBe(seeded);

    const body = "é".repeat(5000); // 2 bytes each in UTF-8
    const created = store.createFeedback(v, report({ body, title: "A title" }));
    expect(created.ok).toBe(true);
    const afterReport = v.bytes;
    expect(afterReport - seeded).toBeGreaterThan(10_000);

    const item = v.items.at(-1);
    if (!item) throw new Error("no item");
    const reply = store.addReply(v, item, "x".repeat(8000), "Sam");
    expect(reply.ok).toBe(true);
    expect(v.bytes - afterReport).toBeGreaterThan(8000);
    expect(store.storeStats().bytes).toBe(v.bytes);
  });

  it("counts screenshots and drops ones that don't fit, keeping the report", () => {
    vi.stubEnv("DEMO_MAX_SANDBOX_BYTES", String(64 * 1024));
    const v = store.visitor(key(1));
    const ok = store.createFeedback(v, report({ screenshot: png(20_000) }));
    expect(ok.ok).toBe(true);
    expect(v.items.at(-1)?.assets).toHaveLength(1);
    expect(v.bytes).toBeGreaterThan(20_000);

    const dropped = store.createFeedback(v, report({ screenshot: png(60_000) }));
    expect(dropped.ok).toBe(true);
    expect(v.items.at(-1)?.assets).toHaveLength(0);
    expect(v.bytes).toBeLessThanOrEqual(64 * 1024);
  });

  it("refuses a write larger than a whole sandbox with 413 and a full sandbox with 429", () => {
    vi.stubEnv("DEMO_MAX_SANDBOX_BYTES", String(16 * 1024));
    const v = store.visitor(key(1));
    const big = store.createFeedback(v, report({ body: "x".repeat(5000), title: "y".repeat(200) }));
    expect(big).toMatchObject({ ok: true });

    const item = v.items[0];
    if (!item) throw new Error("no item");
    const before = v.bytes;
    // Fill the sandbox with replies until it refuses.
    let last: ReturnType<typeof Store.addReply> | undefined;
    for (let i = 0; i < 40; i++) {
      last = store.addReply(v, item, "z".repeat(1000), null);
      if (!last.ok) break;
    }
    expect(last).toMatchObject({ ok: false, status: 429, code: "DEMO_FULL" });
    expect(v.bytes).toBeGreaterThan(before);
    expect(v.bytes).toBeLessThanOrEqual(16 * 1024);

    vi.stubEnv("DEMO_MAX_SANDBOX_BYTES", String(4 * 1024));
    const fresh = store.visitor(key(2));
    expect(store.addReply(fresh, item, "z".repeat(5000), null)).toMatchObject({
      ok: false,
      status: 413,
    });
  });
});

describe("demo store global caps", () => {
  it("evicts the least recently used sandbox when the sandbox count is reached", () => {
    vi.stubEnv("DEMO_MAX_SANDBOXES", "3");
    store.visitor(key(1));
    store.visitor(key(2));
    store.visitor(key(3));
    store.visitor(key(1)); // 1 is now the most recently used; 2 is the oldest
    store.visitor(key(4));
    expect(store.storeStats().sandboxes).toBe(3);
    expect(store.peekVisitor(key(2))).toBeUndefined();
    expect(store.peekVisitor(key(1))).toBeDefined();
    expect(store.peekVisitor(key(4))).toBeDefined();
    for (let i = 5; i < 50; i++) store.visitor(key(i));
    expect(store.storeStats().sandboxes).toBe(3);
  });

  it("evicts least recently used sandboxes to stay under the total byte cap, never the one written to", () => {
    vi.stubEnv("DEMO_MAX_TOTAL_BYTES", String(200 * 1024));
    for (let i = 0; i < 10; i++) store.visitor(key(i));
    const writer = store.visitor(key("writer"));
    for (let i = 0; i < 20; i++) {
      store.createFeedback(writer, report({ body: "w".repeat(9000) }));
      expect(store.storeStats().bytes).toBeLessThanOrEqual(200 * 1024);
    }
    expect(store.peekVisitor(key("writer"))).toBe(writer);
    expect(store.peekVisitor(key(0))).toBeUndefined();

    // The total always matches the sum of the live sandboxes.
    const sum = Array.from({ length: 10 }, (_, i) => store.peekVisitor(key(i))?.bytes ?? 0).reduce(
      (a, b) => a + b,
      writer.bytes,
    );
    expect(store.storeStats().bytes).toBe(sum);
  });

  it("releases a sandbox's bytes on reset", () => {
    store.visitor(key(1));
    store.visitor(key(2));
    const two = store.peekVisitor(key(2))?.bytes ?? 0;
    store.resetVisitor(key(1));
    expect(store.storeStats()).toEqual({ sandboxes: 1, bytes: two });
  });
});

describe("wave 5: playground sandbox", () => {
  it("starts over from the seed 10 minutes after it was made", () => {
    vi.useFakeTimers();
    try {
      const v = store.visitor(key(1));
      expect(v.items).toHaveLength(6);
      expect(store.createFeedback(v, report()).ok).toBe(true);
      expect(store.visitor(key(1)).items).toHaveLength(7);
      vi.advanceTimersByTime(9 * 60_000);
      expect(store.visitor(key(1)).items).toHaveLength(7);
      vi.advanceTimersByTime(2 * 60_000);
      expect(store.peekVisitor(key(1))).toBeUndefined();
      expect(store.visitor(key(1)).items).toHaveLength(6);
      vi.stubEnv("DEMO_RESET_MINUTES", "60");
      expect(store.resetAfterMs()).toBe(3_600_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists every page with its URL, and lets only the reporter delete", () => {
    const v = store.visitor(key(2));
    const made = store.createFeedback(v, report({ page: { url: "https://pinwren.dev/about" } }));
    if (!made.ok) throw new Error("create failed");
    const all = store.listPins(v, "", true, "http://localhost:3200");
    expect(all).toHaveLength(7);
    expect(all.find((p) => p.id === made.feedback.id)?.pageUrl).toBe("http://localhost:3200/about");
    expect(store.listPins(v, "http://x.test/demo", false)).toHaveLength(4); // the open seeds

    const item = store.findItem(v, made.feedback.id);
    if (!item) throw new Error("missing");
    const before = v.bytes;
    expect(store.removeItem(v, item, "wrong")?.status).toBe(403);
    expect(store.removeItem(v, item, null)?.code).toBe("DELETE_NOT_ALLOWED");
    expect(store.removeItem(v, item, made.feedback.reporterToken ?? "")).toBeNull();
    expect(store.findItem(v, made.feedback.id)).toBeUndefined();
    expect(v.bytes).toBeLessThan(before);
    // Seeded items have no reporter token: nobody deletes them from the page.
    const seeded = v.items[0];
    if (seeded) expect(store.removeItem(v, seeded, "anything")?.status).toBe(403);
  });
});
