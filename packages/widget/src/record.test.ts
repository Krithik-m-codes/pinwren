// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type RecordCtx, mount } from "./record";
import { STOP_BYTES } from "./record-logic";

// A browser's screen capture, faked: tracks that count their stops, a recorder that emits what we tell it to.
class FakeTrack {
  stopped = false;
  private ends: (() => void)[] = [];
  constructor(readonly kind: "video" | "audio") {}
  stop() {
    this.stopped = true;
  }
  getSettings() {
    return { width: 1280, height: 720 };
  }
  addEventListener(type: string, fn: () => void) {
    if (type === "ended") this.ends.push(fn);
  }
  end() {
    for (const f of this.ends) f();
  }
}
class FakeStream {
  constructor(private readonly tracks: FakeTrack[] = []) {}
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
}
let recorders: FakeRecorder[] = [];
class FakeRecorder {
  static isTypeSupported = (m: string) => m === "video/webm;codecs=vp9" || m === "video/webm;codecs=vp9,opus";
  state: "inactive" | "recording" | "paused" = "inactive";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  started: number | undefined;
  constructor(
    readonly stream: FakeStream,
    readonly options: { mimeType?: string; videoBitsPerSecond?: number; audioBitsPerSecond?: number },
  ) {
    this.mimeType = options.mimeType ?? "";
    recorders.push(this);
  }
  start(slice?: number) {
    this.state = "recording";
    this.started = slice;
  }
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
  }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.emit(new Blob(["\x1aE\xdf\xa3tail"], { type: "video/webm" }));
    this.onstop?.();
  }
  emit(data: Blob) {
    this.ondataavailable?.({ data });
  }
}

let video: FakeTrack;
let mic: FakeTrack | null;
let ctx: RecordCtx;
let root: HTMLElement;
let display: ReturnType<typeof vi.fn>;
let userMedia: ReturnType<typeof vi.fn>;
let revoke: ReturnType<typeof vi.fn>;

const made: ReturnType<typeof mount>[] = [];
/** A recording on the test page, torn down after the test so no key listener leaks into the next one. */
function make(c: RecordCtx = ctx) {
  const r = mount(c);
  made.push(r);
  root.append(r.row);
  return r;
}
const text = () => root.textContent;
const click = (el: Element | null | undefined) => {
  if (el instanceof HTMLElement) el.click();
};
const btn = (label: RegExp) =>
  Array.from(root.querySelectorAll("button")).find((b) =>
    label.test(b.textContent || b.getAttribute("aria-label") || ""),
  );
/** Let the 3-2-1 countdown and the two frames before the first recorded frame pass. */
const countdown = () => vi.advanceTimersByTimeAsync(3000 + 100);

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "performance",
      "Date",
    ],
  });
  recorders = [];
  video = new FakeTrack("video");
  mic = new FakeTrack("audio");
  display = vi.fn(() => Promise.resolve(new FakeStream([video])));
  userMedia = vi.fn(() => Promise.resolve(new FakeStream(mic ? [mic] : [])));
  (globalThis as unknown as Record<string, unknown>).MediaRecorder = FakeRecorder;
  (globalThis as unknown as Record<string, unknown>).MediaStream = FakeStream;
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getDisplayMedia: display, getUserMedia: userMedia },
    configurable: true,
  });
  // happy-dom leaves it undefined; browsers only offer screen capture on secure pages.
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  let n = 0;
  URL.createObjectURL = () => `blob:fake/${++n}`;
  revoke = vi.fn();
  URL.revokeObjectURL = revoke as unknown as typeof URL.revokeObjectURL;
  root = document.createElement("div");
  document.body.append(root);
  ctx = {
    root,
    cfg: { enabled: true, maxSeconds: 120, microphone: true },
    hide: vi.fn(),
    toast: vi.fn(),
    changed: vi.fn(),
  };
});

afterEach(() => {
  for (const r of made.splice(0)) r.destroy();
  root.remove();
  vi.useRealTimers();
});

/** Open the dialog, press Start and get through the countdown: the recorder is running afterwards. */
async function startRecording(rec: ReturnType<typeof mount>, withMic = false) {
  root.append(rec.button);
  click(rec.button);
  if (withMic) click(root.querySelector("[role=switch]"));
  click(btn(/Start recording/));
  await vi.advanceTimersByTimeAsync(0);
  await countdown();
}

describe("opening", () => {
  it("explains what is recorded before asking the browser for anything", () => {
    const rec = make(ctx);
    root.append(rec.button);
    click(rec.button);
    expect(root.querySelector("[role=dialog]")).not.toBeNull();
    expect(text()).toContain("anything visible on it is included");
    expect(text()).toContain("Nothing is uploaded until you send the report");
    expect(display).not.toHaveBeenCalled();
    expect(userMedia).not.toHaveBeenCalled();
  });
  it("offers narration only when the project allows it", () => {
    const rec = make({ ...ctx, cfg: { ...ctx.cfg, microphone: false } });
    root.append(rec.button);
    click(rec.button);
    expect(root.querySelector("[role=switch]")).toBeNull();
  });
  it("closes with Cancel and leaves the page as it was", () => {
    const rec = make(ctx);
    root.append(rec.button);
    click(rec.button);
    click(btn(/Cancel/));
    expect(root.querySelector("[role=dialog]")).toBeNull();
    expect(ctx.hide).not.toHaveBeenCalled();
    expect(display).not.toHaveBeenCalled();
  });
  it("says so, and cannot start, when the browser has no screen capture", () => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    const rec = make(ctx);
    root.append(rec.button);
    click(rec.button);
    expect(text()).toContain("can't record the screen");
    expect(btn(/Start recording/)?.disabled).toBe(true);
  });
});

describe("recording", () => {
  it("asks for the tab, hides the widget through the countdown, then records in one-second slices", async () => {
    const rec = make(ctx);
    await startRecording(rec);
    expect(display).toHaveBeenCalledTimes(1);
    expect(display.mock.calls[0]?.[0]).toMatchObject({ audio: false, preferCurrentTab: true });
    expect(ctx.hide).toHaveBeenCalledWith(true);
    expect(recorders).toHaveLength(1);
    expect(recorders[0]?.started).toBe(1000);
    expect(recorders[0]?.options.mimeType).toBe("video/webm;codecs=vp9");
    expect(root.querySelector(".rc-count")).toBeNull();
    // the controls are in the corner, not in a dialog
    expect(root.querySelector(".rc-zone [role=group]")).not.toBeNull();
    expect(root.querySelector("[role=dialog]")).toBeNull();
  });

  it("shows a live timer and pauses without counting the paused time", async () => {
    const rec = make(ctx);
    await startRecording(rec);
    await vi.advanceTimersByTimeAsync(5000);
    expect(root.querySelector(".rc-time")?.textContent).toBe("0:05 of 2:00");
    click(btn(/Pause recording/));
    expect(recorders[0]?.state).toBe("paused");
    expect(root.querySelector(".rc-state")?.textContent).toBe("Paused");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(root.querySelector(".rc-time")?.textContent).toBe("0:05 of 2:00");
    click(btn(/Resume recording/));
    expect(recorders[0]?.state).toBe("recording");
    await vi.advanceTimersByTimeAsync(2000);
    expect(root.querySelector(".rc-time")?.textContent).toBe("0:07 of 2:00");
  });

  it("stops with the button, lets the person review, and hands over a webm", async () => {
    const rec = make(ctx);
    await startRecording(rec);
    await vi.advanceTimersByTimeAsync(4000);
    click(btn(/Stop recording/));
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.hide).toHaveBeenLastCalledWith(false);
    const player = root.querySelector("video");
    expect(player?.getAttribute("controls")).not.toBeNull();
    expect(player?.getAttribute("aria-label")).toBe("Preview of your recording");
    expect(text()).toContain("0:04");
    // nothing is attached until the person says so
    expect(rec.attached).toBe(false);
    click(btn(/Attach recording/));
    await vi.advanceTimersByTimeAsync(0);
    expect(rec.attached).toBe(true);
    expect(ctx.toast).toHaveBeenCalledWith("Recording attached");
    expect(ctx.changed).toHaveBeenCalled();
    expect(rec.row.hidden).toBe(false);
    expect(rec.row.textContent).toContain("Screen recording · 0:04");
    const payload = await rec.pack();
    expect(payload?.dataUrl.startsWith("data:video/webm;base64,")).toBe(true);
    expect(payload).toMatchObject({ audio: false, width: 1280, height: 720 });
    expect(payload?.durationMs).toBeGreaterThanOrEqual(4000);
    expect(payload?.durationMs).toBeLessThan(4300);
  });

  it("finishes when the browser's own Stop sharing ends the track", async () => {
    const rec = make(ctx);
    await startRecording(rec);
    await vi.advanceTimersByTimeAsync(2000);
    video.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(root.querySelector("video")).not.toBeNull();
    expect(video.stopped).toBe(true);
  });

  it("stops by itself at the project's length and says why", async () => {
    const rec = make({ ...ctx, cfg: { ...ctx.cfg, maxSeconds: 10 } });
    await startRecording(rec);
    await vi.advanceTimersByTimeAsync(10_500);
    expect(root.querySelector("video")).not.toBeNull();
    expect(text()).toContain("reached the maximum length (0:10)");
    expect(recorders[0]?.state).toBe("inactive");
  });

  it("stops before the size cap", async () => {
    const rec = make(ctx);
    await startRecording(rec);
    await vi.advanceTimersByTimeAsync(2000);
    recorders[0]?.emit(new Blob([new Uint8Array(STOP_BYTES)]));
    await vi.advanceTimersByTimeAsync(0);
    expect(text()).toContain("reached its size limit");
    expect(recorders[0]?.state).toBe("inactive");
  });

  it("records voice when asked and tells the clip so", async () => {
    const rec = make(ctx);
    await startRecording(rec, true);
    expect(userMedia).toHaveBeenCalledTimes(1);
    expect(recorders[0]?.options.mimeType).toBe("video/webm;codecs=vp9,opus");
    expect(recorders[0]?.options.audioBitsPerSecond).toBe(48_000);
    await vi.advanceTimersByTimeAsync(3000);
    click(btn(/Stop recording/));
    await vi.advanceTimersByTimeAsync(0);
    click(btn(/Attach recording/));
    await vi.advanceTimersByTimeAsync(0);
    expect((await rec.pack())?.audio).toBe(true);
    expect(rec.row.textContent).toContain("with voice");
    expect(mic?.stopped).toBe(true);
  });

  it("carries on without sound when the microphone is refused", async () => {
    userMedia.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    const rec = make(ctx);
    await startRecording(rec, true);
    await vi.advanceTimersByTimeAsync(2000);
    click(btn(/Stop recording/));
    await vi.advanceTimersByTimeAsync(0);
    expect(text()).toContain("microphone isn't available");
    click(btn(/Attach recording/));
    await vi.advanceTimersByTimeAsync(0);
    expect((await rec.pack())?.audio).toBe(false);
  });
});

describe("refusals", () => {
  it("says so and lets the person try again when the share prompt is dismissed", async () => {
    display.mockRejectedValueOnce(new DOMException("no", "NotAllowedError"));
    const rec = make(ctx);
    root.append(rec.button);
    click(rec.button);
    click(btn(/Start recording/));
    await vi.advanceTimersByTimeAsync(0);
    expect(text()).toContain("cancelled or blocked");
    expect(ctx.hide).not.toHaveBeenCalledWith(true);
    expect(btn(/Start recording/)?.disabled).toBe(false);
    // and the second try works
    click(btn(/Start recording/));
    await vi.advanceTimersByTimeAsync(0);
    await countdown();
    expect(recorders).toHaveLength(1);
  });

  it("explains a browser that cannot encode", async () => {
    display.mockRejectedValueOnce(new DOMException("no", "NotSupportedError"));
    const rec = make(ctx);
    root.append(rec.button);
    click(rec.button);
    click(btn(/Start recording/));
    await vi.advanceTimersByTimeAsync(0);
    expect(text()).toContain("can't record the screen");
  });

  it("stops the tracks of a share the person cancelled while the prompt was open", async () => {
    let grant: (s: FakeStream) => void = () => undefined;
    display.mockReturnValueOnce(new Promise<FakeStream>((r) => (grant = r)));
    const rec = make(ctx);
    root.append(rec.button);
    click(rec.button);
    click(btn(/Start recording/));
    click(btn(/Cancel/));
    grant(new FakeStream([video]));
    await vi.advanceTimersByTimeAsync(0);
    expect(video.stopped).toBe(true);
    expect(recorders).toHaveLength(0);
    expect(root.querySelector("[role=dialog]")).toBeNull();
  });
});

describe("review", () => {
  async function recorded() {
    const rec = make(ctx);
    await startRecording(rec);
    await vi.advanceTimersByTimeAsync(3000);
    click(btn(/Stop recording/));
    await vi.advanceTimersByTimeAsync(0);
    return rec;
  }
  it("discards without attaching anything", async () => {
    const rec = await recorded();
    click(btn(/Discard/));
    expect(rec.attached).toBe(false);
    expect(root.querySelector("video")).toBeNull();
    expect(await rec.pack()).toBeNull();
    expect(revoke).toHaveBeenCalled();
  });
  it("goes back to setup to record again", async () => {
    const rec = await recorded();
    click(btn(/Record again/));
    expect(text()).toContain("Record your screen");
    expect(rec.attached).toBe(false);
  });
  it("removes an attached clip", async () => {
    const rec = await recorded();
    click(btn(/Attach recording/));
    await vi.advanceTimersByTimeAsync(0);
    click(btn(/Remove recording/));
    expect(rec.attached).toBe(false);
    expect(rec.row.hidden).toBe(true);
    expect(await rec.pack()).toBeNull();
  });
  it("lets an attached clip be played again", async () => {
    const rec = await recorded();
    click(btn(/Attach recording/));
    await vi.advanceTimersByTimeAsync(0);
    click(btn(/Play recording/));
    expect(root.querySelector("video")).not.toBeNull();
    click(btn(/Close/));
    expect(root.querySelector("video")).toBeNull();
    expect(rec.attached).toBe(true);
  });
});

describe("cleanup", () => {
  it("stops every track and puts the widget back when the report closes mid-recording", async () => {
    const rec = make(ctx);
    await startRecording(rec, true);
    await vi.advanceTimersByTimeAsync(2000);
    rec.destroy();
    expect(video.stopped).toBe(true);
    expect(mic?.stopped).toBe(true);
    expect(recorders[0]?.state).toBe("inactive");
    expect(ctx.hide).toHaveBeenLastCalledWith(false);
    expect(root.querySelector(".rc-zone")).toBeNull();
    // no timer is left running: nothing fires and nothing throws
    await vi.advanceTimersByTimeAsync(20_000);
    expect(root.querySelector("[role=dialog]")).toBeNull();
  });
  it("releases the object URLs of clips it still holds", async () => {
    const rec = make(ctx);
    await startRecording(rec);
    await vi.advanceTimersByTimeAsync(2000);
    click(btn(/Stop recording/));
    await vi.advanceTimersByTimeAsync(0);
    click(btn(/Attach recording/));
    await vi.advanceTimersByTimeAsync(0);
    rec.destroy();
    expect(revoke).toHaveBeenCalledWith("blob:fake/1");
  });
  it("stops the tracks when the recorder cannot be created", async () => {
    (globalThis as unknown as Record<string, unknown>).MediaRecorder = class extends FakeRecorder {
      constructor(s: FakeStream, o: never) {
        super(s, o);
        throw new DOMException("bad", "NotSupportedError");
      }
    };
    (globalThis.MediaRecorder as unknown as { isTypeSupported: (m: string) => boolean }).isTypeSupported =
      () => true;
    const rec = make(ctx);
    root.append(rec.button);
    click(rec.button);
    click(btn(/Start recording/));
    await vi.advanceTimersByTimeAsync(0);
    expect(video.stopped).toBe(true);
    expect(text()).toContain("can't record the screen");
  });
});

describe("controls out of the picture", () => {
  it("puts the controls in a Document Picture-in-Picture window when the browser offers one", async () => {
    const pipDoc = document.implementation.createHTMLDocument("pip");
    const closed = vi.fn();
    const pip = Object.assign(new EventTarget(), {
      document: pipDoc,
      close: closed,
      CSSStyleSheet: class {
        replaceSync() {
          /* styles are not under test */
        }
      },
    });
    Object.defineProperty(pipDoc, "adoptedStyleSheets", { value: [], writable: true });
    (window as unknown as { documentPictureInPicture: unknown }).documentPictureInPicture = {
      requestWindow: vi.fn(() => Promise.resolve(pip)),
    };
    try {
      const rec = make(ctx);
      await startRecording(rec);
      expect(pipDoc.body.querySelector("[role=group]")).not.toBeNull();
      expect(root.querySelector(".rc-zone")).toBeNull(); // nothing of the controls on the page itself
      click(pipDoc.body.querySelector<HTMLElement>("[aria-label='Stop recording']"));
      await vi.advanceTimersByTimeAsync(0);
      expect(closed).toHaveBeenCalled();
    } finally {
      delete (window as unknown as { documentPictureInPicture?: unknown }).documentPictureInPicture;
    }
  });
  it("falls back to the corner when the PiP window is refused", async () => {
    (window as unknown as { documentPictureInPicture: unknown }).documentPictureInPicture = {
      requestWindow: vi.fn(() => Promise.reject(new DOMException("no activation", "NotAllowedError"))),
    };
    try {
      const rec = make(ctx);
      await startRecording(rec);
      expect(root.querySelector(".rc-zone [role=group]")).not.toBeNull();
    } finally {
      delete (window as unknown as { documentPictureInPicture?: unknown }).documentPictureInPicture;
    }
  });
  it("stops with Alt+Shift+S and pauses with Alt+Shift+P while the controls are hidden", async () => {
    const rec = make(ctx);
    await startRecording(rec);
    await vi.advanceTimersByTimeAsync(1000);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyP", altKey: true, shiftKey: true }));
    expect(recorders[0]?.state).toBe("paused");
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyP", altKey: true, shiftKey: true }));
    expect(recorders[0]?.state).toBe("recording");
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyS", altKey: true, shiftKey: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(root.querySelector("video")).not.toBeNull();
  });
  it("leaves Escape to the page while recording", async () => {
    const rec = make(ctx);
    await startRecording(rec);
    const e = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(recorders[0]?.state).toBe("recording");
  });
});
