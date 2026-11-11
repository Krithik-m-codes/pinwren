// The rules behind "Record screen" (ADR 0029): which phases a recording moves through, what format and bitrate
// to ask the browser for, when to stop, and how a failure reads to the reporter. Pure functions, so the
// limits and the state machine are unit-tested without a browser; record.ts is the DOM and media glue.

export const MAX_RECORDING_BYTES = 16 * 1024 * 1024;
/** Stop a little short of the cap: the chunk being written when it is reached still has to fit. */
export const STOP_BYTES = MAX_RECORDING_BYTES - 1024 * 1024;
/** The longest clip any setting allows (the server enforces the same cap). */
export const HARD_MAX_SECONDS = 300;
export const DEFAULT_MAX_SECONDS = 120;
export const COUNTDOWN_SECONDS = 3;

export type RecordingCfg = { enabled: boolean; maxSeconds: number; microphone: boolean };

/** `capture.recording` of `GET /w/config`, which the core passes along unchecked: validate it here. */
export function resolveRecording(raw: unknown): RecordingCfg {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const s = typeof r.maxSeconds === "number" && Number.isFinite(r.maxSeconds) ? Math.round(r.maxSeconds) : 0;
  return {
    // The server resolves the privacy-mode default, so anything but an explicit `true` means off.
    enabled: r.enabled === true,
    maxSeconds: s >= 10 && s <= HARD_MAX_SECONDS ? s : DEFAULT_MAX_SECONDS,
    microphone: r.microphone !== false,
  };
}

// --- Phases -------------------------------------------------------------------------------------

export type Phase =
  | "idle" // nothing open
  | "setup" // the notice + microphone choice (also where a failure is explained)
  | "requesting" // the browser's own share prompt
  | "countdown" // 3, 2, 1
  | "recording"
  | "paused"
  | "stopping" // MediaRecorder is flushing its last chunk
  | "preview";

export type Ev =
  | "open"
  | "start"
  | "granted"
  | "go" // the countdown reached zero
  | "pause"
  | "resume"
  | "stop" // the person, a limit, or the browser's own "Stop sharing"
  | "finalized"
  | "retake"
  | "close" // discard, attach, or cancel: back to idle
  | "fail"; // back to setup, with the reason shown

const FLOW: Record<Phase, Partial<Record<Ev, Phase>>> = {
  idle: { open: "setup" },
  setup: { start: "requesting", close: "idle" },
  requesting: { granted: "countdown", fail: "setup", close: "idle" },
  countdown: { go: "recording", stop: "idle", fail: "setup", close: "idle" },
  recording: { pause: "paused", stop: "stopping", fail: "setup" },
  paused: { resume: "recording", stop: "stopping", fail: "setup" },
  stopping: { finalized: "preview", fail: "setup" },
  preview: { retake: "setup", close: "idle" },
};

/** The phase after `ev`; an event that makes no sense in `from` leaves it where it is. */
export const advance = (from: Phase, ev: Ev): Phase => FLOW[from][ev] ?? from;

/** Phases in which the capture is running or about to: the page's own widget UI must be out of the way. */
export const isBusy = (p: Phase) =>
  p === "requesting" || p === "countdown" || p === "recording" || p === "paused" || p === "stopping";

// --- Format and size ----------------------------------------------------------------------------

/** Best first: WebM (VP9, then VP8) where it exists, MP4 for Safari. Audio codecs only when there is a voice. */
export function mimeCandidates(audio: boolean): string[] {
  return [
    `video/webm;codecs=vp9${audio ? ",opus" : ""}`,
    `video/webm;codecs=vp8${audio ? ",opus" : ""}`,
    "video/webm",
    `video/mp4;codecs=avc1.42E01E${audio ? ",mp4a.40.2" : ""}`,
    "video/mp4",
  ];
}

export function pickMime(supported: (mime: string) => boolean, audio: boolean): string | null {
  return mimeCandidates(audio).find((m) => supported(m)) ?? null;
}

/** The type the file is stored as: no codec parameter, and only the two the server accepts. */
export const baseType = (mime: string): "video/webm" | "video/mp4" =>
  mime.toLowerCase().startsWith("video/mp4") ? "video/mp4" : "video/webm";

const AUDIO_BPS = 48_000;
/**
 * Spend the size budget evenly over the longest clip allowed, so a clip that runs the whole time still fits
 * (with 15 % to spare for container overhead and bursts), within what a screen recording needs to stay legible.
 */
export function bitrates(maxSeconds: number, audio: boolean): { video: number; audio: number } {
  const total = (MAX_RECORDING_BYTES * 8 * 0.85) / Math.max(1, maxSeconds);
  const voice = audio ? AUDIO_BPS : 0;
  return { video: Math.round(Math.min(2_500_000, Math.max(250_000, total - voice))), audio: AUDIO_BPS };
}

// --- Limits -------------------------------------------------------------------------------------

export type Progress = { elapsedMs: number; bytes: number };

/** Why a recording must stop now, if it must. */
export function limitHit(p: Progress, maxSeconds: number): "time" | "size" | null {
  if (p.bytes >= STOP_BYTES) return "size";
  return p.elapsedMs >= Math.min(maxSeconds, HARD_MAX_SECONDS) * 1000 ? "time" : null;
}

/** Elapsed recording time without the time spent paused. `now` is injectable for tests. */
export class Stopwatch {
  private base = 0;
  private since: number | null = null;
  constructor(private readonly now: () => number = () => performance.now()) {}
  start() {
    this.since ??= this.now();
  }
  pause() {
    if (this.since !== null) this.base += this.now() - this.since;
    this.since = null;
  }
  get ms() {
    return this.base + (this.since === null ? 0 : this.now() - this.since);
  }
}

/** `0:07`, `1:05`, `12:30`. */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The size of a clip for people: `640 KB`, `4.2 MB`. */
export const sizeText = (n: number) =>
  n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`;

// --- Failures -----------------------------------------------------------------------------------

export type FailKey = "recDenied" | "recUnsupported" | "recFailed";

/** What to tell the reporter: they said no (or closed the prompt), the browser can't, or something broke. */
export function failKey(err: unknown): FailKey {
  const name = err instanceof DOMException || err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "AbortError") return "recDenied";
  if (name === "NotSupportedError" || name === "TypeError" || name === "NotFoundError")
    return "recUnsupported";
  return "recFailed";
}

/** Whether this browser can record a screen at all (secure page, getDisplayMedia, MediaRecorder). */
export function canRecord(w: Pick<Window, "isSecureContext"> = window): boolean {
  const devices = navigator.mediaDevices as MediaDevices | undefined;
  return (
    w.isSecureContext &&
    !!devices &&
    typeof devices.getDisplayMedia === "function" &&
    typeof MediaRecorder !== "undefined"
  );
}
