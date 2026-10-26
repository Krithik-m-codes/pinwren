import type { Created } from "./api";
import { type Attachment, MAX_FILES, readFile, sanitizeAttachments, validateFiles } from "./attachments";
import type { CaptureMode, CaptureModule } from "./capture";
import { loadChunk } from "./chunks";
import {
  type Branding,
  type CaptureCfg,
  type FeedbackPayload,
  mergeMetadata,
  type ReplayPayload,
  type WidgetConfig,
} from "./config";
import { diagnosticsSummary, performanceTiming, snapshotDiagnostics } from "./diagnostics";
import { adoptStyle, h, ICONS, icon, trapFocus } from "./dom";
import type { Editor, EditorModule } from "./editor";
import { environment, errText, uuid } from "./env";
import { cleanPageUrl } from "./export";
import { consentBlock, identityFields } from "./form";
import { addEnglish, t, tn } from "./i18n";
import * as I from "./icons";
import type { Quality } from "./quality";
import { idbKV } from "./idb";
import { enReport } from "./locales/en-report";
import { Picker } from "./picker";
import { isRetryable } from "./queue";
import { REPORT_CSS } from "./report-styles";
import { COLORS, type Shape, type Size, sanitizeShapes, type Tool } from "./shapes";
import type { Identity } from "./store";
import { ago } from "./ui";

// Bug report mode (F-003): capture → annotate → describe → send. This file is the lazy widget-report.js
// chunk: the form, the capture orchestration, drafts (F-010, IndexedDB) and the hand-off to the offline
// outbox. The heavy parts load alongside it: SnapDOM in widget-capture.js, the annotation editor in
// widget-editor.js.

/** The session replay recorded up to the moment the report opened (wave-4 §3), gzipped on send. */
export type ReplayOffer = { seconds: number; pack: () => Promise<ReplayPayload | null> };

export type ReportCtx = {
  host: HTMLElement;
  root: HTMLElement;
  /** Where widget.js and its chunks are served from. */
  assets: string;
  project: string;
  cfg: WidgetConfig;
  /** Mask selectors already include the privacy-mode field masks when that is on. */
  capture: CaptureCfg;
  branding: Branding;
  /** Where focus goes back to when the report closes. */
  opener: Element | null;
  identity: Identity;
  /** Came through a review link: the guest must give a name (wave-5 §3.5). */
  reviewGuest: boolean;
  /** Page scope sent as `page.urlPattern` (wave-4 §4). */
  urlPattern: string | undefined;
  /** Host context from `Pinwren.setMetadata` (wave-5 §3.3), read when the report is sent. */
  metadata: () => Record<string, unknown> | null;
  replay: ReplayOffer | null;
  submit: (p: FeedbackPayload) => Promise<Created>;
  queue: (clientId: string, p: FeedbackPayload) => Promise<void>;
  toast: (text: string) => void;
  sent: (id: string, number: number, token?: string) => void;
  error: (message: string) => void;
  /** The modal is gone (sent, queued or dismissed). */
  done: () => void;
};

type Severity = "low" | "medium" | "high" | "critical";
type Mode = CaptureMode | "screen";
type Draft = {
  v: 1;
  clientId: string;
  savedAt: number;
  title: string;
  body: string;
  severity: Severity;
  screenshot: string | null;
  shapes: Shape[];
  attachments: Attachment[];
};

addEnglish(enReport);

const SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];
const SEV_KEYS = { low: "sevLow", medium: "sevMedium", high: "sevHigh", critical: "sevCritical" } as const;
const PRIORITY = { low: "low", medium: "medium", high: "high", critical: "urgent" } as const;
const CAPTURE_TIMEOUT = 8000;
const drafts = idbKV<Draft>("drafts");

const loadModule = (assets: string) => loadChunk<CaptureModule>(assets, "capture");
const loadEditor = (assets: string) => loadChunk<EditorModule>(assets, "editor");

const timeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Screenshot timed out")), ms)),
  ]);

function toCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d")?.drawImage(img, 0, 0);
      resolve(c);
    };
    img.onerror = () => reject(new Error("bad image"));
    img.src = dataUrl;
  });
}

/** Draft storage is best effort (private browsing, full quota): a failure must never block the report. */
/** No mediaDevices on insecure (http://) pages, and no getDisplayMedia on mobile browsers. */
function canShareScreen(): boolean {
  return "mediaDevices" in navigator && "getDisplayMedia" in navigator.mediaDevices;
}

function ignoreDraftError() {
  // the report itself still works without a saved draft
}

async function readDraft(project: string): Promise<Draft | null> {
  const d = await drafts.get(project).catch(() => undefined);
  if (d?.v !== 1 || typeof d.clientId !== "string") return null;
  return {
    v: 1,
    clientId: /^[0-9a-f-]{36}$/i.test(d.clientId) ? d.clientId : uuid(),
    savedAt: Number.isFinite(d.savedAt) && d.savedAt > 0 ? d.savedAt : Date.now(),
    title: typeof d.title === "string" ? d.title.slice(0, 200) : "",
    body: typeof d.body === "string" ? d.body.slice(0, 10_000) : "",
    severity: SEVERITIES.includes(d.severity) ? d.severity : "medium",
    screenshot:
      typeof d.screenshot === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(d.screenshot)
        ? d.screenshot
        : null,
    shapes: sanitizeShapes(d.shapes),
    attachments: sanitizeAttachments(d.attachments),
  };
}

/** Where a screenshot of `mode` is taken from, read just before the capture starts (wave-5 §2). */
function geometryOf(mode: Mode): NonNullable<FeedbackPayload["capture"]> {
  const vw = Math.max(1, Math.min(20_000, Math.round(innerWidth)));
  const vh = Math.max(1, Math.min(20_000, Math.round(innerHeight)));
  if (mode === "full")
    return {
      vw,
      vh: Math.max(1, Math.min(20_000, document.documentElement.scrollHeight)),
      scrollY: 0,
      mode,
    };
  return { vw, vh, scrollY: Math.max(0, Math.round(scrollY)), mode };
}

const fmtSize = (n: number) =>
  n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`;

export class BugReport {
  private modal: HTMLElement | null = null;
  private stage = h("div", { class: "canvas-wrap" });
  private toolbar = h("div", { class: "toolbar", role: "toolbar" });
  private capbar = h("div", { class: "capbar seg", role: "group", "aria-label": t("capture") });
  private summary = h("ul", { class: "summary" });
  private files = h("div", { class: "files" });
  private error = h("p", { class: "err", role: "alert" });
  private title = h("input", {
    placeholder: t("titlePlaceholder"),
    "aria-label": t("titleLabel"),
    maxlength: 200,
  });
  private body = h("textarea", {
    placeholder: t("describePlaceholder"),
    "aria-label": t("describe"),
    maxlength: 10000,
    class: "desc",
  });
  private sevButtons: HTMLButtonElement[] = [];
  private severity: Severity = "medium";
  private clientId = uuid();
  private attachments: Attachment[] = [];
  private mod: CaptureModule | null = null;
  private Ed: EditorModule["Editor"] | null = null;
  /** Whether the reporter keeps the session replay in this report (they can leave it out). */
  private withReplay = true;
  /** The reporter switched on "Reduce capture quality": this report's screenshot is sent small. */
  private reduced = false;
  private base: HTMLCanvasElement | null = null;
  private baseUrl: string | null = null;
  private editor: Editor | null = null;
  private mode: Mode = "visible";
  /** The viewport the current screenshot shows (wave-5 §2), for Page Review; null when unknown (a draft). */
  private geometry: FeedbackPayload["capture"] | null = null;
  private state: "capturing" | "ready" | "failed" | "none" = "capturing";
  private picker: Picker | null = null;
  private saveTimer = 0;
  private closed = false;
  private sending = false;
  private cleanup: (() => void)[] = [];

  constructor(private readonly ctx: ReportCtx) {
    adoptStyle(ctx.root, "report", REPORT_CSS);
  }

  /** Entry point: offer to resume a saved draft, otherwise capture the visible area and open the form. */
  async start() {
    const draft = await readDraft(this.ctx.project);
    if (draft) {
      const answer = await this.askResume(draft);
      if (answer === "cancel" || this.closed) return;
      if (answer === "resume") return this.restore(draft);
      await drafts.del(this.ctx.project).catch(ignoreDraftError);
    }
    this.ctx.root.style.visibility = "hidden"; // the launcher must not flash into the first frame
    // The editor isn't needed until the screenshot is there: it downloads while SnapDOM works.
    const editor = this.loadEd();
    try {
      this.mod = await loadModule(this.ctx.assets);
      const at = geometryOf("visible");
      this.base = await timeout(
        this.mod.capture("visible", this.ctx.capture.maskSelectors, undefined, this.quality),
        CAPTURE_TIMEOUT,
      );
      this.geometry = at;
      await editor;
      this.state = "ready";
    } catch (err) {
      console.warn("[pinwren] screenshot failed:", err);
      this.state = "failed";
    } finally {
      this.ctx.root.style.visibility = "";
    }
    if (!this.closed) this.build();
  }

  /** Load the editor chunk; a failure leaves `Ed` null and the screenshot area offers the fallbacks. */
  private async loadEd() {
    try {
      this.Ed = (await loadEditor(this.ctx.assets)).Editor;
    } catch (err) {
      console.warn("[pinwren]", err);
    }
  }

  private askResume(d: Draft): Promise<"resume" | "discard" | "cancel"> {
    return new Promise((resolve) => {
      const answer = (a: "resume" | "discard" | "cancel") => {
        release();
        el.remove();
        off();
        resolve(a);
      };
      const resume = h("button", { class: "btn primary", onclick: () => answer("resume") }, t("resume"));
      const el = h(
        "div",
        { class: "modal" },
        h(
          "div",
          { class: "card ask", role: "alertdialog", "aria-modal": "true", "aria-label": t("resumeTitle") },
          h("span", { class: "ask-ico" }, icon(ICONS.clock)),
          h("b", { class: "ask-title" }, t("resumeTitle")),
          h("p", { class: "muted" }, t("resumeBody", { ago: ago(new Date(d.savedAt).toISOString()) })),
          h(
            "div",
            { class: "foot" },
            h("span", { class: "grow" }),
            h("button", { class: "btn ghost", onclick: () => answer("discard") }, t("startOver")),
            resume,
          ),
        ),
      );
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        answer("cancel");
        this.close(false);
      };
      document.addEventListener("keydown", onKey, true);
      const off = () => document.removeEventListener("keydown", onKey, true);
      this.cleanup.push(off);
      this.ctx.root.append(el);
      const release = trapFocus(el, this.ctx.opener);
      resume.focus();
    });
  }

  private async restore(d: Draft) {
    this.clientId = d.clientId;
    this.title.value = d.title;
    this.body.value = d.body;
    this.severity = d.severity;
    this.attachments = d.attachments;
    const editor = this.loadEd();
    try {
      this.mod = await loadModule(this.ctx.assets);
      await editor;
      if (d.screenshot) {
        this.base = await toCanvas(d.screenshot);
        this.baseUrl = d.screenshot;
      }
      this.state = this.base ? "ready" : "none";
    } catch {
      this.state = d.screenshot ? "failed" : "none";
    }
    if (!this.closed) this.build(d.shapes);
  }

  // --- Building the modal -------------------------------------------------------------------------

  private build(shapes: Shape[] = []) {
    const { ctx } = this;
    const ident = identityFields(ctx.identity, { requireName: ctx.reviewGuest });
    const consent = consentBlock(ctx.cfg.consent, ctx.project);
    const send = h("button", { class: "btn primary" }, consent.need ? t("agreeSend") : t("sendReport"));

    this.sevButtons = SEVERITIES.map((s) =>
      h(
        "button",
        {
          type: "button",
          role: "radio",
          "data-sev": s,
          "aria-checked": String(s === this.severity),
          onclick: () => {
            this.severity = s;
            for (const b of this.sevButtons) b.setAttribute("aria-checked", String(b.dataset.sev === s));
            this.saveSoon();
          },
        },
        t(SEV_KEYS[s]),
      ),
    );

    const picker = h("input", {
      type: "file",
      multiple: true,
      accept: "image/png,image/jpeg,image/webp,image/gif,application/pdf",
      hidden: true,
      tabindex: -1,
      "aria-hidden": "true",
    });
    picker.addEventListener("change", () => {
      void this.addFiles(Array.from(picker.files ?? []));
      picker.value = "";
    });
    const drop = h(
      "div",
      { class: "drop" },
      icon(I.clip),
      h(
        "span",
        { class: "grow" },
        `${t("attachDrop")} `,
        h("button", { class: "linkish", type: "button", onclick: () => picker.click() }, t("browse")),
        h("small", {}, t("attachRules")),
      ),
      picker,
    );

    send.addEventListener("click", () => {
      const body = this.body.value.trim();
      if (!body) {
        this.error.textContent = t("describeFirst");
        this.body.focus();
        return;
      }
      const bad = ident.invalid();
      if (bad) {
        this.error.textContent = bad.message;
        bad.el.focus();
        return;
      }
      consent.accept();
      void this.send(send, body, ident.read(), consent.record());
    });

    const modal = h(
      "div",
      { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": t("reportBug") },
      h(
        "div",
        { class: "editor" },
        this.toolbar,
        h(
          "div",
          { class: "stage" },
          h("div", { class: "shot" }, this.stage, this.capbar),
          h(
            "div",
            { class: "side" },
            h(
              "div",
              { class: "side-head" },
              ctx.branding.logoUrl
                ? h("img", {
                    class: "side-logo",
                    src: ctx.branding.logoUrl,
                    alt: "",
                    referrerpolicy: "no-referrer",
                    draggable: "false",
                  })
                : h("span", { class: "side-ico" }, icon(ICONS.bug)),
              h("span", { class: "grow" }, h("b", {}, t("reportBug")), h("small", {}, t("reportIntro"))),
            ),
            h(
              "div",
              { class: "side-body" },
              this.title,
              this.body,
              h(
                "div",
                { class: "field" },
                h("span", { class: "label" }, t("severity")),
                h(
                  "div",
                  { class: "seg sev", role: "radiogroup", "aria-label": t("severity") },
                  ...this.sevButtons,
                ),
              ),
              h("div", { class: "field" }, h("span", { class: "label" }, t("attachments")), drop, this.files),
              ...ident.els,
              consent.el,
              h("div", { class: "field" }, h("span", { class: "label" }, t("willSend")), this.summary),
            ),
            h(
              "div",
              { class: "foot side-foot" },
              // Errors sit by the buttons, not at the bottom of the scrolling form where they'd go unseen.
              this.error,
              h("span", { class: "grow" }),
              h("button", { class: "btn ghost", onclick: () => this.close() }, t("cancel")),
              send,
            ),
          ),
        ),
      ),
    );
    this.modal = modal;

    const on = <K extends keyof HTMLElementEventMap>(
      target: Document | HTMLElement,
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      capture = false,
    ) => {
      const safe = (e: Event) => {
        try {
          fn(e as HTMLElementEventMap[K]); // addEventListener(type) only delivers events of that type
        } catch (err) {
          console.warn("[pinwren]", err);
        }
      };
      target.addEventListener(type, safe, capture);
      this.cleanup.push(() => target.removeEventListener(type, safe, capture));
    };
    // Document-level, so shortcuts keep working after focus falls back to <body> (e.g. a clicked button
    // was re-rendered). Typing in any field — ours or the page's — is never hijacked.
    on(
      document,
      "keydown",
      (e: KeyboardEvent) => {
        const first = e.composedPath()[0];
        const el = first instanceof Element ? first : null;
        // The text-label input handles its own Enter/Esc (commit/cancel the label).
        if (this.picker || e.defaultPrevented || modal.hidden || el?.classList.contains("ed-text")) return;
        if (e.key === "Escape") {
          this.close();
          return;
        }
        if (!this.editor || el?.closest("input, textarea, [contenteditable]") || e.repeat) return;
        if (this.editor.key(e)) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true,
    );
    on(modal, "paste", (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (!files.length) return;
      e.preventDefault();
      void this.addFiles(files);
    });
    on(modal, "dragover", (e: DragEvent) => {
      e.preventDefault();
      drop.classList.add("over");
    });
    on(modal, "dragleave", (e: DragEvent) => {
      if (!e.relatedTarget) drop.classList.remove("over");
    });
    on(modal, "drop", (e: DragEvent) => {
      e.preventDefault();
      drop.classList.remove("over");
      void this.addFiles(Array.from(e.dataTransfer?.files ?? []));
    });
    on(modal, "input", () => {
      this.error.textContent = "";
      this.saveSoon();
    });

    this.renderCapbar();
    this.renderFiles();
    this.setShot(this.state, shapes);
    ctx.root.append(modal);
    this.cleanup.unshift(trapFocus(modal, ctx.opener)); // first, so it runs while the modal is attached
    this.body.focus();
  }

  // --- Screenshot area ----------------------------------------------------------------------------

  private setShot(state: BugReport["state"], shapes: Shape[] = []) {
    this.state = state;
    this.editor?.destroy();
    this.editor = null;
    if (state === "ready" && this.base && this.mod) {
      try {
        if (!this.Ed) throw new Error("The annotation editor didn't load");
        this.editor = new this.Ed(this.base, shapes, t("textPlaceholder"));
        this.editor.quality = this.quality;
        this.editor.onChange = () => {
          this.renderTools();
          this.saveSoon();
        };
      } catch (err) {
        console.warn("[pinwren]", err);
        state = this.state = "failed";
      }
    }
    if (this.editor) this.stage.replaceChildren(this.editor.el);
    else if (state === "capturing")
      this.stage.replaceChildren(h("div", { class: "note" }, h("span", { class: "spin" }), t("capturing")));
    else if (state === "failed") {
      const share = !!this.mod && canShareScreen();
      this.stage.replaceChildren(
        h(
          "div",
          { class: "note fail" },
          h("span", { class: "note-ico" }, icon(I.alert)),
          h("b", {}, t("capFailed")),
          h("span", {}, t("capFailedSub")),
          h(
            "div",
            { class: "row" },
            share &&
              h(
                "button",
                { class: "btn primary", onclick: () => this.recapture("screen") },
                icon(I.screen),
                t("useScreenShare"),
              ),
            h("button", { class: "btn sm", onclick: () => this.setShot("none") }, t("sendWithout")),
          ),
        ),
      );
    } else this.stage.replaceChildren(h("div", { class: "note" }, icon(I.view), t("noShotNote")));
    this.renderTools();
    this.renderCapbar();
    this.renderSummary();
  }

  private renderCapbar() {
    const modes: [Mode, string, string][] = [
      ["visible", I.view, t("capVisible")],
      ["full", I.page, t("capFull")],
      ["element", I.target, t("capElement")],
      ["screen", I.screen, t("capScreen")],
    ];
    this.capbar.replaceChildren(
      ...modes
        .filter(([m]) => m !== "screen" || canShareScreen())
        .map(([m, svg, label]) =>
          h(
            "button",
            {
              type: "button",
              "aria-pressed": String(this.state === "ready" && this.mode === m),
              disabled: this.state === "capturing" || !this.mod,
              onclick: () => this.recapture(m),
            },
            icon(svg),
            label,
          ),
        ),
    );
  }

  /** Build the toolbar once; later calls only sync pressed/disabled states, so keyboard focus survives. */
  private renderTools() {
    if (!this.syncs.length) this.buildTools();
    for (const sync of this.syncs) sync();
  }

  private syncs: (() => void)[] = [];

  private buildTools() {
    const ed = () => this.editor;
    const tools: [Tool, string, string, string][] = [
      ["rect", I.rect, t("toolRect"), "R"],
      ["ellipse", I.ellipse, t("toolEllipse"), "O"],
      ["arrow", I.arrow, t("toolArrow"), "A"],
      ["pen", I.pen, t("toolPen"), "P"],
      ["highlighter", I.highlighter, t("toolHighlighter"), "H"],
      ["text", I.text, t("toolText"), "T"],
      ["step", I.step, t("toolStep"), "N"],
      ["blur", I.blur, t("toolBlur"), "B"],
      ["crop", I.crop, t("toolCrop"), "C"],
    ];
    const mac = /Mac|iPhone|iPad/.test(navigator.userAgent);
    /** A toolbar button whose pressed/disabled state follows the editor. */
    const btn = (
      attrs: Record<string, string>,
      child: Node,
      onclick: () => void,
      pressed: (() => boolean) | null,
      enabled: () => boolean = () => !!ed(),
    ) => {
      const b = h("button", { type: "button", class: "tb", ...attrs, onclick }, child);
      this.syncs.push(() => {
        b.disabled = !enabled();
        if (pressed) b.setAttribute("aria-pressed", String(pressed()));
      });
      return b;
    };
    const tip = (label: string, key: string) => ({
      "aria-label": label,
      "aria-keyshortcuts": key,
      "data-tip": `${label} · ${key.replace("Control", "Ctrl").replace("Meta", "⌘")}`,
    });
    const sizes: [Size, string][] = [
      ["s", t("sizeS")],
      ["m", t("sizeM")],
      ["l", t("sizeL")],
    ];
    const swatches = COLORS.map((c) => {
      const b = h("button", {
        type: "button",
        class: "swatch",
        style: `--sw:${c}`,
        "aria-label": t("colour", { c }),
        onclick: () => ed()?.setColor(c),
      });
      this.syncs.push(() => {
        b.disabled = !ed();
        b.setAttribute("aria-pressed", String(ed()?.color === c));
      });
      return b;
    });
    const undoKey = mac ? "Meta+Z" : "Control+Z";
    const redoKey = mac ? "Meta+Shift+Z" : "Control+Shift+Z";
    this.toolbar.replaceChildren(
      h(
        "div",
        { class: "tgroup" },
        ...tools.map(([tool, svg, label, key]) =>
          btn(
            tip(label, key),
            icon(svg),
            () => ed()?.setTool(tool),
            () => ed()?.tool === tool,
          ),
        ),
      ),
      h("span", { class: "sep" }),
      h("div", { class: "tgroup" }, ...swatches),
      h("span", { class: "sep" }),
      h(
        "div",
        { class: "tgroup sizes", role: "group", "aria-label": t("size") },
        ...sizes.map(([z, label]) =>
          btn(
            { class: `tb size-${z}`, "aria-label": label, "data-tip": label },
            h("span", { class: "dot" }),
            () => ed()?.setSize(z),
            () => ed()?.size === z,
          ),
        ),
      ),
      h("span", { class: "sep" }),
      btn(
        tip(t("undo"), undoKey),
        icon(I.undo),
        () => ed()?.undo(),
        null,
        () => !!ed()?.canUndo,
      ),
      btn(
        tip(t("redo"), redoKey),
        icon(I.redo),
        () => ed()?.redo(),
        null,
        () => !!ed()?.canRedo,
      ),
      h("span", { class: "grow" }),
      h(
        "button",
        { type: "button", class: "tb", "aria-label": t("close"), onclick: () => this.close() },
        icon(I.close),
      ),
    );
  }

  /** Re-take the screenshot in another mode. Screen share must run straight from the click (user activation). */
  private async recapture(mode: Mode) {
    const m = this.mod;
    if (!m || !this.modal) return;
    const prev = { base: this.base, state: this.state, mode: this.mode, shapes: this.editor?.shapes ?? [] };
    const fail = (err: unknown) => {
      console.warn("[pinwren] screenshot failed:", err);
      if (mode === "screen") {
        this.ctx.toast(t("screenCancelled"));
        // A cancelled share keeps whatever was there before.
        this.base = prev.base;
        this.mode = prev.mode;
        this.setShot(prev.state === "ready" && prev.base ? "ready" : prev.state, prev.shapes);
      } else this.setShot("failed");
    };
    if (mode === "screen") {
      const root = this.ctx.root;
      try {
        const at = geometryOf("screen");
        this.base = await m.screenShare(
          () => {
            root.style.visibility = "hidden";
          },
          () => {
            root.style.visibility = "";
          },
          this.ctx.capture.maskSelectors,
        );
        this.mode = mode;
        this.geometry = at;
        this.baseUrl = null;
        this.setShot("ready");
        this.saveSoon();
      } catch (err) {
        fail(err);
      }
      return;
    }
    let el: Element | undefined;
    if (mode === "element") {
      const picked = await this.pickElement();
      if (!picked) return;
      el = picked;
    }
    this.setShot("capturing");
    try {
      const at = geometryOf(mode);
      this.base = await timeout(
        m.capture(mode, this.ctx.capture.maskSelectors, el, this.quality),
        CAPTURE_TIMEOUT,
      );
      this.mode = mode;
      this.geometry = at;
      this.baseUrl = null;
      if (!this.closed) this.setShot("ready");
      this.saveSoon();
    } catch (err) {
      if (!this.closed) fail(err);
    }
  }

  private pickElement(): Promise<Element | null> {
    const modal = this.modal;
    if (!modal) return Promise.resolve(null);
    modal.hidden = true;
    return new Promise((resolve) => {
      this.picker = new Picker(
        this.ctx.host,
        this.ctx.root,
        (pick) => {
          this.picker?.stop();
          this.picker = null;
          modal.hidden = false;
          resolve(pick?.el ?? null);
        },
        true,
      );
    });
  }

  // --- Attachments --------------------------------------------------------------------------------

  private async addFiles(list: File[]) {
    const { accepted, errors } = validateFiles(this.attachments.length, list);
    this.error.textContent = errors.join(" · ");
    for (const f of accepted) {
      try {
        const a = await readFile(f);
        if (this.attachments.length < MAX_FILES) this.attachments.push(a);
      } catch (err) {
        console.warn("[pinwren]", err);
      }
    }
    this.renderFiles();
    this.saveSoon();
  }

  private renderFiles() {
    this.files.replaceChildren(
      ...this.attachments.map((a, i) =>
        h(
          "div",
          { class: "file" },
          a.contentType.startsWith("image/")
            ? h("img", { src: a.dataUrl, alt: "" })
            : h("span", { class: "fi" }, icon(I.file)),
          h(
            "span",
            { class: "grow" },
            h("span", { class: "fname" }, a.name),
            h("small", {}, fmtSize(a.size)),
          ),
          h(
            "button",
            {
              type: "button",
              class: "ib",
              "aria-label": t("removeFile", { name: a.name }),
              onclick: () => {
                this.attachments.splice(i, 1);
                this.renderFiles();
                this.saveSoon();
              },
            },
            icon(I.close),
          ),
        ),
      ),
    );
    this.files.hidden = !this.attachments.length;
    this.renderSummary();
  }

  private renderSummary() {
    const d = diagnosticsSummary();
    const env = environment(this.ctx.cfg.privacyMode);
    const row = (svg: string, text: string, ok: boolean) =>
      h(
        "li",
        { class: ok ? "on" : "off" },
        icon(svg),
        h("span", { class: "grow" }, text),
        icon(ok ? I.check : I.minus),
      );
    this.summary.replaceChildren(
      row(I.view, this.state === "ready" ? t("screenshot") : t("noScreenshot"), this.state === "ready"),
      row(I.terminal, tn("console", d.errors), d.errors > 0),
      row(I.wifi, tn("network", d.failures), d.failures > 0),
      row(
        I.globe,
        [env.browser, env.os, `${env.viewport.w}×${env.viewport.h}`].filter(Boolean).join(" · "),
        true,
      ),
      ...(this.attachments.length ? [row(I.clip, tn("files", this.attachments.length), true)] : []),
      ...(this.ctx.replay ? [this.replayRow(this.ctx.replay.seconds)] : []),
      ...(this.ctx.capture.allowReduceQuality && this.state === "ready" ? [this.qualityRow()] : []),
    );
  }

  /** The sharpness this report's screenshot is taken and sent at: the project's, or `low` when reduced. */
  private get quality(): Quality {
    return this.reduced ? "low" : this.ctx.capture.quality;
  }

  /** "Reduce capture quality" with a switch: a smaller, faster upload for this report (BugPin's toggle). */
  private qualityRow() {
    const on = this.reduced;
    return h(
      "li",
      { class: on ? "on" : "off" },
      icon(I.view),
      h("span", { class: "grow" }, t("reduceQuality")),
      h("button", {
        type: "button",
        class: "sw",
        role: "switch",
        "aria-checked": String(on),
        "aria-label": t("reduceQuality"),
        "data-quality": "toggle",
        onclick: () => {
          this.reduced = !this.reduced;
          if (this.editor) this.editor.quality = this.quality;
          this.renderSummary();
          this.summary.querySelector<HTMLElement>("[data-quality]")?.focus();
        },
      }),
    );
  }

  /** "Session replay · last 60 s" with a switch, so the reporter can leave the recording out. */
  private replayRow(seconds: number) {
    const on = this.withReplay;
    return h(
      "li",
      { class: on ? "on" : "off" },
      icon(I.replay),
      h("span", { class: "grow" }, t("replayRow", { s: seconds })),
      h("button", {
        type: "button",
        class: "sw",
        role: "switch",
        "aria-checked": String(on),
        "aria-label": t("replayInclude"),
        onclick: () => {
          this.withReplay = !this.withReplay;
          this.renderSummary();
          this.summary.querySelector<HTMLElement>(".sw")?.focus();
        },
      }),
    );
  }

  // --- Drafts -------------------------------------------------------------------------------------

  private hasContent() {
    return !!(
      this.body.value.trim() ||
      this.title.value.trim() ||
      this.attachments.length ||
      this.editor?.count
    );
  }

  private saveSoon() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.saveDraft(), 400);
  }

  private async saveDraft() {
    clearTimeout(this.saveTimer);
    if (this.sending) return;
    if (!this.hasContent()) return drafts.del(this.ctx.project).catch(ignoreDraftError);
    if (!this.baseUrl && this.base) {
      try {
        const webp = this.base.toDataURL("image/webp", 0.85);
        this.baseUrl = webp.startsWith("data:image/webp") ? webp : this.base.toDataURL("image/jpeg", 0.85);
      } catch {
        this.baseUrl = null; // a tainted canvas can't be serialised — keep the text at least
      }
    }
    const draft: Draft = {
      v: 1,
      clientId: this.clientId,
      savedAt: Date.now(),
      title: this.title.value,
      body: this.body.value,
      severity: this.severity,
      screenshot: this.state === "ready" ? this.baseUrl : null,
      shapes: this.editor?.shapes ?? [],
      attachments: this.attachments,
    };
    await drafts.set(this.ctx.project, draft).catch(ignoreDraftError);
  }

  // --- Sending ------------------------------------------------------------------------------------

  private async send(
    btn: HTMLButtonElement,
    body: string,
    reporter: FeedbackPayload["reporter"],
    consent: FeedbackPayload["consent"],
  ) {
    if (this.sending) return;
    this.sending = true;
    clearTimeout(this.saveTimer);
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = t("sending");
    // A replay that can't be packed (too big, no CompressionStream) just isn't attached.
    const replay =
      this.ctx.replay && this.withReplay
        ? await this.ctx.replay.pack().catch((err: unknown) => {
            console.warn("[pinwren] session replay not attached:", err);
            return null;
          })
        : null;
    const shot = this.state === "ready" ? this.editor?.exportLayered() : undefined;
    const payload: FeedbackPayload = {
      clientId: this.clientId,
      kind: "bug",
      title: this.title.value.trim() || undefined,
      body,
      priority: PRIORITY[this.severity],
      page: {
        url: cleanPageUrl(location.href),
        title: document.title.slice(0, 300),
        ...(this.ctx.urlPattern ? { urlPattern: this.ctx.urlPattern } : {}),
      },
      environment: environment(this.ctx.cfg.privacyMode),
      reporter,
      consent,
      replay: replay ?? undefined,
      diagnostics: snapshotDiagnostics(),
      // Privacy mode (wave-3 §3) sends no page-timing metadata.
      metadata: mergeMetadata(
        this.ctx.metadata(),
        this.ctx.cfg.privacyMode ? undefined : { performance: performanceTiming() },
      ),
      // Annotations travel as vectors over the (redacted, cropped) capture; the dashboard can hide them.
      screenshot: shot?.screenshot,
      annotations: shot?.annotations ?? undefined,
      // A cropped image no longer shows the whole viewport, so it can't be placed on Page Review.
      capture: shot && !shot.cropped && this.geometry ? this.geometry : undefined,
      attachments: this.attachments.length
        ? (this.attachments.map((a) => ({
            name: a.name,
            contentType: a.contentType,
            dataUrl: a.dataUrl,
          })) as FeedbackPayload["attachments"])
        : undefined,
    };
    try {
      const { feedback } = await this.ctx.submit(payload);
      await drafts.del(this.ctx.project).catch(ignoreDraftError);
      this.close(false);
      this.ctx.toast(t("bugSent", { n: feedback.number }));
      this.ctx.sent(feedback.id, feedback.number, feedback.reporterToken);
    } catch (err) {
      if (isRetryable(err)) {
        // Offline or the server is struggling: keep it and send it later with the same clientId.
        await this.ctx.queue(this.clientId, payload);
        await drafts.del(this.ctx.project).catch(ignoreDraftError);
        this.close(false);
        this.ctx.toast(t("queuedToast"));
        return;
      }
      this.sending = false;
      btn.disabled = false;
      btn.textContent = label;
      this.error.textContent = errText(err, t("genericError"));
      this.ctx.error(this.error.textContent);
    }
  }

  /** Close the report. Unsent content is kept as a draft unless `keep` is false (sent / queued). */
  close(keep = true) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.saveTimer);
    if (keep && this.modal && !this.sending && this.hasContent()) {
      void this.saveDraft();
      this.ctx.toast(t("draftSaved"));
    }
    this.picker?.stop();
    this.picker = null;
    this.editor?.destroy();
    const cleanup = this.cleanup;
    this.cleanup = [];
    cleanup[0]?.(); // focus release runs while the modal is still attached
    this.modal?.remove();
    for (const f of cleanup.slice(1)) f();
    this.ctx.done();
  }
}

export type ReportModule = { BugReport: typeof BugReport };
(window as unknown as { __pinwrenReport: ReportModule }).__pinwrenReport = { BugReport };
