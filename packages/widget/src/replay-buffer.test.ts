import { describe, expect, it } from "vitest";
import { gzipEvents, META, ReplayBuffer } from "./replay-buffer";

const FULL = 2;
const INC = 3;
const ev = (type: number, timestamp: number, pad = 0) =>
  JSON.stringify({ type, timestamp, data: "x".repeat(pad) });

/** Feed a recording: a full snapshot every `every` ms and an incremental event every second. */
function record(b: ReplayBuffer, untilMs: number, every = 10_000) {
  for (let t = 0; t <= untilMs; t += 1000) {
    if (t % every === 0) {
      b.push(ev(META, t), META, t);
      b.push(ev(FULL, t), FULL, t);
    } else b.push(ev(INC, t), INC, t);
  }
}

const types = (events: string[]) => events.map((e) => (JSON.parse(e) as { type: number }).type);

describe("ReplayBuffer", () => {
  it("keeps the last window, from the full snapshot before it", () => {
    const b = new ReplayBuffer(30_000, 1e9);
    record(b, 95_000);
    const f = b.freeze(95_000);
    expect(f).not.toBeNull();
    // 95 s − 30 s = 65 s: the segment starting at 60 s is the oldest still needed.
    expect(f?.first).toBe(60_000);
    expect(f?.last).toBe(95_000);
    expect(types(f?.events ?? []).slice(0, 2)).toEqual([META, FULL]);
    expect(b.segments).toBe(4); // 60, 70, 80, 90
  });

  it("trims old segments as time passes even without new events", () => {
    const b = new ReplayBuffer(30_000, 1e9);
    record(b, 40_000);
    expect(b.freeze(40_000)?.first).toBe(10_000);
    expect(b.freeze(75_000)?.first).toBe(40_000);
  });

  it("drops whole segments to stay under the memory cap", () => {
    const b = new ReplayBuffer(120_000, 5_000);
    for (let t = 0; t < 60_000; t += 10_000) {
      expect(b.push(ev(META, t), META, t)).toBe(true);
      expect(b.push(ev(FULL, t, 1500), FULL, t)).toBe(true);
    }
    expect(b.chars).toBeLessThanOrEqual(5_000);
    expect(b.freeze(60_000)?.first).toBeGreaterThan(0);
  });

  it("reports an over-cap segment so the recorder can start a new one", () => {
    const b = new ReplayBuffer(60_000, 1_000);
    b.push(ev(META, 0), META, 0);
    b.push(ev(FULL, 0, 200), FULL, 0);
    expect(b.push(ev(INC, 1, 900), INC, 1)).toBe(false);
    // A fresh snapshot lets the oversized segment go.
    expect(b.push(ev(META, 2), META, 2)).toBe(true);
    expect(b.segments).toBe(1);
  });

  it("has nothing to play before the first full snapshot", () => {
    const b = new ReplayBuffer(60_000, 1e6);
    expect(b.freeze()).toBeNull();
    b.push(ev(META, 0), META, 0);
    expect(b.freeze(0)).toBeNull();
    b.push(ev(FULL, 0), FULL, 0);
    expect(b.freeze(0)?.events).toHaveLength(2);
    b.clear();
    expect(b.freeze(0)).toBeNull();
    expect(b.chars).toBe(0);
  });
});

describe("gzipEvents", () => {
  it("gzips the events as one JSON array", async () => {
    const events = [ev(META, 1), ev(FULL, 2, 5000), ev(INC, 3)];
    const gz = await gzipEvents(events);
    expect(gz.type).toBe("application/gzip");
    const bytes = new Uint8Array(await gz.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]); // gzip magic
    expect(gz.size).toBeLessThan(events.join(",").length);
    const text = await new Response(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
    ).text();
    expect((JSON.parse(text) as { timestamp: number }[]).map((e) => e.timestamp)).toEqual([1, 2, 3]);
  });
  it("handles an empty buffer", async () => {
    const text = await new Response(
      (await gzipEvents([])).stream().pipeThrough(new DecompressionStream("gzip")),
    ).text();
    expect(text).toBe("[]");
  });
});
