import type { AnchorBundle } from "@pinwren/core";
import { captureAnchor, resolveAnchor } from "./anchor";
import { type Access, type Created, type Pin, WidgetApi } from "./api";
import type { Attachment } from "./attachments";
import { loadChunk, preload } from "./chunks";
import {
  type Branding,
  type CaptureCfg,
  DEFAULT_CONFIG,
  type FeedbackPayload,
  mergeMetadata,
  readableOn,
  type WidgetConfig,
} from "./config";
import { installDiagnostics, snapshotDiagnostics, uninstallDiagnostics } from "./diagnostics";
import { focused, h, ICONS, icon, trapFocus } from "./dom";
import { hasDraft } from "./drafts";
import { environment, errText as errOr, uuid } from "./env";
import { cleanPageUrl } from "./export";
import { Fab } from "./fab";
import type { AttachBox, FlowsModule } from "./flows";
import { consentBlock, identityFields } from "./form";
import { loadLocale, pickLocale, t, tn } from "./i18n";
import { idbKV } from "./idb";
import { PRIVACY_MASKS } from "./mask";
import type { Panel, PanelModule, PanelRow } from "./panel";
import { elementAt, type Pick, Picker } from "./picker";
import { HttpError, isRetryable, Outbox } from "./queue";
import { type Box, isRegion, type PinPct, pinBox, placeCard, regionPin } from "./region";
import type { Recorder, ReplayModule } from "./replay";
import type { ReplayOffer, ReportModule } from "./report";
import { findQuote, pageSelection, textRects, toTextRange } from "./selection";
import { trimTrailingSlashes } from "./slashes";
import { type Identity, store } from "./store";
import { STYLES } from "./styles";
import type { Mode, WidgetEvent } from "./types";
import {
  ago,
  autosize,
  isClosed,
  isEditable,
  type Kind,
  kindChips,
  kindOf,
  MARKER,
  markerEl,
  markerSpot,
  markersShown,
  paintMarker,
  setMarkersShown,
  shortName,
  tag,
} from "./ui";
import { allowedByMode, hiddenBy } from "./visibility";

export type { Mode, WidgetEvent };
export type WidgetOptions = {
  projectKey: string;
  endpoint: string;
  /** Where widget.js and its chunks are served from (the script's directory); defaults to `endpoint`. */
  assets?: string | undefined;
  accent?: string | undefined;
  emit?: (event: WidgetEvent, data?: unknown) => void;
  identity?: Identity;
  /** `data-locale` from the script tag; otherwise the browser's languages decide. */
  locale?: string | undefined;
  /** Ignore the visibility rules (wave-4 §4). */
  forceShow?: boolean | undefined;
  /** Page scope (wave-4 §4): sent as `page.urlPattern`, and pins are listed by it. */
  urlPattern?: string | undefined;
  /** Privacy mode turns session replay off unless the host sets this. */
  allowReplayInPrivacyMode?: boolean | undefined;
  /** Light or dark UI; "auto" (the default) follows the visitor's system. */
  theme?: "light" | "dark" | "auto" | undefined;
  /** `Pinwren.setMetadata` called before init (wave-5 §3.3). */
  metadata?: Record<string, unknown> | null | undefined;
  /** `Pinwren.show()` / `hide()` called before init: overrides the visibility mode. */
  shown?: "show" | "hide" | null | undefined;
};

/** Highlight boxes for a quoted text range, re-measured every frame. */
type Quote = { range: Range; hls: HTMLElement[] };
type Placed = {
  pin: Pin;
  el: Element;
  marker: HTMLButtonElement;
  area: HTMLElement | null;
  moved: boolean;
  quote: Quote | null;
  /** The anchor's marker position (only pins with an anchor are placed). */
  at: PinPct;
};
type Card = {
  el: HTMLElement;
  target: () => Box | null;
  kind: "composer" | "thread";
  id?: string;
  off?: () => void;
  /** Composer only: true once the person typed something, so an outside click doesn't discard it. */
  dirty?: () => boolean;
  /** Set by showCard: ends the focus trap and returns focus to whatever opened the card. */
  release?: () => void;
};
type Selected = { range: Range; el: Element };
/** Events the widget listens for on the host page's window and document. */
type PageEventMap = WindowEventMap & DocumentEventMap;

const SHEET = 640; // below this width cards become bottom sheets and the panel goes full screen
const PANEL_W = 400;
const errText = (err: unknown) => errOr(err, t("genericError"));
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export class PinwrenWidget {
  private readonly api: WidgetApi;
  /** Base URL of the widget's own files (chunks, locales). */
  private readonly assets: string;
  private readonly host = document.createElement("pinwren-root");
  private readonly root: HTMLDivElement;
  private cfg: WidgetConfig = DEFAULT_CONFIG;
  private publicRead = true;
  private ready = false;
  private destroyed = false;
  private pending: { mode?: Mode | undefined } | null = null;
  /** The speed-dial launcher (fab.ts); `launcher` is its button, null when the launcher is hidden. */
  private fab: Fab | null = null;
  private launcher: HTMLButtonElement | null = null;
  private get menu(): HTMLElement | null {
    return this.fab?.menu ?? null;
  }
  private card: Card | null = null;
  private preview: { el: HTMLElement; ring: HTMLElement; p: Placed } | null = null;
  private previewTimer = 0;
  private panel: Panel | null = null;
  /** Bumped by every panel open/close request, so a slow chunk load can't reopen a panel closed meanwhile. */
  private panelWant = 0;
  private panelLoading = false;
  private reportWant = 0;
  private reportLoading = false;
  private branding: Branding = { hidePoweredBy: false, dialogAccent: null, logoUrl: null };
  private projectSlug = "";
  /** The "Comment on selection" offer and the selection it would use. */
  private selOffer: { el: HTMLElement; sel: Selected } | null = null;
  private placed: Placed[] = [];
  private orphans: Pin[] = [];
  /** The speed dial's eye, remembered per visitor and project. */
  private showPins: boolean;
  /** Resolved items stay on the page as muted check markers, and the sidebar counts them. */
  private showResolved = true;
  private haveClosed = false;
  private loadSeq = 0;
  private picker: Picker | null = null;
  private draft: { el: Element; pin: PinPct; node: HTMLElement; quote: Quote | null } | null = null;
  private modalClose: (() => void) | null = null;
  private busy = false;
  private isOpen = false;
  private raf = 0;
  private cleanup: (() => void)[] = [];
  private identity: Identity;
  private urlPattern: string | undefined;
  /** Hidden by `visibility.minViewportWidth` (re-checked on resize). */
  private suppressed = false;
  private recorder: Recorder | null = null;
  private replayMod: ReplayModule | null = null;
  private rightDown = { t: 0, x: 0, y: 0 };
  private capture: CaptureCfg = {
    console: "warnings",
    network: "failures",
    maskSelectors: [],
    replay: { enabled: false, seconds: 60 },
    screenshotOnComment: false,
  };
  private outbox: Outbox<FeedbackPayload, Created> | null = null;
  private queued = 0;
  private draftWaiting = false;
  /** Host context from `Pinwren.setMetadata`, merged into every report and comment (wave-5 §3.3). */
  private metadata: Record<string, unknown> | null = null;
  /**
   * Visibility mode (F-012, wave-5 §2): a valid review link, `?<queryParam>` seen this session, and
   * `Pinwren.show()` / `hide()`. While the mode hides the widget it makes no further requests.
   */
  private gate: { review: boolean; flagged: boolean; host: "show" | "hide" | null } = {
    review: false,
    flagged: false,
    host: null,
  };
  /** Came through a valid review link (`?pinwren_review=`): reports carry it as their source, and need a name. */
  private reviewGuest = false;
  /** Below `visibility.minViewportWidth`. */
  private narrow = false;
  /** Pins weren't listed because the mode hid the widget; listed as soon as it shows. */
  private skipped = false;
  /** Page-link tokens of items opened from a signed link (`?pinwren=<id>&pwt=<token>`), by item id. */
  private readonly links = new Map<string, string>();
  /** Items opened from a signed link: shown even when the project keeps pins private. */
  private readonly linked = new Map<string, Pin>();
  /** Comments waiting in the outbox, by clientId: their optimistic pin gets its number when they go out. */
  private readonly queuedPins = new Map<string, { pin: Pin; placed: Placed | null }>();

  constructor(private readonly opts: WidgetOptions) {
    this.api = new WidgetApi(opts.endpoint, opts.projectKey);
    this.assets = opts.assets ?? opts.endpoint;
    this.identity = opts.identity ?? {};
    this.urlPattern = opts.urlPattern;
    this.metadata = opts.metadata ?? null;
    this.gate.host = opts.shown ?? null;
    const shadow = this.host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = STYLES;
    this.root = h("div", { class: "root" });
    if (opts.theme === "light" || opts.theme === "dark") this.root.dataset.theme = opts.theme;
    this.showPins = markersShown(opts.projectKey);
    shadow.append(style, this.root);
    // A hostile page stylesheet (`* { all: unset }`, `display: none` on unknown tags) must not reach us.
    this.host.style.cssText = "all:initial!important;display:block!important;position:static!important";
    // On <html>, not <body>: survives frameworks that replace the body.
    document.documentElement.append(this.host);
  }

  // --- Lifecycle ----------------------------------------------------------------------------------

  async start() {
    let loaded: Awaited<ReturnType<WidgetApi["config"]>>;
    const lang = pickLocale(
      this.opts.locale,
      navigator.languages.length ? navigator.languages : [navigator.language],
    );
    try {
      [loaded] = await Promise.all([this.api.config(this.opts.accent), loadLocale(lang, this.assets)]);
    } catch (err) {
      console.warn("[pinwren] widget disabled:", errText(err));
      this.destroy();
      return;
    }
    if (this.destroyed) return;
    // Visibility rules (wave-4 §4): on a production host with `environments: "non-production"` the widget
    // doesn't run at all — no launcher, no diagnostics wrappers, no replay.
    const forceShow = this.opts.forceShow === true;
    const visibility = loaded.widget.visibility;
    if (hiddenBy(visibility, { hostname: location.hostname, width: Infinity, forceShow }) === "environment") {
      console.info("[pinwren] hidden on this production host (visibility: non-production only)");
      this.destroy();
      return;
    }
    this.capture = loaded.capture;
    // Only the widget's own calls (`<endpoint>/w/…`) stay out of the network log.
    installDiagnostics(loaded.capture, this.opts.endpoint);
    this.cfg = loaded.widget;
    this.branding = loaded.branding;
    this.projectSlug = loaded.project.slug;
    this.root.lang = lang;
    this.publicRead = loaded.project.publicRead;
    await this.initGate();
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- destroy() can run during the await above
    if (this.destroyed) return;
    this.root.style.setProperty("--pinwren-accent", this.cfg.launcher.accent);
    const dialog = this.branding.dialogAccent;
    if (dialog) {
      this.root.style.setProperty("--pinwren-dialog-accent", dialog);
      this.root.style.setProperty("--pinwren-dialog-accent-fg", readableOn(dialog));
    }

    const reposition = () => this.schedule();
    // Below `minViewportWidth` the widget is hidden, and comes back when the window grows again.
    const fit = () => {
      this.narrow = hiddenBy(visibility, { hostname: "", width: innerWidth, forceShow }) === "viewport";
      this.applyVisibility();
    };
    fit();
    this.listen(window, "scroll", reposition, { passive: true, capture: true });
    this.listen(window, "resize", reposition, { passive: true });
    if (visibility.minViewportWidth > 0) this.listen(window, "resize", fit, { passive: true });
    this.listen(document, "keydown", this.onKey);
    this.listen(
      document,
      "pointerdown",
      (e: PointerEvent) => {
        if (e.button === 2) this.rightDown = { t: Date.now(), x: e.clientX, y: e.clientY };
      },
      true,
    );
    this.listen(window, "contextmenu", this.onContext);
    this.listen(document, "selectionchange", () => {
      // The offer follows the selection; in comment mode the shield keeps the selection, so it stays.
      if (this.selOffer && !this.picker && !pageSelection(this.host, isEditable)) this.hideSelOffer();
    });
    // Host-page focus traps (modal libraries) pull focus back into their dialog on `focusin`. Our UI is
    // outside their DOM subtree, so our own focus events stop at the window before page listeners see them.
    for (const type of ["focusin", "focusout"] as const)
      this.listen(
        window,
        type,
        (e: FocusEvent) => {
          if (e.target === this.host) e.stopImmediatePropagation();
        },
        true,
      );
    // Like Figma: clicking the page closes an open thread, or a composer that is still empty.
    this.listen(
      document,
      "pointerdown",
      (e: PointerEvent) => {
        if (!this.card || e.composedPath().includes(this.host) || this.card.dirty?.()) return;
        this.closeCard();
      },
      true,
    );

    this.buildLauncher();
    this.startOutbox();
    void hasDraft(this.opts.projectKey).then((d) => {
      this.draftWaiting = d;
    });
    await this.loadPins();
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- destroy() can run during the await above
    if (this.destroyed) return;

    // Re-place pins when the page changes underneath (SPA navigation, lazy content).
    let lastUrl = location.href;
    const observer = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        this.closeCard();
        void this.loadPins();
      } else reposition();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    this.cleanup.push(() => observer.disconnect());

    this.ready = true;
    this.startReplay();
    this.emit("ready");
    const q = new URLSearchParams(location.search);
    const deepLink = q.get("pinwren");
    const linkToken = q.get("pwt");
    // A signed link (dashboard "Open on page", reporter emails) opens the item even when pins are private.
    if (deepLink && linkToken) void this.openLinked(deepLink, linkToken);
    else if (deepLink) setTimeout(() => void this.focusPin(deepLink), 300);
    if (this.pending) {
      const { mode } = this.pending;
      this.pending = null;
      this.open(mode);
    }
  }

  destroy() {
    this.destroyed = true;
    this.outbox?.stop();
    this.modalClose?.();
    this.stopPicking();
    this.closeCard();
    this.closeMenu();
    this.closePanel();
    this.hideSelOffer();
    clearTimeout(this.previewTimer);
    for (const fn of this.cleanup) fn();
    this.cleanup = [];
    cancelAnimationFrame(this.raf);
    this.recorder?.stop();
    this.recorder = null;
    uninstallDiagnostics();
    this.host.remove();
  }

  identify(r: Identity) {
    this.identity = {
      name: r.name?.trim() || undefined,
      email: r.email?.trim() || undefined,
      id: r.id || undefined,
      signature: r.id ? r.signature : undefined,
    };
    this.applyVisibility(); // visibility mode "identified"
  }

  /** `Pinwren.show()` / `hide()`: override the visibility mode until the other one is called. */
  setShown(shown: "show" | "hide") {
    this.gate.host = shown;
    if (this.cfg !== DEFAULT_CONFIG) this.applyVisibility();
  }

  /** `Pinwren.setMetadata` (validated by index.ts): context for every report and comment from now on. */
  setMetadata(m: Record<string, unknown> | null) {
    this.metadata = m;
  }

  /** Change the page scope (wave-4 §4); the pins on the page are re-listed under it. */
  setPageScope(urlPattern: string | undefined) {
    if (urlPattern === this.urlPattern) return;
    this.urlPattern = urlPattern;
    if (this.ready) void this.loadPins();
  }

  open(mode?: Mode) {
    if (this.destroyed || this.suppressed) return;
    if (!this.ready) {
      this.pending = { mode };
      return;
    }
    this.closeMenu();
    // The screenshot taken with every comment needs SnapDOM: start fetching it while they write.
    if ((mode === "comment" || mode === "page") && this.capture.screenshotOnComment)
      preload(this.assets, "capture");
    if (mode === "comment") {
      if (this.canComment) this.startPicking();
    } else if (mode === "page") {
      if (this.canComment) this.openComposer(null);
    } else if (mode === "bug") {
      if (this.canBug) void this.startBugReport();
    } else if (mode === "panel") void this.openPanel();
    else this.openMenu();
  }

  close() {
    this.pending = null;
    this.reportWant++; // a bug report still loading won't open
    this.modalClose?.();
    this.stopPicking();
    this.closeCard();
    this.closeMenu();
    this.closePanel();
  }

  private get canComment() {
    return !this.cfg.readOnly && this.cfg.modes.comment;
  }
  private get canBug() {
    return !this.cfg.readOnly && this.cfg.modes.bug;
  }

  private emit(event: WidgetEvent, data?: unknown) {
    try {
      this.opts.emit?.(event, data);
    } catch (err) {
      console.warn("[pinwren] event handler failed", err);
    }
  }

  private active(mode: string) {
    if (this.isOpen) return;
    this.isOpen = true;
    this.emit("open", { mode });
  }

  /** Emit `close` once nothing is open — deferred so close-then-open (menu → comment) doesn't flicker. */
  private idle() {
    queueMicrotask(() => {
      if (!this.isOpen || this.picker || this.card || this.menu || this.panel || this.modalClose || this.busy)
        return;
      if (this.panelLoading || this.reportLoading) return;
      this.isOpen = false;
      this.emit("close");
    });
  }

  /** Add a guarded listener that `destroy()` removes. Errors are swallowed, never thrown at the host. */
  private listen<K extends keyof PageEventMap>(
    target: Window | Document,
    type: K,
    fn: (e: PageEventMap[K]) => void,
    opts?: AddEventListenerOptions | boolean,
  ) {
    const safe = (e: Event) => {
      try {
        fn(e as PageEventMap[K]); // addEventListener(type) only delivers events of that type
      } catch (err) {
        console.warn("[pinwren]", err);
      }
    };
    target.addEventListener(type, safe, opts);
    this.cleanup.push(() => target.removeEventListener(type, safe, opts));
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || !this.ready || this.suppressed) return;
    const path = e.composedPath();
    if (e.key === "Escape") {
      if (this.card) this.closeCard();
      else if (this.menu) this.closeMenu();
      else if (this.selOffer) this.hideSelOffer();
      else if (this.panel) this.closePanel();
      return;
    }
    if (!this.cfg.shortcuts || e.ctrlKey || e.metaKey || e.altKey) return;
    // Focus may sit on one of our own buttons (it returns to the launcher when a card closes); shortcuts work
    // there too. Typing in any field — ours or the page's — is never hijacked.
    if (isEditable(path[0] ?? e.target) || this.modalClose || e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === "c" && this.canComment) {
      e.preventDefault();
      if (this.picker) this.stopPicking();
      else this.open("comment");
    } else if (k === "b" && this.canBug) {
      e.preventDefault();
      this.open("bug");
    }
  };

  /** F-015: right-click → composer at the cursor. Only a genuine right-button click, no modifiers. */
  private onContext = (e: MouseEvent) => {
    if (
      !this.ready ||
      this.suppressed ||
      !this.cfg.rightClickComment ||
      !this.canComment ||
      e.defaultPrevented
    )
      return;
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || this.modalClose) return;
    // The context-menu key and Shift+F10 fire `contextmenu` without a right-button press — leave those alone.
    const r = this.rightDown;
    if (Date.now() - r.t > 1500 || Math.abs(e.clientX - r.x) > 4 || Math.abs(e.clientY - r.y) > 4) return;
    const path = e.composedPath();
    if (path.includes(this.host) || isEditable(path[0] ?? e.target)) return;
    if (getSelection()?.toString().trim()) {
      // They probably want "Copy", so the browser menu stays — next to it we offer to comment on the text.
      const sel = pageSelection(this.host, isEditable);
      if (sel) this.offerSelection(sel);
      return;
    }
    const el = elementAt(this.host, e.clientX, e.clientY);
    if (!el) return;
    e.preventDefault();
    this.closeMenu();
    this.openComposer({ el, x: e.clientX, y: e.clientY });
  };

  // --- Launcher and menu --------------------------------------------------------------------------

  private side(): ["top" | "bottom", "left" | "right"] {
    return this.cfg.launcher.position.split("-") as ["top" | "bottom", "left" | "right"];
  }

  private buildLauncher() {
    this.fab = new Fab({
      root: this.root,
      host: this.host,
      cfg: this.cfg,
      poweredBy: !this.branding.hidePoweredBy,
      press: () => (this.menu ? this.closeMenu() : this.open()),
      prefetch: () => this.prefetch(),
      opened: () => {
        this.prefetch();
        this.active("menu");
      },
      closed: () => this.idle(),
      actions: () => {
        const listed = this.publicRead || this.rows().length > 0;
        return {
          markers: listed ? { shown: this.showPins, toggle: () => this.toggleMarkers() } : null,
          annotate: this.canComment ? () => this.open("comment") : null,
          page: this.canComment ? () => this.open("page") : null,
          bug: this.canBug ? { draft: this.draftWaiting, run: () => this.open("bug") } : null,
          sidebar: listed ? { open: this.openCount(), run: () => this.open("panel") } : null,
          queued:
            this.queued > 0
              ? {
                  n: this.queued,
                  run: () => {
                    this.closeMenu();
                    void this.outbox?.flush(true);
                  },
                }
              : null,
        };
      },
    });
    this.launcher = this.fab.button;
  }

  private openMenu() {
    if (this.menu) return;
    this.closeCard();
    this.fab?.open();
  }

  /** The speed dial's eye: markers on or off, remembered for this visitor. */
  private toggleMarkers() {
    this.showPins = !this.showPins;
    setMarkersShown(this.opts.projectKey, this.showPins);
    this.closeMenu();
    if (!this.showPins) this.hidePreview();
    this.schedule();
  }

  private prefetched = false;
  private prefetch() {
    if (this.prefetched || !this.ready) return;
    this.prefetched = true;
    if (this.publicRead) preload(this.assets, "panel");
    if (this.canBug) preload(this.assets, "report");
  }

  private closeMenu() {
    this.fab?.close();
  }

  private toast(text: string) {
    // One at a time: toasts share a spot, so a new one replaces the last instead of stacking on it.
    for (const old of this.root.querySelectorAll(".toast")) old.remove();
    const t = h("div", { class: "toast", role: "status", "aria-live": "polite" }, text);
    this.root.append(t);
    setTimeout(() => t.remove(), 3200);
  }

  // --- Pins ---------------------------------------------------------------------------------------

  private async loadPins() {
    const seq = ++this.loadSeq;
    const withClosed = this.showResolved;
    let items: Pin[] = [];
    // Hidden by the visibility mode: no requests until the widget shows (applyVisibility lists them then).
    this.skipped = !this.gateOpen;
    if (this.publicRead && !this.skipped) {
      try {
        items = (await this.api.pins(cleanPageUrl(location.href), withClosed, this.urlPattern)).items;
      } catch {
        // Pins are a nicety; failing to load them must never break the page.
        return;
      }
    }
    // Private pins (wave-5 §3.3): the reporter's own items and items opened from a signed link still show.
    if (!this.skipped) items = mergePins(items, await this.privatePins(withClosed));
    if (seq !== this.loadSeq || this.destroyed) return;
    this.haveClosed = withClosed;
    // Optimistic pins still waiting for the server stay put.
    const keep = this.placed.filter((p) => p.pin.id.startsWith("tmp:"));
    for (const p of this.placed) if (!keep.includes(p)) this.unplace(p);
    this.placed = keep;
    // Page-level comments still on their way (optimistic or queued) stay listed too.
    this.orphans = this.orphans.filter((o) => o.id.startsWith("tmp:"));
    this.hidePreview();
    for (const pin of items) this.place(pin);
    this.schedule();
    this.updateCount();
    this.renderList();
  }

  private place(pin: Pin): Placed | null {
    const found = pin.anchor ? resolveAnchor(pin.anchor) : null;
    if (!found || !pin.anchor) {
      this.orphans.push(pin);
      return null;
    }
    const moved = found.confidence < 0.8;
    const marker = markerEl(pin);
    marker.classList.toggle("moved", moved);
    const area = isRegion(pin.anchor.pin) ? h("div", { class: `area${moved ? " moved" : ""}` }) : null;
    // A comment on selected text highlights the quote again — only while that text is still on the page.
    const tr = pin.anchor.textRange;
    const range = tr ? findQuote(found.element, tr) : null;
    const quote = range ? { range, hls: [] } : null;
    const p: Placed = { pin, el: found.element, marker, area, moved, quote, at: pin.anchor.pin };
    marker.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.openThread(pin, p);
    });
    marker.addEventListener("pointerenter", () => {
      preload(this.assets, "panel"); // a click opens the thread card, which lives in that chunk
      this.hover(p, true);
    });
    marker.addEventListener("pointerleave", () => this.hover(p, false));
    marker.addEventListener("focus", () => {
      preload(this.assets, "panel");
      this.hover(p, true);
    });
    marker.addEventListener("blur", () => this.hover(p, false));
    this.label(p);
    if (area) this.root.append(area);
    this.root.append(marker);
    this.placed.push(p);
    return p;
  }

  private unplace(p: Placed) {
    p.marker.remove();
    p.area?.remove();
    for (const el of p.quote?.hls ?? []) el.remove();
    this.placed = this.placed.filter((x) => x !== p);
  }

  private label(p: Placed) {
    const { pin } = p;
    paintMarker(p.marker, pin);
    p.marker.setAttribute(
      "aria-label",
      t("pinLabel", {
        kind: kindOf(pin.kind).label,
        n: pin.number || "",
        name: pin.reporterName ?? t("aVisitor"),
        text: pin.body.slice(0, 60),
      }) + (p.moved ? t("mayHaveMoved") : ""),
    );
  }

  private visible(p: Placed) {
    return this.showPins && (!isClosed(p.pin.status) || this.showResolved);
  }

  /** The pin's point or region on screen right now, or null when its element is gone or hidden. */
  private boxOf(p: Placed): Box | null {
    if (!p.el.isConnected) return null;
    const r = p.el.getBoundingClientRect();
    if (r.width + r.height === 0) return null;
    const end = p.quote && quoteEnd(p.quote.range);
    return end ?? pinBox(r, p.at);
  }

  /** What a card attached to this pin must stay clear of: the marker, plus the region or quoted text. */
  private targetOf(p: Placed): Box | null {
    const b = this.boxOf(p);
    if (!b) return null;
    const q = p.quote && union(textRects(p.quote.range));
    return q ? union([q, withMarker(b, false)]) : withMarker(b, !!p.area);
  }

  /** Lay highlight boxes over a quoted range (re-using the elements from the last frame). */
  private paintQuote(q: Quote, cls: string, show: boolean) {
    const rects = show ? textRects(q.range, 60) : [];
    while (q.hls.length > rects.length) q.hls.pop()?.remove();
    while (q.hls.length < rects.length) {
      const el = h("div", { "aria-hidden": "true" });
      q.hls.push(el);
      this.root.prepend(el); // under pins and cards
    }
    for (const [i, r] of rects.entries()) {
      const el = q.hls[i];
      if (!el) continue; // one element per rect was ensured above
      el.className = cls;
      box(el, { left: r.left, top: r.top, width: r.width, height: r.height });
    }
  }

  private schedule() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => {
      try {
        this.frame();
      } catch (err) {
        console.warn("[pinwren]", err);
      }
    });
  }

  private frame() {
    for (const p of this.placed) {
      const b = this.visible(p) ? this.boxOf(p) : null;
      p.marker.hidden = !b;
      if (p.area) p.area.hidden = !b;
      p.marker.classList.toggle("resolved", isClosed(p.pin.status));
      if (p.quote) {
        const hot = p.marker.classList.contains("active") || this.preview?.p === p;
        this.paintQuote(p.quote, `hl${hot ? " hot" : ""}${p.moved ? " moved" : ""}`, !!b);
      }
      if (!b) continue;
      if (p.area) box(p.area, b);
      // Centred on the pin; for regions on the top-right corner.
      const at = markerSpot(b);
      p.marker.style.left = `${at.left}px`;
      p.marker.style.top = `${at.top}px`;
    }
    if (this.draft) {
      const r = this.draft.el.getBoundingClientRect();
      const q = this.draft.quote;
      if (q) this.paintQuote(q, "hl draft", true);
      const b = (q ? quoteEnd(q.range) : null) ?? pinBox(r, this.draft.pin);
      if (isRegion(this.draft.pin)) box(this.draft.node, b);
      else {
        const at = markerSpot(b);
        this.draft.node.style.left = `${at.left}px`;
        this.draft.node.style.top = `${at.top}px`;
      }
    }
    if (this.card) this.position(this.card.el, this.card.target());
    if (this.selOffer) this.placeSelOffer();
    if (this.preview) {
      const t = this.targetOf(this.preview.p);
      if (t) {
        this.position(this.preview.el, t);
        this.placeRing();
      } else this.hidePreview();
    }
    this.picker?.refresh();
  }

  private position(el: HTMLElement, target: Box | null) {
    const sheet = innerWidth < SHEET && !el.classList.contains("preview");
    el.classList.toggle("sheet", sheet);
    if (sheet) {
      el.style.left = el.style.top = "";
      return;
    }
    const inset = this.panel ? PANEL_W : 0;
    const t = target ?? { left: innerWidth, top: 64, width: 0, height: 0 };
    const pos = placeCard(
      t,
      { width: el.offsetWidth, height: el.offsetHeight },
      innerWidth,
      innerHeight,
      inset,
    );
    el.style.left = `${pos.left}px`;
    el.style.top = `${pos.top}px`;
  }

  private openCount() {
    return [...this.placed.map((p) => p.pin), ...this.orphans].filter((p) => !isClosed(p.status)).length;
  }

  private updateCount() {
    this.fab?.setCount(this.openCount());
  }

  private hover(p: Placed, on: boolean) {
    p.area?.classList.toggle("hot", on || this.card?.id === p.pin.id);
    clearTimeout(this.previewTimer);
    if (!on) {
      this.hidePreview();
      this.schedule();
      return;
    }
    if (this.card?.id === p.pin.id) return;
    this.previewTimer = window.setTimeout(() => {
      this.showPreview(p);
      this.schedule();
    }, 120);
  }

  /** The hover card (kind, time, the first lines) and an outline around the marker's element. */
  private showPreview(p: Placed) {
    this.hidePreview();
    const { pin } = p;
    const el = h(
      "div",
      { class: "card preview", role: "tooltip" },
      h(
        "div",
        { class: "meta" },
        tag(pin.kind),
        pin.number ? h("span", { class: "muted" }, `#${pin.number}`) : null,
        p.moved && h("span", { class: "chip warn" }, t("moved")),
        isClosed(pin.status) && h("span", { class: "chip ok" }, t("resolved")),
        h("span", { class: "muted when" }, ago(pin.createdAt)),
      ),
      pin.title && h("b", { class: "title" }, pin.title),
      p.quote && h("p", { class: "quote" }, pin.anchor?.textRange?.quote ?? ""),
      h("p", { class: "text clamp" }, pin.body),
      h(
        "span",
        { class: "muted" },
        shortName(pin.reporterName),
        pin.replyCount > 0 ? ` · ${tn("reply", pin.replyCount)}` : "",
      ),
    );
    const ring = h("div", { class: "ring", style: `--c:${kindOf(pin.kind).color}`, "aria-hidden": "true" });
    this.preview = { el, ring, p };
    this.root.append(ring, el);
    this.position(el, this.targetOf(p));
    this.placeRing();
  }

  /** Outline the anchored element of a point marker (regions and quotes are highlighted already). */
  private placeRing() {
    const pv = this.preview;
    if (!pv) return;
    const r = !pv.p.area && !pv.p.quote && pv.p.el.isConnected ? pv.p.el.getBoundingClientRect() : null;
    pv.ring.hidden = !r || r.width + r.height === 0;
    if (r) box(pv.ring, { left: r.left - 4, top: r.top - 4, width: r.width + 8, height: r.height + 8 });
  }

  private hidePreview() {
    this.preview?.el.remove();
    this.preview?.ring.remove();
    this.preview = null;
  }

  private async focusPin(id: string) {
    const find = () => ({
      p: this.placed.find((x) => x.pin.id === id),
      o: this.orphans.find((x) => x.id === id),
    });
    let { p, o } = find();
    if (!p && !o && !this.haveClosed) {
      // The linked comment may be resolved — look again including closed ones.
      this.showResolved = true;
      await this.loadPins();
      ({ p, o } = find());
      if (!p && !o) this.showResolved = false;
    }
    if (p) {
      const target = p;
      target.el.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" });
      setTimeout(() => {
        target.marker.classList.add("pulse");
        void this.openThread(target.pin, target);
      }, 450);
    } else if (o) {
      await this.openPanel();
      void this.openThread(o, null);
    }
  }

  // --- Cards --------------------------------------------------------------------------------------

  private showCard(card: Card, opener?: Element | null) {
    // Whatever had focus (a pin, a panel row, the launcher) gets it back when the card closes.
    const was = opener ?? focused(this.root);
    this.closeCard();
    this.hidePreview();
    this.card = card;
    this.root.append(card.el);
    card.release = trapFocus(card.el, was, this.launcher);
    this.position(card.el, card.target());
    this.active(card.kind);
    this.schedule();
  }

  private closeCard() {
    if (!this.card) return;
    const c = this.card;
    this.card = null;
    c.release?.();
    c.el.remove();
    c.off?.();
    this.draft?.node.remove();
    for (const el of this.draft?.quote?.hls ?? []) el.remove();
    this.draft = null;
    this.schedule();
    this.idle();
  }

  // --- Comment mode -------------------------------------------------------------------------------

  private startPicking() {
    if (this.picker) return;
    this.closeCard();
    this.hidePreview();
    if (innerWidth < SHEET) this.closePanel();
    // Read before the shield goes up: text the visitor selected is offered as the thing to comment on.
    const sel = pageSelection(this.host, isEditable);
    this.picker = new Picker(this.host, this.root, (pick) => {
      if (pick) this.openComposer(pick);
      else this.stopPicking();
    });
    this.root.classList.add("picking");
    if (sel) this.offerSelection(sel);
    this.active("comment");
  }

  private stopPicking() {
    if (!this.picker) return;
    this.picker.stop();
    this.picker = null;
    this.root.classList.remove("picking");
    this.hideSelOffer();
    this.idle();
  }

  // --- Comment on selection -----------------------------------------------------------------------

  private offerSelection(sel: Selected) {
    this.hideSelOffer();
    const el = h(
      "button",
      { class: "selbtn", onclick: () => this.commentOnSelection(sel) },
      icon(ICONS.comment),
      t("commentOnSelection"),
    );
    // Keep the page selection: a press on the button must not collapse it.
    el.addEventListener("pointerdown", (e) => e.preventDefault());
    this.selOffer = { el, sel };
    this.root.append(el);
    this.placeSelOffer();
  }

  /** Under the end of the selection (above its start if there's no room), inside the viewport. */
  private placeSelOffer() {
    const o = this.selOffer;
    if (!o) return;
    const rects = textRects(o.sel.range, 200);
    const first = rects[0];
    const last = rects.at(-1);
    if (!first || !last) {
      this.hideSelOffer();
      return;
    }
    const w = o.el.offsetWidth || 180;
    const hgt = o.el.offsetHeight || 32;
    let top = last.bottom + 8;
    if (top + hgt > innerHeight - 8) top = first.top - hgt - 8;
    o.el.style.left = `${Math.max(8, Math.min(last.right - w / 2, innerWidth - w - 8))}px`;
    o.el.style.top = `${Math.max(8, Math.min(top, innerHeight - hgt - 8))}px`;
  }

  private hideSelOffer() {
    this.selOffer?.el.remove();
    this.selOffer = null;
  }

  private commentOnSelection(sel: Selected) {
    this.hideSelOffer();
    if (!this.canComment || !sel.el.isConnected) return;
    const end = quoteEnd(sel.range);
    const r = sel.el.getBoundingClientRect();
    this.closeMenu();
    this.openComposer({ el: sel.el, x: end?.left ?? r.left, y: end?.top ?? r.top, range: sel.range });
    getSelection()?.removeAllRanges(); // our highlight takes over from the browser's
  }

  /** `pick` null: a comment on the whole page (wave-5 §3.3) — no anchor and no marker; it lists as page-level. */
  private openComposer(
    pick: (Pick & { range?: Range }) | null,
    restore?: { text: string; kind: Kind; error: string; clientId: string; files?: Attachment[] },
  ) {
    this.stopPicking();
    const anchor = pick ? captureAnchor(pick.el, pick.x, pick.y) : undefined;
    if (pick && anchor) {
      if (pick.region) anchor.pin = regionPin(pick.el.getBoundingClientRect(), pick.region);
      if (pick.range) anchor.textRange = toTextRange(pick.el, pick.range);
    }
    const quote = pick?.range ? { range: pick.range, hls: [] } : null;
    const region = !!anchor && isRegion(anchor.pin);
    const clientId = restore?.clientId ?? uuid();
    const chips = kindChips(restore?.kind ?? null, () => text.focus());
    const text = h("textarea", {
      placeholder: !anchor
        ? t("pagePlaceholder")
        : quote
          ? t("selectionPlaceholder")
          : region
            ? t("regionPlaceholder")
            : t("commentPlaceholder"),
      "aria-label": t("yourComment"),
      maxlength: 10000,
    });
    text.value = restore?.text ?? "";
    autosize(text);

    const ident = identityFields(this.identity, { requireName: this.reviewGuest });
    const consent = consentBlock(this.cfg.consent, this.opts.projectKey);

    const error = h("p", { class: "err", role: "alert" }, restore?.error ?? "");
    // Attachments (wave-5 §3.3): the picker is native (a file dialog); reading and the chips live in widget-flows.js.
    let files: AttachBox | null = null;
    const filesSlot = h("div", {});
    const mountFiles = async (list: File[], initial?: Attachment[]) => {
      const m = await this.flowsMod();
      if (!m) return;
      files ??= m.attachBox(
        this.root,
        (msg) => {
          error.textContent = msg;
        },
        initial,
      );
      filesSlot.replaceChildren(files.el);
      if (list.length) await files.add(list);
      this.schedule();
    };
    const input = h("input", {
      type: "file",
      multiple: true,
      hidden: true,
      accept: "image/png,image/jpeg,image/webp,image/gif,application/pdf",
    });
    input.addEventListener("change", () => {
      const list = Array.from(input.files ?? []);
      input.value = "";
      if (list.length) void mountFiles(list);
    });
    const attach = h(
      "button",
      {
        class: "ib",
        type: "button",
        "aria-label": t("attachFiles"),
        title: t("attachFiles"),
        onclick: () => input.click(),
      },
      icon(ICONS.clip),
    );
    if (restore?.files?.length) void mountFiles([], restore.files);
    const send = h("button", { class: "btn primary" }, consent.need ? t("agreeSend") : t("send"));
    const mac = /Mac|iPhone|iPad/.test(navigator.userAgent);
    text.setAttribute("aria-keyshortcuts", mac ? "Meta+Enter" : "Control+Enter");
    send.disabled = !text.value.trim();
    let warned = false;

    const submit = () => {
      const body = text.value.trim();
      if (!body) {
        error.textContent = t("writeFirst");
        text.focus();
        return;
      }
      const bad = ident.invalid();
      if (bad) {
        error.textContent = bad.message;
        bad.el.focus();
        return;
      }
      consent.accept();
      void this.submitComment(
        pick,
        anchor,
        chips.value(),
        body,
        ident.read() ?? {},
        clientId,
        consent.record(),
        files?.list() ?? [],
      );
    };
    send.addEventListener("click", submit);
    text.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && text.value.trim() && !warned) {
        e.preventDefault();
        warned = true;
        error.textContent = t("escAgain");
      }
    });
    text.addEventListener("input", () => {
      warned = false;
      error.textContent = "";
      send.disabled = !text.value.trim();
    });

    const el = h(
      "div",
      { class: "card composer", role: "dialog", "aria-label": t("newComment") },
      chips.el,
      anchor?.textRange &&
        h("blockquote", { class: "quote", "aria-label": t("selectedText") }, anchor.textRange.quote),
      text,
      h("span", { class: "muted hintl", "aria-hidden": "true" }, mac ? t("sendHintMac") : t("sendHint")),
      filesSlot,
      ...ident.els,
      consent.el,
      error,
      h(
        "div",
        { class: "foot" },
        attach,
        input,
        h("span", { class: "grow" }),
        h("button", { class: "btn ghost", onclick: () => this.closeCard() }, t("cancel")),
        send,
      ),
    );
    // "Ctrl+Enter to send" holds in every field of the card (name, email), not just the comment.
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submit();
      }
    });

    this.showCard({
      el,
      kind: "composer",
      dirty: () => !!text.value.trim() || !!files?.list().length,
      target: () => {
        if (!pick || !anchor) return null; // page-level: the card sits at the side
        const q = quote && union(textRects(quote.range, 200));
        const end = quote && quoteEnd(quote.range);
        if (q && end) return union([q, withMarker(end, false)]);
        const r = pick.el.getBoundingClientRect();
        return withMarker(pinBox(r, anchor.pin), region);
      },
    });
    if (pick && anchor) {
      const node = region
        ? h("div", { class: "area draft" })
        : h("div", { class: "pin draft", "aria-hidden": "true" }, icon(ICONS.plus));
      this.draft = { el: pick.el, pin: anchor.pin, node, quote };
      this.root.append(node);
    }
    this.frame();
    text.focus();
  }

  private async submitComment(
    pick: (Pick & { range?: Range }) | null,
    anchor: AnchorBundle | undefined,
    kind: Kind,
    body: string,
    reporter: NonNullable<FeedbackPayload["reporter"]>,
    clientId: string,
    consent: FeedbackPayload["consent"],
    files: Attachment[] = [],
  ) {
    // Optimistic: the pin appears now and gets its number when the server answers.
    const pin: Pin = {
      id: `tmp:${clientId}`,
      number: 0,
      kind,
      status: "open",
      body: body.slice(0, 500),
      anchor: anchor ?? null,
      createdAt: new Date().toISOString(),
      reporterName: reporter.name ?? null,
      replyCount: 0,
      pageUrl: cleanPageUrl(location.href),
    };
    this.closeCard();
    const placed = this.place(pin);
    placed?.marker.classList.add("pending");
    this.busy = true;
    this.schedule();
    this.updateCount();
    this.renderList();
    // "Screenshot with every comment": the page as the commenter saw it, for Page Review. It never holds the
    // comment up for long — past the timeout (or on any failure) the comment goes without it.
    const shot = this.capture.screenshotOnComment
      ? await loadChunk<FlowsModule>(this.assets, "flows")
          .then((m) =>
            m.commentShot(
              this.assets,
              this.cfg.privacyMode
                ? [...this.capture.maskSelectors, ...PRIVACY_MASKS]
                : this.capture.maskSelectors,
            ),
          )
          .catch(() => null)
      : null;
    const payload: FeedbackPayload = {
      clientId,
      kind,
      body,
      page: {
        url: cleanPageUrl(location.href),
        title: document.title.slice(0, 300),
        ...(this.urlPattern ? { urlPattern: this.urlPattern } : {}),
      },
      ...(anchor ? { anchor } : {}),
      environment: environment(this.cfg.privacyMode),
      reporter: reporter.name || reporter.email || reporter.externalId ? reporter : undefined,
      diagnostics: kind === "bug" ? snapshotDiagnostics() : undefined,
      consent,
      metadata: mergeMetadata(this.metadata, undefined),
      ...(shot ?? {}),
      attachments: files.length
        ? (files.map((f) => ({
            name: f.name,
            contentType: f.contentType,
            dataUrl: f.dataUrl,
          })) as FeedbackPayload["attachments"])
        : undefined,
    };
    try {
      const { feedback } = await this.api.submit(payload);
      this.confirmPin(pin, placed, feedback);
      this.toast(t("sent", { n: feedback.number }));
      this.emit("submit", { id: feedback.id, number: feedback.number, kind });
    } catch (err) {
      if (isRetryable(err) && this.outbox) {
        // Offline or the server is struggling: the comment waits in the outbox (same clientId, so a late
        // success isn't doubled) and goes out by itself; its pin stays, marked as waiting.
        await this.outbox.add(clientId, payload);
        this.queuedPins.set(clientId, { pin, placed });
        placed?.marker.classList.add("queued");
        this.toast(t("commentQueued"));
        return;
      }
      if (placed) this.unplace(placed);
      else this.orphans = this.orphans.filter((o) => o !== pin);
      this.emit("error", { message: errText(err) });
      if (!this.destroyed && (!pick || pick.el.isConnected))
        this.openComposer(pick, { text: body, kind, error: errText(err), clientId, files });
      else this.toast(errText(err));
    } finally {
      this.busy = false;
      this.updateCount();
      this.renderList();
      this.idle();
    }
  }

  /** The server took the comment: the optimistic pin gets its id and number, and this browser its token. */
  private confirmPin(pin: Pin, placed: Placed | null, feedback: Created["feedback"]) {
    pin.id = feedback.id;
    pin.number = feedback.number;
    store.addMine(this.opts.projectKey, { id: feedback.id, token: feedback.reporterToken });
    if (placed) {
      placed.marker.classList.remove("pending", "queued");
      this.label(placed);
    }
  }

  /** The viewer chunk (side panel + thread card), or null after telling the visitor it couldn't load. */
  private async viewer(): Promise<PanelModule | null> {
    try {
      return await loadChunk<PanelModule>(this.assets, "panel");
    } catch (err) {
      console.warn("[pinwren]", err);
      if (!this.destroyed) this.toast(t("loadFailed"));
      return null;
    }
  }

  private threadSeq = 0;

  private async openThread(pin: Pin, p: Placed | null) {
    if (pin.id.startsWith("tmp:")) return;
    const seq = ++this.threadSeq;
    const opener = focused(this.root);
    const mod = await this.viewer();
    if (!mod || seq !== this.threadSeq || this.destroyed) return;
    if (innerWidth < SHEET) this.closePanel();
    const el = mod.threadCard(
      {
        root: this.root,
        cfg: this.cfg,
        projectKey: this.opts.projectKey,
        projectSlug: this.projectSlug,
        identity: () => this.identity,
        // Private items: replies are read and written with this browser's reporter token or the page link.
        api: {
          replies: (id) => this.api.replies(id, this.access(id)),
          reply: (id, text, author) => this.api.reply(id, text, author, this.access(id)),
          setStatus: (id, status, token) => this.api.setStatus(id, status, token),
        },
        toast: (text) => this.toast(text),
        error: (message) => this.emit("error", { message }),
        close: () => this.closeCard(),
        statusChanged: () => {
          this.schedule();
          this.updateCount();
          this.renderList();
        },
        replied: () => this.renderList(),
        isOpen: (card) => this.card?.el === card,
        relayout: () => this.schedule(),
      },
      pin,
      { onPage: !!p, moved: !!p?.moved },
    );
    p?.marker.classList.add("active");
    p?.area?.classList.add("hot");
    // Bring a pin that sits at the viewport edge into view; the card follows it as the page scrolls.
    const at = p && this.boxOf(p);
    if (at && (at.top < 48 || at.top + at.height > innerHeight - 48))
      scrollBy({ top: at.top + at.height / 2 - innerHeight / 2, behavior: reduced() ? "auto" : "smooth" });
    this.showCard(
      {
        el,
        kind: "thread",
        id: pin.id,
        target: () => (p ? this.targetOf(p) : null),
        off: () => {
          p?.marker.classList.remove("active");
          p?.area?.classList.remove("hot");
        },
      },
      opener,
    );
    el.focus({ preventScroll: true });
  }

  // --- Side panel (F-011), lazy widget-panel.js ---------------------------------------------------

  private async openPanel(): Promise<void> {
    if (this.panel || this.panelLoading) return;
    this.closeMenu();
    const want = ++this.panelWant;
    this.panelLoading = true;
    let mod: PanelModule;
    try {
      mod = await loadChunk<PanelModule>(this.assets, "panel");
    } catch (err) {
      console.warn("[pinwren]", err);
      if (want === this.panelWant && !this.destroyed) this.toast(t("loadFailed"));
      return;
    } finally {
      this.panelLoading = false;
      this.idle();
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- destroy() can run during the await above
    if (want !== this.panelWant || this.destroyed || this.panel) return;
    this.panel = new mod.Panel({
      root: this.root,
      cfg: this.cfg,
      projectKey: this.opts.projectKey,
      api: this.api,
      rows: () => this.rows(),
      canComment: this.canComment,
      shortcuts: this.cfg.shortcuts,
      openItem: (row) => this.flashItem(row),
      close: () => this.closePanel(),
      pageUrl: () => location.href,
      toast: (text) => this.toast(text),
      refresh: () => void this.loadPins(),
    });
    this.updateCount();
    this.schedule();
    this.active("panel");
  }

  private rows(): PanelRow[] {
    return [
      ...this.placed.map((p) => ({ pin: p.pin, onPage: true, moved: p.moved })),
      ...this.orphans.map((pin) => ({ pin, onPage: false, moved: false })),
    ];
  }

  private closePanel() {
    this.panelWant++;
    const panel = this.panel;
    if (!panel) return;
    this.panel = null;
    const had = panel.el.contains(focused(this.root));
    panel.destroy();
    if (had) this.launcher?.focus({ preventScroll: true });
    this.schedule();
    this.idle();
  }

  /** A sidebar card was picked: bring its marker into view, flash it and open the thread. */
  private flashItem(row: PanelRow) {
    const p = this.placed.find((x) => x.pin.id === row.pin.id);
    if (!p) {
      void this.openThread(row.pin, null);
      return;
    }
    p.el.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" });
    p.marker.classList.remove("pulse");
    p.marker.getBoundingClientRect(); // a reflow restarts the animation
    p.marker.classList.add("pulse");
    setTimeout(() => p.marker.classList.remove("pulse"), 3200);
    setTimeout(() => void this.openThread(p.pin, p), reduced() ? 0 : 350);
  }

  private renderList() {
    this.panel?.render();
  }

  // --- Bug report mode (F-003) and offline outbox (F-010) ------------------------------------------

  private startOutbox() {
    const project = this.opts.projectKey;
    this.outbox = new Outbox<FeedbackPayload, Created>({
      kv: idbKV("outbox"),
      project,
      send: (p) => this.api.submitOnce(p),
      onSent: (item, { feedback }) => {
        store.addMine(project, { id: feedback.id, token: feedback.reporterToken });
        // A queued comment (wave-5 §3.3): its waiting pin gets its number.
        const q = this.queuedPins.get(item.clientId);
        if (q) {
          this.queuedPins.delete(item.clientId);
          this.confirmPin(q.pin, q.placed, feedback);
          this.updateCount();
          this.renderList();
        }
        this.toast(t("queuedSentToast", { n: feedback.number }));
        this.emit("submit", { id: feedback.id, number: feedback.number, kind: item.payload.kind });
      },
      onDropped: (_item, err) => this.emit("error", { message: errText(err) }),
      onChange: (n) => {
        this.queued = n;
        this.launcher?.classList.toggle("queued", n > 0);
      },
    });
    this.listen(window, "online", () => void this.outbox?.flush(true));
    // Reports left over from an earlier visit (offline, crash, server error) go out now.
    void this.outbox.flush(true);
  }

  private async startBugReport() {
    if (this.busy || this.modalClose || this.reportLoading) return;
    const opener = focused(this.root);
    this.closeCard();
    this.closePanel();
    this.active("bug");
    // What happened before the report opened is what matters: the replay is frozen now, packed on send.
    const replay = this.replayOffer();
    // The form, the screenshot engine and the annotation editor load side by side.
    const want = ++this.reportWant;
    this.reportLoading = true;
    preload(this.assets, "capture");
    preload(this.assets, "editor");
    let mod: ReportModule;
    try {
      mod = await loadChunk<ReportModule>(this.assets, "report");
    } catch (err) {
      console.warn("[pinwren]", err);
      if (want === this.reportWant && !this.destroyed) {
        this.toast(t("loadFailed"));
        this.emit("error", { message: t("loadFailed") });
      }
      return;
    } finally {
      this.reportLoading = false;
      this.idle();
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- destroy() can run during the await above
    if (want !== this.reportWant || this.destroyed || this.modalClose) return;
    const masks = this.cfg.privacyMode
      ? [...this.capture.maskSelectors, ...PRIVACY_MASKS]
      : this.capture.maskSelectors;
    const report = new mod.BugReport({
      host: this.host,
      root: this.root,
      assets: this.assets,
      project: this.opts.projectKey,
      cfg: this.cfg,
      capture: { ...this.capture, maskSelectors: masks },
      branding: this.branding,
      opener: opener && opener !== document.body ? opener : this.launcher,
      identity: this.identity,
      reviewGuest: this.reviewGuest,
      urlPattern: this.urlPattern,
      metadata: () => this.metadata,
      replay,
      submit: (p) => this.api.submitOnce(p),
      queue: async (id, p) => {
        await this.outbox?.add(id, p);
      },
      toast: (text) => this.toast(text),
      sent: (id, number, token) => {
        store.addMine(this.opts.projectKey, { id, token });
        this.emit("submit", { id, number, kind: "bug" });
        // The report is the reporter's own item now: the sidebar and the badge count it (private pins too).
        void this.loadPins();
      },
      error: (message) => this.emit("error", { message }),
      done: () => {
        this.modalClose = null;
        void hasDraft(this.opts.projectKey).then((d) => {
          this.draftWaiting = d;
        });
        this.idle();
      },
    });
    this.modalClose = () => report.close();
    try {
      await report.start();
    } catch (err) {
      console.warn("[pinwren]", err);
      report.close(false);
    }
  }

  // --- Visibility mode, private pins, signed links, re-pin (wave-5 §2, §3.3) ---------------------------

  /** Whether the visibility mode lets the widget show (`forceShow` overrides every rule). */
  private get gateOpen(): boolean {
    if (this.opts.forceShow === true) return true;
    return allowedByMode(this.cfg.visibility, {
      ...this.gate,
      url: location.href,
      identified: !!(this.identity.id || this.identity.email),
    });
  }

  /** `?<queryParam>` and a review link (`?pinwren_review=`), remembered for this browser session. */
  private async initGate() {
    const v = this.cfg.visibility;
    const key = this.opts.projectKey;
    const q = new URLSearchParams(location.search);
    if (q.has(v.queryParam)) session.set(`pinwren:qp:${key}`, "1");
    this.gate.flagged = session.get(`pinwren:qp:${key}`) === "1";
    // Checked in every mode, "always" included: a valid link also marks the guest's reports with its source.
    const token = q.get("pinwren_review") ?? session.get(`pinwren:review:${key}`);
    if (!token || !/^[\w-]{16,200}$/.test(token)) return;
    const valid = await this.api.reviewLink(token);
    this.gate.review = valid;
    this.reviewGuest = valid;
    this.api.reviewToken = valid ? token : null;
    if (valid) session.set(`pinwren:review:${key}`, token);
    else session.del(`pinwren:review:${key}`);
  }

  /** Show or hide the whole widget for the viewport rule and the visibility mode. */
  private applyVisibility() {
    const hide = this.narrow || !this.gateOpen;
    if (hide !== this.suppressed) {
      this.suppressed = hide;
      if (hide) this.close();
      this.host.style.setProperty("display", hide ? "none" : "block", "important");
    }
    if (!hide && this.skipped && this.ready) void this.loadPins();
  }

  /** What opens a private item for this browser: its reporter token, or the signed link it came from. */
  private access(id: string): Access {
    return {
      reporter: store.mine(this.opts.projectKey).find((m) => m.id === id)?.token,
      link: this.links.get(id),
    };
  }

  /** This browser's own items (when pins are private, matched to this page by the server) and linked items. */
  private async privatePins(withClosed: boolean): Promise<Pin[]> {
    const here = cleanPageUrl(location.href);
    // A linked item belongs to the page it was opened on; after SPA navigation it stays behind.
    const out = [...this.linked.values()].filter((p) => !p.pageUrl || samePath(p.pageUrl, here));
    if (!this.publicRead) {
      const tokens = store.mine(this.opts.projectKey).flatMap((m) => (m.token ? [m.token] : []));
      if (tokens.length) {
        try {
          out.push(...(await this.api.mine(tokens, here, this.urlPattern)).items);
        } catch {
          // Like the public list, a nicety: the page keeps working without it.
        }
      }
    }
    return out.filter((p) => withClosed || !isClosed(p.status));
  }

  /** `?pinwren=<id>&pwt=<token>`: open the item (and its thread) even when pins are private; a re-pin link starts re-pin mode. */
  private async openLinked(id: string, token: string) {
    let res: Awaited<ReturnType<WidgetApi["linked"]>>;
    try {
      res = await this.api.linked(id, token);
    } catch (err) {
      // A forged, expired or foreign link is a 404: say so instead of a generic error.
      if (!this.destroyed)
        this.toast(err instanceof HttpError && err.status === 404 ? t("linkExpired") : errText(err));
      return;
    }
    if (this.destroyed) return;
    this.links.set(id, token);
    this.linked.set(id, res.item);
    // The link is the invitation: it shows the widget whatever the visibility mode says.
    this.gate.review = true;
    this.applyVisibility();
    await this.loadPins();
    if (res.scope === "repin") void this.repin(res.item, token);
    else setTimeout(() => void this.focusPin(id), 300);
  }

  /** Re-pin mode (F-031): the team member picks the right spot; the new anchor replaces the old one. */
  private async repin(pin: Pin, token: string) {
    const m = await this.flowsMod();
    if (!m || this.destroyed) return;
    this.close();
    m.startRepin({
      host: this.host,
      root: this.root,
      number: pin.number,
      anchorOf: (pick) => {
        const a = captureAnchor(pick.el, pick.x, pick.y);
        if (pick.region) a.pin = regionPin(pick.el.getBoundingClientRect(), pick.region);
        return a;
      },
      save: async (anchor) => {
        await this.api.repin(pin.id, anchor, token);
        pin.anchor = anchor;
      },
      toast: (text) => this.toast(text),
      done: (moved) => {
        if (moved) void this.loadPins().then(() => this.focusPin(pin.id));
      },
    });
  }

  /** The lazy widget-flows.js chunk (composer attachments, re-pin), or null after saying it didn't load. */
  private async flowsMod(): Promise<FlowsModule | null> {
    try {
      return await loadChunk<FlowsModule>(this.assets, "flows");
    } catch (err) {
      console.warn("[pinwren]", err);
      if (!this.destroyed) this.toast(t("loadFailed"));
      return null;
    }
  }

  // --- Session replay (F-007), lazy widget-replay.js ----------------------------------------------

  /**
   * Start recording when the project turned replay on — in privacy mode only if the host page explicitly
   * allowed it. Recording starts when the browser is idle and stays in memory; it's only sent inside a bug
   * report, after the consent notice where there is one, and the reporter can leave it out.
   */
  private startReplay() {
    const r = this.capture.replay;
    if (!r.enabled || (this.cfg.privacyMode && !this.opts.allowReplayInPrivacyMode)) return;
    if (!("CompressionStream" in window)) return; // the upload must be gzip (wave-4 §3)
    const go = () => {
      loadChunk<ReplayModule>(this.assets, "replay")
        .then((m) => {
          if (this.destroyed || this.recorder) return;
          this.replayMod = m;
          this.recorder = m.startReplay({
            seconds: r.seconds,
            maskSelectors: this.capture.maskSelectors,
            maskAllText: this.cfg.privacyMode,
          });
        })
        .catch((err: unknown) => console.warn("[pinwren]", err));
    };
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(go, { timeout: 5000 });
      this.cleanup.push(() => cancelIdleCallback(id));
    } else {
      const id = setTimeout(go, 1500);
      this.cleanup.push(() => clearTimeout(id));
    }
  }

  private replayOffer(): ReplayOffer | null {
    const frozen = this.recorder?.freeze();
    const mod = this.replayMod;
    if (!frozen || !mod) return null;
    return { seconds: this.capture.replay.seconds, pack: () => mod.pack(frozen) };
  }
}

/** The box a card must not cover: the marker, plus the region it sits on. */
function withMarker(b: Box, region: boolean): Box {
  const at = markerSpot(b);
  const m = { left: at.left, top: at.top, width: MARKER, height: MARKER };
  return region ? (union([b, m]) ?? m) : m;
}

/** `a` plus the items of `b` it doesn't have yet (by id). */
function mergePins(a: readonly Pin[], b: readonly Pin[]): Pin[] {
  const seen = new Set(a.map((p) => p.id));
  return [...a, ...b.filter((p) => !seen.has(p.id) && seen.add(p.id))];
}

/** Same origin and path (trailing slash aside): the page a linked item was left on. */
function samePath(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && trimTrailingSlashes(x.pathname) === trimTrailingSlashes(y.pathname);
  } catch {
    return false;
  }
}

/** sessionStorage, which can be missing or throw (private mode, blocked storage): best effort only. */
const session = {
  get(k: string): string | null {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      // the flag just won't outlive this page
    }
  },
  del(k: string) {
    try {
      sessionStorage.removeItem(k);
    } catch {
      // nothing stored
    }
  },
};

/** The point a quote's marker sits on: the top-right of its first line, so the marker never covers the text. */
function quoteEnd(range: Range): Box | null {
  const first = textRects(range, 1)[0];
  return first ? { left: first.right, top: first.top, width: 0, height: 0 } : null;
}

function union(boxes: readonly { left: number; top: number; width: number; height: number }[]): Box | null {
  if (!boxes.length) return null;
  let l = Infinity;
  let tp = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  for (const x of boxes) {
    l = Math.min(l, x.left);
    tp = Math.min(tp, x.top);
    r = Math.max(r, x.left + x.width);
    b = Math.max(b, x.top + x.height);
  }
  return { left: l, top: tp, width: r - l, height: b - tp };
}

function box(el: HTMLElement, b: Box) {
  el.style.left = `${b.left}px`;
  el.style.top = `${b.top}px`;
  el.style.width = `${b.width}px`;
  el.style.height = `${b.height}px`;
}
