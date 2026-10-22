// Session replay (F-007, blueprint 05 §7, wave-4 §3) — the lazy widget-replay.js chunk: rrweb's recorder
// feeding a rolling in-memory buffer. Nothing leaves the page until a bug report is sent with it.
//
// Privacy: every input is masked, `.pinwren-block` / `[data-pinwren-ignore]` / the widget itself are not
// recorded, `.pinwren-mask` / `[data-pinwren-mask]` / the project's mask selectors have their text replaced,
// and in privacy mode (when the host explicitly allowed replay there) all text is masked.
import { record } from "@rrweb/record";
import type { ReplayPayload } from "./config";
import { type Frozen, gzipEvents, META, ReplayBuffer, toDataUrl } from "./replay-buffer";

/** rrweb's EventType.FullSnapshot. */
const FULL_SNAPSHOT = 2;

/** ~6 M characters of JSON (a few MB of memory) — far more than a minute of a normal page needs. */
const MAX_CHARS = 6_000_000;
/** The API accepts 10 MB of decoded gzip (wave-4 §3). */
const MAX_UPLOAD = 10 * 1024 * 1024;

export type ReplayOptions = {
  seconds: number;
  /** Extra selectors whose text is masked (the project's `capture.maskSelectors`). */
  maskSelectors: string[];
  /** Mask all text, not just inputs. */
  maskAllText: boolean;
};

export type Recorder = {
  /** The buffer as it is now; null when there is nothing to play yet (or recording stopped). */
  freeze(): Frozen | null;
  stop(): void;
};

function startReplay(o: ReplayOptions): Recorder | null {
  const buffer = new ReplayBuffer(o.seconds * 1000, MAX_CHARS);
  let stopped = false;
  let stopRecording: (() => void) | undefined;
  /** A fresh full snapshot was requested because the buffer hit its cap. */
  let snapshotDue = false;
  const stop = () => {
    stopped = true;
    try {
      stopRecording?.();
    } catch {
      // rrweb's teardown failing must not reach the page
    }
    buffer.clear();
  };
  const mask = ["[data-pinwren-mask]", ...o.maskSelectors].join(",");
  try {
    stopRecording = record({
      emit(event) {
        if (stopped) return;
        try {
          const type: number = event.type;
          if (buffer.push(JSON.stringify(event), type, event.timestamp)) return;
          // Over the memory cap. A full snapshot that alone is too big means this page can't be buffered;
          // otherwise start a new segment, which lets the old ones go.
          if (type === META || type === FULL_SNAPSHOT) {
            console.warn("[pinwren] session replay stopped: the page is too large to buffer");
            stop();
          } else if (!snapshotDue) {
            snapshotDue = true;
            queueMicrotask(() => {
              snapshotDue = false;
              if (!stopped) record.takeFullSnapshot(true);
            });
          }
        } catch {
          // an event that can't be serialised is skipped
        }
      },
      checkoutEveryNms: 10_000,
      maskAllInputs: true,
      blockClass: "pinwren-block",
      blockSelector: "pinwren-root,[data-pinwren-ignore]",
      maskTextClass: "pinwren-mask",
      maskTextSelector: o.maskAllText ? "*" : mask,
      sampling: { mousemove: 50, scroll: 150, media: 800, input: "last" },
      slimDOMOptions: "all",
      inlineStylesheet: true,
      recordCanvas: false,
      collectFonts: false,
      inlineImages: false,
      recordCrossOriginIframes: false,
      // rrweb's own failures are swallowed (returning true): the host page never sees them.
      errorHandler: () => true,
    });
  } catch (err) {
    console.warn("[pinwren] session replay unavailable:", err);
    stop();
    return null;
  }
  // The first snapshot is emitted inside record(): if it was already too big, stop() ran before rrweb had
  // handed back its teardown.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- emit() can set `stopped` inside record()
  if (stopped || !stopRecording) {
    stop();
    return null;
  }
  return {
    freeze: () => (stopped ? null : buffer.freeze()),
    stop,
  };
}

/** Gzip a frozen buffer into the `replay` field of `POST /w/feedback`; null if it can't be sent. */
async function pack(f: Frozen): Promise<ReplayPayload | null> {
  const gz = await gzipEvents(f.events);
  if (gz.size > MAX_UPLOAD) return null;
  return {
    dataUrl: await toDataUrl(gz),
    durationMs: Math.max(0, Math.round(f.last - f.first)),
    events: f.events.length,
  };
}

export type ReplayModule = { startReplay: typeof startReplay; pack: typeof pack };
(window as unknown as { __pinwrenReplay: ReplayModule }).__pinwrenReplay = { startReplay, pack };
