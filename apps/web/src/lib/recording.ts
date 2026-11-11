import type { Asset } from "@/lib/api";

// Screen recordings (ADR 0029) arrive as attachments whose `meta` says so. These helpers keep that knowledge in
// one place: which assets are recordings, what their metadata can be trusted to say, and the clock text.

export type RecordingMeta = {
  durationMs: number;
  audio: boolean;
  width: number | null;
  height: number | null;
};

/** A recording is a video attachment the widget flagged (`meta.recording`); anything else is an ordinary file. */
export const isRecording = (a: Pick<Asset, "kind" | "contentType" | "meta">): boolean =>
  a.kind === "attachment" && a.contentType.startsWith("video/") && a.meta?.recording === true;

const positive = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;

/** The recording's metadata, defensively: it was written by the server but originates in a browser. */
export function recordingMeta(a: Pick<Asset, "meta">): RecordingMeta {
  const m = a.meta ?? {};
  return {
    durationMs: Math.round(positive(m.durationMs) ?? 0),
    audio: m.audio === true,
    width: positive(m.width),
    height: positive(m.height),
  };
}

/** `0:07`, `1:05`, `12:30`; one decimal-free format for the timer, the slider text and the details line. */
export function clock(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * A browser-made WebM has no duration in its header (the player reports `Infinity` until it has read the whole
 * file), so the length the widget measured stands in for it.
 */
export function playableDuration(videoSeconds: number, metaMs: number): number {
  if (Number.isFinite(videoSeconds) && videoSeconds > 0) return videoSeconds;
  return metaMs / 1000;
}

/** Width over height for the player's box, so it doesn't jump when the first frame arrives. */
export function aspectOf(m: Pick<RecordingMeta, "width" | "height">): number {
  const r = m.width && m.height ? m.width / m.height : 16 / 9;
  return Math.min(3, Math.max(0.4, r));
}
