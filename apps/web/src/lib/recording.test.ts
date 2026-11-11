import { describe, expect, it } from "vitest";
import { aspectOf, clock, isRecording, playableDuration, recordingMeta } from "./recording";

const asset = (over: Record<string, unknown> = {}) => ({
  kind: "attachment",
  contentType: "video/webm",
  meta: { recording: true, durationMs: 4200, audio: true, width: 1280, height: 720 },
  ...over,
});

describe("isRecording", () => {
  it("is a flagged video attachment", () => {
    expect(isRecording(asset())).toBe(true);
    expect(isRecording(asset({ contentType: "video/mp4" }))).toBe(true);
  });
  it("is not a screenshot, a replay, an ordinary file or an unflagged video", () => {
    expect(isRecording(asset({ kind: "screenshot" }))).toBe(false);
    expect(isRecording(asset({ kind: "replay", contentType: "application/gzip" }))).toBe(false);
    expect(isRecording(asset({ contentType: "application/pdf" }))).toBe(false);
    expect(isRecording(asset({ meta: null }))).toBe(false);
    expect(isRecording(asset({ meta: { durationMs: 1 } }))).toBe(false);
    expect(isRecording(asset({ meta: { recording: "yes" } }))).toBe(false);
  });
});

describe("recordingMeta", () => {
  it("reads what the server stored", () => {
    expect(recordingMeta(asset())).toEqual({ durationMs: 4200, audio: true, width: 1280, height: 720 });
  });
  it("does not trust a missing or odd value", () => {
    expect(recordingMeta({ meta: null })).toEqual({ durationMs: 0, audio: false, width: null, height: null });
    expect(recordingMeta({ meta: { durationMs: "5", audio: "yes", width: -1, height: Number.NaN } })).toEqual(
      { durationMs: 0, audio: false, width: null, height: null },
    );
    expect(recordingMeta({ meta: { durationMs: 1234.6 } }).durationMs).toBe(1235);
  });
});

describe("clock", () => {
  it("formats minutes and seconds", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(7.9)).toBe("0:07");
    expect(clock(65)).toBe("1:05");
    expect(clock(600)).toBe("10:00");
  });
  it("shows zero for what isn't a time", () => {
    expect(clock(Number.NaN)).toBe("0:00");
    expect(clock(Number.POSITIVE_INFINITY)).toBe("0:00");
    expect(clock(-3)).toBe("0:00");
  });
});

describe("playableDuration", () => {
  it("uses the player's duration when it knows it", () => {
    expect(playableDuration(12.5, 4200)).toBe(12.5);
  });
  it("falls back to the measured length while the player says Infinity or NaN", () => {
    expect(playableDuration(Number.POSITIVE_INFINITY, 4200)).toBe(4.2);
    expect(playableDuration(Number.NaN, 4200)).toBe(4.2);
    expect(playableDuration(0, 4200)).toBe(4.2);
  });
});

describe("aspectOf", () => {
  it("is the video's own shape, 16:9 when unknown, and never absurd", () => {
    expect(aspectOf({ width: 1280, height: 720 })).toBeCloseTo(16 / 9);
    expect(aspectOf({ width: null, height: null })).toBeCloseTo(16 / 9);
    expect(aspectOf({ width: 10_000, height: 100 })).toBe(3);
    expect(aspectOf({ width: 100, height: 10_000 })).toBe(0.4);
  });
});
