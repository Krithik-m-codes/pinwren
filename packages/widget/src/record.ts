// "Record screen" — the lazy widget-record.js chunk (ADR 0029). The reporter records their tab with optional
// voice narration, reviews the clip, and it rides along with the bug report. The rules (phases, format,
// limits) are in record-logic.ts; this file is the DOM and media glue.
//
// The capture must not show the widget: the report and launcher are hidden before the first frame is
// recorded. The controls live where the capture can't see them: a Document Picture-in-Picture window when the
// browser offers one, otherwise a corner that appears only under the pointer (and keyboard shortcuts).
import { adoptStyle, h, icon, trapFocus } from "./dom";
import { addEnglish, t } from "./i18n";
import * as I from "./icons";
import { enRecord } from "./locales/en-record";
import {
  advance,
  baseType,
  bitrates,
  canRecord,
  clockText,
  COUNTDOWN_SECONDS,
  type Ev,
  failKey,
  isBusy,
  limitHit,
  MAX_RECORDING_BYTES,
  type Phase,
  pickMime,
  type RecordingCfg,
  resolveRecording,
  sizeText,
  Stopwatch,
} from "./record-logic";
import { PIP_CSS, RECORD_CSS } from "./record-styles";

addEnglish(enRecord); // this module is part of widget-record.js, which brings its own English

export type RecordingPayload = {
  dataUrl: string;
  durationMs: number;
  audio: boolean;
  width?: number;
  height?: number;
};

export type RecordCtx = {
  root: HTMLElement;
  cfg: RecordingCfg;
  /** Hide (true) or restore the rest of the widget; the capture must not show it. */
  hide: (on: boolean) => void;
  toast: (text: string) => void;
  /** The attached recording changed (the report refreshes its summary). */
  changed: () => void;
};

type Clip = {
  blob: Blob;
  url: string;
  durationMs: number;
  audio: boolean;
  width: number | undefined;
  height: number | undefined;
};

type DisplayOptions = DisplayMediaStreamOptions & Record<string, unknown>;
type PipApi = {
  requestWindow(o?: { width: number; height: number; disallowReturnToOpener?: boolean }): Promise<Window>;
};

/** Keys for an open dialog or a running recording, ahead of the report's own shortcuts (Esc closes the report). */
function grabKeys(fn: (e: KeyboardEvent) => boolean): () => void {
  const on = (e: KeyboardEvent) => {
    if (!fn(e)) return;
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener("keydown", on, true);
  return () => window.removeEventListener("keydown", on, true);
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class Recording {
  private phase: Phase = "idle";
  private clip: Clip | null = null; // attached to the report
  private fresh: Clip | null = null; // just recorded, being reviewed
  private display: MediaStream | null = null;
  private mic: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private bytes = 0;
  private mime: "video/webm" | "video/mp4" = "video/webm";
  private voice = false;
  private micOff = false;
  private watch = new Stopwatch();
  private tick = 0;
  private stopWhy: "time" | "size" | null = null;
  private opener: Element | null = null;
  private pip: Window | null = null;
  private bar: { remove: () => void; update: () => void } | null = null;
  private live: (() => void)[] = []; // listeners that last as long as a capture
  private dialog: HTMLElement | null = null;
  private dialogOff: (() => void)[] = [];

  readonly button = h(
    "button",
    { type: "button", class: "btn sm rc-add", onclick: () => this.open() },
    icon(I.rec),
    t("recAdd"),
  );
  /** The attached clip, under the buttons. */
  readonly row = h("div", { class: "rc-row" });

  constructor(private readonly ctx: RecordCtx) {
    adoptStyle(ctx.root, "record", RECORD_CSS);
    this.row.hidden = true;
  }

  // --- Public ---------------------------------------------------------------------------------

  setDisabled(on: boolean) {
    this.button.disabled = on || isBusy(this.phase);
  }

  /** The attached clip, ready for the wire; null when none is attached. */
  async pack(): Promise<RecordingPayload | null> {
    const c = this.clip;
    if (!c) return null;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
      r.onerror = () => reject(r.error ?? new Error("read failed"));
      r.readAsDataURL(c.blob);
    });
    return {
      dataUrl,
      durationMs: c.durationMs,
      audio: c.audio,
      ...(c.width ? { width: c.width } : {}),
      ...(c.height ? { height: c.height } : {}),
    };
  }

  get attached() {
    return !!this.clip;
  }

  /** Full teardown: tracks, timers, listeners, windows, object URLs and anything on screen. */
  destroy() {
    const running = isBusy(this.phase);
    this.phase = "idle";
    this.release();
    this.closeDialog();
    for (const c of [this.clip, this.fresh]) if (c) URL.revokeObjectURL(c.url);
    this.clip = this.fresh = null;
    if (running) this.ctx.hide(false);
  }

  // --- Phases ---------------------------------------------------------------------------------

  /** `phase` read through a call: it changes across the awaits of a share prompt, which a narrowed field cannot show. */
  private phaseNow(): Phase {
    return this.phase;
  }

  private go(ev: Ev) {
    this.phase = advance(this.phase, ev);
    this.button.disabled = isBusy(this.phase);
    this.bar?.update();
  }

  private open() {
    this.opener = this.button;
    this.go("open");
    this.setup("");
  }

  /** The notice + microphone choice. Start must reach getDisplayMedia straight from the click. */
  private setup(message: string) {
    const ok = canRecord();
    const mic = this.ctx.cfg.microphone && ok && typeof navigator.mediaDevices.getUserMedia === "function";
    let withMic = false;
    const err = h("p", { class: "rc-err", role: "alert" }, message || (ok ? "" : t("recUnsupported")));
    const sw = h("button", {
      type: "button",
      class: "rc-sw",
      role: "switch",
      "aria-checked": "false",
      "aria-label": t("recMic"),
      onclick: () => {
        withMic = !withMic;
        sw.setAttribute("aria-checked", String(withMic));
      },
    });
    const start = h(
      "button",
      {
        type: "button",
        class: "btn primary",
        disabled: !ok,
        onclick: () => {
          err.textContent = "";
          start.disabled = true;
          // getDisplayMedia is called in this click, before anything is awaited.
          void this.begin(withMic, err, start);
        },
      },
      icon(I.rec),
      t("recStart"),
    );
    const cancel = h(
      "button",
      { type: "button", class: "btn ghost", onclick: () => this.cancel() },
      t("cancel"),
    );
    this.show(
      t("recTitle"),
      [
        h("p", {}, t("recIntro")),
        h(
          "ul",
          { class: "rc-points" },
          h("li", {}, t("recPoint1")),
          h("li", {}, t("recPoint2")),
          h("li", {}, t("recLimit", { time: clockText(this.ctx.cfg.maxSeconds * 1000) })),
        ),
        mic &&
          h(
            "div",
            { class: "rc-mic" },
            icon(I.mic),
            h("span", { class: "grow" }, t("recMic"), h("small", {}, t("recMicNote"))),
            sw,
          ),
        err,
        h("div", { class: "rc-foot" }, cancel, start),
      ],
      ok ? start : cancel,
      () => this.cancel(),
    );
  }

  private async begin(withMic: boolean, err: HTMLElement, start: HTMLButtonElement) {
    this.go("start");
    const fail = (e: unknown) => {
      console.warn("[pinwren] screen recording:", e);
      this.release();
      this.go("fail");
      err.textContent = t(failKey(e));
      start.disabled = false;
    };
    try {
      const opts: DisplayOptions = {
        video: { frameRate: { ideal: 15, max: 30 }, width: { max: 1920 }, height: { max: 1080 } },
        audio: false,
        // Chrome: offer this tab first, with the page itself recordable; ignored by other browsers.
        preferCurrentTab: true,
        selfBrowserSurface: "include",
        surfaceSwitching: "exclude",
        systemAudio: "exclude",
      };
      const display = await navigator.mediaDevices.getDisplayMedia(opts);
      if (this.phase !== "requesting") {
        // Cancelled (or the report closed) while the browser's prompt was open.
        for (const track of display.getTracks()) track.stop();
        return;
      }
      this.display = display;
      const video = display.getVideoTracks()[0];
      if (!video) throw new DOMException("no video track", "NotSupportedError");
      // A browser-side "Stop sharing" ends the track: that is a normal way to finish.
      video.addEventListener("ended", () => this.stop());
      this.voice = false;
      this.micOff = false;
      this.stopWhy = null;
      if (withMic) {
        try {
          this.mic = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          });
          this.voice = this.mic.getAudioTracks().length > 0;
        } catch {
          this.micOff = true; // no sound is better than no recording
        }
        if (this.phaseNow() !== "requesting") {
          this.release();
          return;
        }
      }
      const stream = new MediaStream([...display.getVideoTracks(), ...(this.mic?.getAudioTracks() ?? [])]);
      const mime = pickMime((m) => MediaRecorder.isTypeSupported(m), this.voice);
      const rate = bitrates(this.ctx.cfg.maxSeconds, this.voice);
      const rec = new MediaRecorder(stream, {
        ...(mime ? { mimeType: mime } : {}),
        videoBitsPerSecond: rate.video,
        ...(this.voice ? { audioBitsPerSecond: rate.audio } : {}),
      });
      this.mime = baseType(rec.mimeType || mime || "video/webm");
      rec.ondataavailable = (e) => this.onData(e);
      rec.onstop = () => this.finish();
      rec.onerror = () => this.fatal(new Error("recorder error"));
      this.rec = rec;
    } catch (e) {
      if (this.phaseNow() !== "requesting") return; // cancelled meanwhile
      fail(e);
      return;
    }
    this.go("granted");
    this.closeDialog();
    await this.countdown();
  }

  private async countdown() {
    this.ctx.hide(true);
    const pip = await this.openPip();
    const num = h("div", { class: "rc-num", "aria-hidden": "true" });
    const say = h("p", { class: "rc-live", role: "status" });
    const scrim = h(
      "div",
      { class: "rc-scrim rc-count" },
      num,
      say,
      h("p", { class: "rc-hint" }, pip ? "" : t("recHidden")),
    );
    this.ctx.root.append(scrim);
    this.live.push(
      () => scrim.remove(),
      grabKeys((e) =>
        e.key === "Escape" && this.phase === "countdown" ? (this.cancel(), true) : this.shortcut(e),
      ),
    );
    for (let n = COUNTDOWN_SECONDS; n > 0; n--) {
      num.textContent = String(n);
      say.textContent = t("recCountdown", { n });
      await wait(1000);
      if (this.phase !== "countdown") return;
    }
    scrim.remove();
    await frame(); // the overlay is gone from the page before the first frame is recorded
    if (this.phase !== "countdown" || !this.rec) return;
    this.go("go");
    this.chunks = [];
    this.bytes = 0;
    this.watch = new Stopwatch();
    this.rec.start(1000);
    this.watch.start();
    this.mountBar(pip);
    this.tick = window.setInterval(() => {
      this.checkLimits();
      this.bar?.update();
    }, 250);
  }

  private onData(e: BlobEvent) {
    if (!e.data.size) return;
    this.chunks.push(e.data);
    this.bytes += e.data.size;
    this.checkLimits();
  }

  private checkLimits() {
    if (this.phase !== "recording" && this.phase !== "paused") return;
    const why = limitHit({ elapsedMs: this.watch.ms, bytes: this.bytes }, this.ctx.cfg.maxSeconds);
    if (why) {
      this.stopWhy = why;
      this.stop();
    }
  }

  private togglePause() {
    if (!this.rec) return;
    if (this.phase === "recording") {
      this.rec.pause();
      this.watch.pause();
      this.go("pause");
    } else if (this.phase === "paused") {
      this.rec.resume();
      this.watch.start();
      this.go("resume");
    }
  }

  /** Alt+Shift+S stops, Alt+Shift+P pauses and resumes: the way to reach the controls when they are out of sight. */
  private shortcut(e: KeyboardEvent): boolean {
    if (!e.altKey || !e.shiftKey) return false;
    if (e.code === "KeyS") return (this.stop(), true);
    if (e.code === "KeyP") return (this.togglePause(), true);
    return false;
  }

  private stop() {
    if (this.phase === "countdown" || this.phase === "requesting") {
      this.cancel();
      return;
    }
    if (this.phase !== "recording" && this.phase !== "paused") return;
    this.watch.pause();
    this.go("stop");
    clearInterval(this.tick);
    try {
      if (this.rec && this.rec.state !== "inactive") this.rec.stop();
      else this.finish();
    } catch {
      this.finish();
    }
  }

  /** The recorder has flushed its last chunk. */
  private finish() {
    if (this.phase !== "stopping") return;
    const durationMs = Math.round(this.watch.ms);
    const settings = this.display?.getVideoTracks()[0]?.getSettings();
    const blob = new Blob(this.chunks, { type: this.mime });
    const [voice, micOff, why] = [this.voice, this.micOff, this.stopWhy];
    this.release();
    this.ctx.hide(false);
    if (!blob.size || durationMs < 300) {
      this.fatal(new Error("empty recording"));
      return;
    }
    if (blob.size > MAX_RECORDING_BYTES) {
      this.go("fail");
      this.setup(t("recTooBig"));
      return;
    }
    this.fresh = {
      blob,
      url: URL.createObjectURL(blob),
      durationMs,
      audio: voice,
      width: settings?.width,
      height: settings?.height,
    };
    this.go("finalized");
    const notes = [
      why === "time" ? t("recLimitTime", { time: clockText(this.ctx.cfg.maxSeconds * 1000) }) : "",
      why === "size" ? t("recLimitSize") : "",
      micOff ? t("recMicOff") : "",
    ].filter(Boolean);
    this.preview(this.fresh, "new", notes.join(" "));
  }

  private fatal(e: unknown) {
    if (this.phase === "idle") return;
    console.warn("[pinwren] screen recording:", e);
    const wasHidden = isBusy(this.phase);
    this.release();
    if (wasHidden) this.ctx.hide(false);
    this.go("fail");
    this.setup(t(failKey(e)));
  }

  private cancel() {
    const wasHidden = isBusy(this.phase);
    this.release();
    this.closeDialog();
    if (wasHidden) this.ctx.hide(false);
    this.go("close");
  }

  /** Stop every track, timer and listener; the recorder, streams, shortcut keys and controls window are gone after this. */
  private release() {
    clearInterval(this.tick);
    for (const off of this.live.splice(0)) off();
    const rec = this.rec;
    this.rec = null;
    if (rec) {
      rec.ondataavailable = rec.onstop = rec.onerror = null;
      try {
        if (rec.state !== "inactive") rec.stop();
      } catch {
        // already stopped
      }
    }
    for (const s of [this.display, this.mic]) for (const track of s?.getTracks() ?? []) track.stop();
    this.display = this.mic = null;
    this.bar?.remove();
    this.bar = null;
    const pip = this.pip;
    this.pip = null;
    try {
      pip?.close();
    } catch {
      // already closed
    }
  }

  // --- Controls --------------------------------------------------------------------------------

  /** A small window of its own, which a tab capture does not include (Chrome and Edge 116+). */
  private async openPip(): Promise<Window | null> {
    const api = (window as unknown as { documentPictureInPicture?: PipApi }).documentPictureInPicture;
    if (!api) return null;
    try {
      return await api.requestWindow({ width: 300, height: 64, disallowReturnToOpener: true });
    } catch {
      return null; // no user activation left, or the browser said no
    }
  }

  private mountBar(pip: Window | null) {
    const time = h("span", { class: "rc-time" });
    const label = h("span", { class: "rc-state", role: "status" });
    const pause = h("button", { type: "button", class: "rc-ib", onclick: () => this.togglePause() });
    const stop = h(
      "button",
      {
        type: "button",
        class: "rc-ib stop",
        "aria-label": t("recStop"),
        title: t("recStop"),
        onclick: () => this.stop(),
      },
      icon(I.stop),
    );
    const bar = h(
      "div",
      { class: "rc-bar", role: "group", "aria-label": t("recBar") },
      h("span", { class: "rc-dot", "aria-hidden": "true" }),
      label,
      time,
      pause,
      stop,
    );
    const update = () => {
      const paused = this.phase === "paused";
      label.textContent = paused ? t("recPaused") : t("recRecording");
      bar.classList.toggle("paused", paused);
      time.textContent = t("recTime", {
        time: clockText(this.watch.ms),
        max: clockText(this.ctx.cfg.maxSeconds * 1000),
      });
      const text = paused ? t("recResume") : t("recPause");
      pause.replaceChildren(icon(paused ? I.play : I.pause));
      pause.setAttribute("aria-label", text);
      pause.title = text;
    };
    update();
    if (pip) {
      this.pip = pip;
      pip.document.title = t("recWindow");
      try {
        const sheet = new (pip as Window & typeof globalThis).CSSStyleSheet();
        sheet.replaceSync(PIP_CSS);
        pip.document.adoptedStyleSheets = [sheet];
      } catch {
        pip.document.head.append(h("style", {}, PIP_CSS));
      }
      pip.document.body.append(bar);
      pip.addEventListener("keydown", (e) => {
        if (this.shortcut(e)) e.preventDefault();
      });
      pip.addEventListener("pagehide", () => {
        // The controls window was closed: keep recording, with the controls in the corner instead.
        if (this.pip !== pip) return;
        this.pip = null;
        if (this.phase === "recording" || this.phase === "paused") {
          this.bar?.remove();
          this.mountBar(null);
        }
      });
      this.bar = { remove: () => bar.remove(), update };
      return;
    }
    // Invisible until the pointer or keyboard focus is in the corner, so it is not in the picture.
    const zone = h("div", { class: "rc-zone" }, bar);
    this.ctx.root.append(zone);
    this.bar = { remove: () => zone.remove(), update };
  }

  // --- Dialogs ---------------------------------------------------------------------------------

  /** A modal dialog over the report; `onEsc` runs for Escape (which the report would otherwise take). */
  private show(
    title: string,
    body: (Node | string | false | null | undefined)[],
    focus: HTMLElement,
    onEsc: () => void,
  ) {
    this.closeDialog();
    const box = h(
      "div",
      { class: "rc-dialog", role: "dialog", "aria-modal": "true", "aria-label": title },
      h("h2", {}, title),
      ...body,
    );
    const scrim = h("div", { class: "rc-scrim" }, box);
    this.dialog = scrim;
    this.ctx.root.append(scrim);
    this.dialogOff.push(
      trapFocus(box, this.opener),
      grabKeys((e) => e.key === "Escape" && (onEsc(), true)),
    );
    focus.focus();
  }

  private closeDialog() {
    for (const off of this.dialogOff.splice(0)) off();
    this.dialog?.remove();
    this.dialog = null;
  }

  /** The clip played back. `new` offers retake / discard / attach; `view` is the attached one. */
  private preview(clip: Clip, mode: "new" | "view", notice = "") {
    const video = h("video", {
      class: "rc-video",
      src: clip.url,
      controls: true,
      playsinline: true,
      preload: "metadata",
      "aria-label": t("recPreviewLabel"),
    });
    const info = `${t(clip.audio ? "recRowVoice" : "recRow", { time: clockText(clip.durationMs) })} · ${sizeText(clip.blob.size)}`;
    const btn = (cls: string, svg: string, text: string, run: () => void) =>
      h("button", { type: "button", class: `btn ${cls}`, onclick: run }, icon(svg), text);
    const primary = btn("primary", I.check, t("recAttach"), () => this.attach());
    const close = btn("ghost", I.close, t("close"), () => this.closeDialog());
    this.opener = mode === "view" ? this.row.querySelector("button") : this.button;
    const dismiss = () => (mode === "new" ? this.discard() : this.closeDialog());
    this.show(
      t("recPreviewTitle"),
      [
        video,
        h("p", { class: "rc-info" }, info),
        notice && h("p", { class: "rc-note", role: "status" }, notice),
        h(
          "div",
          { class: "rc-foot" },
          ...(mode === "new"
            ? [
                btn("ghost", I.trash, t("recDiscard"), () => this.discard()),
                h("span", { class: "grow" }),
                btn("ghost", I.reopen, t("recRetake"), () => this.retake()),
                primary,
              ]
            : [close]),
        ),
      ],
      mode === "new" ? primary : close,
      dismiss,
    );
  }

  private discard() {
    if (this.fresh) URL.revokeObjectURL(this.fresh.url);
    this.fresh = null;
    this.closeDialog();
    this.go("close");
  }

  private retake() {
    if (this.fresh) URL.revokeObjectURL(this.fresh.url);
    this.fresh = null;
    this.go("retake");
    this.setup("");
  }

  private attach() {
    const c = this.fresh;
    if (!c) return;
    if (this.clip) URL.revokeObjectURL(this.clip.url);
    this.clip = c;
    this.fresh = null;
    this.closeDialog();
    this.go("close");
    this.renderRow();
    this.ctx.toast(t("recAttached"));
    this.ctx.changed();
  }

  private remove() {
    if (this.clip) URL.revokeObjectURL(this.clip.url);
    this.clip = null;
    this.renderRow();
    this.ctx.changed();
    this.button.focus();
  }

  private renderRow() {
    const c = this.clip;
    this.row.hidden = !c;
    if (!c) {
      this.row.replaceChildren();
      return;
    }
    const label = t(c.audio ? "recRowVoice" : "recRow", { time: clockText(c.durationMs) });
    this.row.replaceChildren(
      h(
        "button",
        {
          type: "button",
          class: "rc-ib",
          "aria-label": t("recPlay"),
          title: t("recPlay"),
          onclick: () => this.preview(c, "view"),
        },
        icon(I.play),
      ),
      h(
        "span",
        { class: "grow" },
        h("span", { class: "rc-name" }, label),
        h("small", {}, sizeText(c.blob.size)),
      ),
      h(
        "button",
        {
          type: "button",
          class: "rc-ib",
          "aria-label": t("recRemove"),
          title: t("recRemove"),
          onclick: () => this.remove(),
        },
        icon(I.close),
      ),
    );
  }
}

/** Mount the "Record screen" button and its attached-clip row; the report places `button` beside "Add screenshot" and `row` under it. */
export function mount(ctx: RecordCtx) {
  return new Recording(ctx);
}

export type RecordModule = { mount: typeof mount; config: typeof resolveRecording };
(window as unknown as { __pinwrenRecord: RecordModule }).__pinwrenRecord = {
  mount,
  config: resolveRecording,
};
