// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  advance,
  baseType,
  bitrates,
  canRecord,
  clockText,
  type Ev,
  failKey,
  HARD_MAX_SECONDS,
  isBusy,
  limitHit,
  MAX_RECORDING_BYTES,
  mimeCandidates,
  type Phase,
  pickMime,
  resolveRecording,
  sizeText,
  STOP_BYTES,
  Stopwatch,
} from "./record-logic";

const run = (events: Ev[], from: Phase = "idle") => events.reduce<Phase>((p, e) => advance(p, e), from);

describe("phases", () => {
  it("walks the whole happy path", () => {
    const seen: Phase[] = [];
    let p: Phase = "idle";
    for (const e of [
      "open",
      "start",
      "granted",
      "go",
      "pause",
      "resume",
      "stop",
      "finalized",
      "close",
    ] as Ev[]) {
      p = advance(p, e);
      seen.push(p);
    }
    expect(seen).toEqual([
      "setup",
      "requesting",
      "countdown",
      "recording",
      "paused",
      "recording",
      "stopping",
      "preview",
      "idle",
    ]);
  });
  it("lets the person retake from the preview", () => {
    expect(run(["retake"], "preview")).toBe("setup");
  });
  it("sends every failure back to setup, where the reason is shown", () => {
    for (const from of ["requesting", "countdown", "recording", "paused", "stopping"] as Phase[])
      expect(advance(from, "fail")).toBe("setup");
  });
  it("ignores events that make no sense where they arrive", () => {
    expect(advance("idle", "stop")).toBe("idle");
    expect(advance("setup", "go")).toBe("setup");
    expect(advance("recording", "start")).toBe("recording");
    expect(advance("countdown", "pause")).toBe("countdown");
    // a second stop while the last chunk is flushing does nothing
    expect(advance("stopping", "stop")).toBe("stopping");
    // cannot attach (close) a clip that is still being recorded
    expect(advance("recording", "close")).toBe("recording");
  });
  it("cancels out of the countdown but not out of a running recording", () => {
    expect(advance("countdown", "stop")).toBe("idle");
    expect(advance("recording", "stop")).toBe("stopping");
  });
  it("is busy exactly while the capture is running or about to", () => {
    const busy = (
      ["idle", "setup", "requesting", "countdown", "recording", "paused", "stopping", "preview"] as Phase[]
    ).filter(isBusy);
    expect(busy).toEqual(["requesting", "countdown", "recording", "paused", "stopping"]);
  });
});

describe("format", () => {
  const only =
    (...ok: string[]) =>
    (m: string) =>
      ok.includes(m);
  it("prefers VP9, then VP8, then plain WebM, then MP4", () => {
    expect(pickMime(only(...mimeCandidates(false)), false)).toBe("video/webm;codecs=vp9");
    expect(pickMime(only("video/webm;codecs=vp8", "video/webm"), false)).toBe("video/webm;codecs=vp8");
    expect(pickMime(only("video/webm", "video/mp4"), false)).toBe("video/webm");
    expect(pickMime(only("video/mp4;codecs=avc1.42E01E", "video/mp4"), false)).toBe(
      "video/mp4;codecs=avc1.42E01E",
    );
    expect(pickMime(only("video/mp4"), false)).toBe("video/mp4");
  });
  it("asks for an audio codec only when there is a voice", () => {
    expect(pickMime(only(...mimeCandidates(true)), true)).toBe("video/webm;codecs=vp9,opus");
    expect(mimeCandidates(false).some((m) => m.includes("opus") || m.includes("mp4a"))).toBe(false);
    expect(pickMime(only("video/mp4;codecs=avc1.42E01E,mp4a.40.2"), true)).toContain("mp4a");
  });
  it("returns null when the browser supports none", () => {
    expect(pickMime(() => false, true)).toBeNull();
  });
  it("stores only the two types the server accepts, without the codec parameter", () => {
    expect(baseType("video/webm;codecs=vp9,opus")).toBe("video/webm");
    expect(baseType("video/mp4;codecs=avc1.42E01E")).toBe("video/mp4");
    expect(baseType("VIDEO/MP4")).toBe("video/mp4");
    expect(baseType("")).toBe("video/webm");
    expect(baseType("audio/ogg")).toBe("video/webm");
  });
});

describe("bitrate budget", () => {
  it("keeps a full-length clip under the size cap", () => {
    for (const seconds of [10, 60, 120, 200, HARD_MAX_SECONDS]) {
      for (const audio of [false, true]) {
        const r = bitrates(seconds, audio);
        const bytes = ((r.video + (audio ? r.audio : 0)) / 8) * seconds;
        // the floor (250 kbps) is the one thing allowed to exceed the budget, and only at the longest length
        if (r.video > 250_000) expect(bytes).toBeLessThanOrEqual(MAX_RECORDING_BYTES);
      }
    }
  });
  it("spends more on a short clip, within sane bounds", () => {
    expect(bitrates(10, false).video).toBe(2_500_000);
    expect(bitrates(120, false).video).toBeGreaterThan(bitrates(300, false).video);
    expect(bitrates(HARD_MAX_SECONDS, false).video).toBeGreaterThanOrEqual(250_000);
  });
});

describe("limits", () => {
  it("stops at the project's length, never past the hard cap", () => {
    expect(limitHit({ elapsedMs: 119_999, bytes: 1 }, 120)).toBeNull();
    expect(limitHit({ elapsedMs: 120_000, bytes: 1 }, 120)).toBe("time");
    expect(limitHit({ elapsedMs: HARD_MAX_SECONDS * 1000, bytes: 1 }, 99_999)).toBe("time");
    expect(limitHit({ elapsedMs: HARD_MAX_SECONDS * 1000 - 1, bytes: 1 }, 99_999)).toBeNull();
  });
  it("stops before the size cap so the last chunk still fits", () => {
    expect(STOP_BYTES).toBeLessThan(MAX_RECORDING_BYTES);
    expect(limitHit({ elapsedMs: 1000, bytes: STOP_BYTES - 1 }, 120)).toBeNull();
    expect(limitHit({ elapsedMs: 1000, bytes: STOP_BYTES }, 120)).toBe("size");
  });
  it("reports size before time when both are reached", () => {
    expect(limitHit({ elapsedMs: 999_999, bytes: STOP_BYTES }, 120)).toBe("size");
  });
});

describe("stopwatch", () => {
  it("does not count the time spent paused", () => {
    let now = 1000;
    const w = new Stopwatch(() => now);
    w.start();
    now += 2000;
    w.pause();
    now += 5000; // paused
    expect(w.ms).toBe(2000);
    w.start();
    now += 1500;
    expect(w.ms).toBe(3500);
    w.pause();
    w.pause();
    expect(w.ms).toBe(3500);
  });
  it("starts at zero and ignores a second start", () => {
    let now = 50;
    const w = new Stopwatch(() => now);
    expect(w.ms).toBe(0);
    w.start();
    now += 100;
    w.start();
    now += 100;
    expect(w.ms).toBe(200);
  });
});

describe("text", () => {
  it("formats the clock", () => {
    expect(clockText(0)).toBe("0:00");
    expect(clockText(7_400)).toBe("0:07");
    expect(clockText(65_000)).toBe("1:05");
    expect(clockText(120_000)).toBe("2:00");
    expect(clockText(-5)).toBe("0:00");
  });
  it("formats sizes", () => {
    expect(sizeText(100)).toBe("1 KB");
    expect(sizeText(640 * 1024)).toBe("640 KB");
    expect(sizeText(4.2 * 1048576)).toBe("4.2 MB");
  });
});

describe("failures", () => {
  it("tells a refusal from an unsupported browser from a bug", () => {
    expect(failKey(new DOMException("denied", "NotAllowedError"))).toBe("recDenied");
    expect(failKey(new DOMException("closed", "AbortError"))).toBe("recDenied");
    expect(failKey(new DOMException("no", "NotSupportedError"))).toBe("recUnsupported");
    expect(failKey(new TypeError("x"))).toBe("recUnsupported");
    expect(failKey(new Error("boom"))).toBe("recFailed");
    expect(failKey("string")).toBe("recFailed");
    expect(failKey(null)).toBe("recFailed");
  });
});

describe("config from the server", () => {
  it("is off unless the server says on", () => {
    expect(resolveRecording(undefined).enabled).toBe(false);
    expect(resolveRecording({}).enabled).toBe(false);
    expect(resolveRecording({ enabled: "yes" }).enabled).toBe(false);
    expect(resolveRecording({ enabled: true }).enabled).toBe(true);
  });
  it("keeps the length inside the hard cap and the microphone on by default", () => {
    expect(resolveRecording({ enabled: true }).maxSeconds).toBe(120);
    expect(resolveRecording({ maxSeconds: 45 }).maxSeconds).toBe(45);
    expect(resolveRecording({ maxSeconds: 5000 }).maxSeconds).toBe(120);
    expect(resolveRecording({ maxSeconds: 1 }).maxSeconds).toBe(120);
    expect(resolveRecording({ maxSeconds: Number.NaN }).maxSeconds).toBe(120);
    expect(resolveRecording({}).microphone).toBe(true);
    expect(resolveRecording({ microphone: false }).microphone).toBe(false);
  });
});

describe("support check", () => {
  it("needs a secure page, getDisplayMedia and MediaRecorder", () => {
    const g = globalThis as unknown as { MediaRecorder?: unknown };
    const nav = navigator as unknown as { mediaDevices?: unknown };
    const keep = { mr: g.MediaRecorder, md: nav.mediaDevices };
    try {
      g.MediaRecorder = vi.fn();
      Object.defineProperty(navigator, "mediaDevices", {
        value: { getDisplayMedia: () => Promise.resolve() },
        configurable: true,
      });
      expect(canRecord({ isSecureContext: true })).toBe(true);
      expect(canRecord({ isSecureContext: false })).toBe(false);
      g.MediaRecorder = undefined;
      expect(canRecord({ isSecureContext: true })).toBe(false);
      g.MediaRecorder = vi.fn();
      Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
      expect(canRecord({ isSecureContext: true })).toBe(false);
    } finally {
      g.MediaRecorder = keep.mr;
      Object.defineProperty(navigator, "mediaDevices", { value: keep.md, configurable: true });
    }
  });
});
