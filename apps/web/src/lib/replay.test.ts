import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { loadReplayEvents, ReplayTooLargeError } from "./replay";

describe("replay loading", () => {
  it("reads gzip events, sorted by time", async () => {
    const gz = gzipSync(
      JSON.stringify([
        { type: 2, timestamp: 5 },
        { type: 4, timestamp: 1 },
      ]),
    );
    const events = await loadReplayEvents(new Response(gz));
    expect(events.map((e) => e.timestamp)).toEqual([1, 5]);
  });

  it("stops decompressing a gzip bomb at the cap instead of inflating it", async () => {
    // 8 MB of zeros compress to a few KB; with a 1 MB cap the read must stop early.
    const bomb = gzipSync(Buffer.alloc(8 * 1024 * 1024, 0x20));
    expect(bomb.byteLength).toBeLessThan(64 * 1024);
    await expect(loadReplayEvents(new Response(bomb), 1024 * 1024)).rejects.toBeInstanceOf(
      ReplayTooLargeError,
    );
  });
});
