// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { resolveCapture } from "./config";

describe("capture.replay (wave-4 §3)", () => {
  it("is off by default with a 60 s window", () => {
    expect(resolveCapture(undefined).replay).toEqual({ enabled: false, seconds: 60 });
    expect(resolveCapture({ replay: { enabled: "yes" } }).replay.enabled).toBe(false);
  });
  it("clamps the window to 30–120 s", () => {
    expect(resolveCapture({ replay: { enabled: true, seconds: 5 } }).replay).toEqual({
      enabled: true,
      seconds: 30,
    });
    expect(resolveCapture({ replay: { enabled: true, seconds: 999 } }).replay.seconds).toBe(120);
    expect(resolveCapture({ replay: { enabled: true, seconds: 90.6 } }).replay.seconds).toBe(91);
    expect(resolveCapture({ replay: { enabled: true, seconds: Number.NaN } }).replay.seconds).toBe(60);
  });
});

describe("capture.quality", () => {
  it("defaults to standard, with the reporter switch on", () => {
    const c = resolveCapture(undefined);
    expect(c.quality).toBe("standard");
    expect(c.allowReduceQuality).toBe(true);
  });
  it("accepts high and low and ignores anything else", () => {
    expect(resolveCapture({ quality: "high" }).quality).toBe("high");
    expect(resolveCapture({ quality: "low" }).quality).toBe("low");
    expect(resolveCapture({ quality: "ultra" }).quality).toBe("standard");
    expect(resolveCapture({ allowReduceQuality: false }).allowReduceQuality).toBe(false);
  });
});
