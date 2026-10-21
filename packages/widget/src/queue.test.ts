import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryKV } from "./idb";
import { backoff, HttpError, isRetryable, MAX_AGE, Outbox, type Queued } from "./queue";

describe("backoff", () => {
  it("doubles from 2 s and caps at 5 min", () => {
    const mid = () => 0.5; // no jitter
    expect([1, 2, 3, 4].map((n) => backoff(n, mid))).toEqual([2000, 4000, 8000, 16000]);
    expect(backoff(20, mid)).toBe(300_000);
  });
  it("jitters by ±20 %", () => {
    expect(backoff(1, () => 0)).toBe(1600);
    expect(backoff(1, () => 1)).toBe(2400);
  });
});

describe("isRetryable", () => {
  it("retries network errors, 5xx, 408 and 429 — never other 4xx", () => {
    expect(isRetryable(new HttpError("offline", 0))).toBe(true);
    expect(isRetryable(new TypeError("Failed to fetch"))).toBe(true);
    for (const s of [500, 502, 503, 408, 429]) expect(isRetryable(new HttpError("x", s))).toBe(true);
    for (const s of [400, 403, 404, 413, 422]) expect(isRetryable(new HttpError("x", s))).toBe(false);
    expect(isRetryable(new Error("boom"))).toBe(false);
  });
});

describe("Outbox", () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  function setup(send: (p: string) => Promise<string>) {
    const kv = memoryKV<Queued<string>>();
    const sent: string[] = [];
    const dropped: string[] = [];
    const changes: number[] = [];
    const box = new Outbox<string, string>({
      kv,
      project: "pk_1",
      send,
      onSent: (q) => sent.push(q.clientId),
      onDropped: (q) => dropped.push(q.clientId),
      onChange: (n) => changes.push(n),
      random: () => 0.5,
    });
    return { kv, box, sent, dropped, changes };
  }

  it("retries with backoff and the same payload until it goes through", async () => {
    const calls: string[] = [];
    let fail = 2;
    const { box, sent, kv } = setup((p) => {
      calls.push(p);
      return fail-- > 0 ? Promise.reject(new HttpError("down", 503)) : Promise.resolve("ok");
    });
    await box.add("c1", "report-1");
    expect(calls).toEqual([]); // nothing until the first backoff (2 s) elapses
    await vi.advanceTimersByTimeAsync(1999);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(1); // attempt 2 fails → next in 4 s
    expect((await kv.get("c1"))?.attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(3999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2); // attempt 3 fails → next in 8 s
    await vi.advanceTimersByTimeAsync(8000);
    expect(calls).toEqual(["report-1", "report-1", "report-1"]);
    expect(sent).toEqual(["c1"]);
    expect(await kv.all()).toEqual([]);
    box.stop();
  });

  it("flush(force) ignores the backoff (the `online` event and page load)", async () => {
    const { box, sent } = setup(() => Promise.resolve("ok"));
    await box.add("c1", "a");
    await box.flush(true);
    expect(sent).toEqual(["c1"]);
    box.stop();
  });

  it("drops items the server rejects for good, and expired ones", async () => {
    const { box, kv, dropped } = setup((p) => Promise.reject(new HttpError(p, 422)));
    await box.add("bad", "x");
    await kv.set("old", {
      clientId: "old",
      project: "pk_1",
      payload: "y",
      attempts: 3,
      nextAt: 0,
      createdAt: 0,
    });
    vi.setSystemTime(MAX_AGE + 10);
    await box.flush(true);
    expect(dropped.sort()).toEqual(["bad", "old"]);
    expect(await kv.all()).toEqual([]);
    box.stop();
  });

  it("only touches its own project's items and reports the pending count", async () => {
    const { box, kv, changes, sent } = setup(() => Promise.reject(new TypeError("Failed to fetch")));
    await kv.set("other", {
      clientId: "other",
      project: "pk_2",
      payload: "z",
      attempts: 1,
      nextAt: 0,
      createdAt: Date.now(),
    });
    await box.add("mine", "a");
    expect(changes.at(-1)).toBe(1);
    await box.flush(true);
    expect(sent).toEqual([]);
    expect((await kv.get("other"))?.attempts).toBe(1);
    expect((await kv.get("mine"))?.attempts).toBe(2);
    box.stop();
  });

  it("concurrent flushes share one run (no double send)", async () => {
    let calls = 0;
    const { box } = setup(() => {
      calls++;
      return Promise.resolve("ok");
    });
    await box.add("c1", "a");
    await Promise.all([box.flush(true), box.flush(true), box.flush(true)]);
    expect(calls).toBe(1);
    box.stop();
  });

  it("stop() cancels pending retries", async () => {
    let calls = 0;
    const { box } = setup(() => {
      calls++;
      return Promise.resolve("ok");
    });
    await box.add("c1", "a");
    box.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(0);
  });
});
