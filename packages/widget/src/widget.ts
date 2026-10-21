import type { AnchorBundle, WidgetFeedbackCreate } from "@annota/core";
import { captureAnchor, resolveAnchor } from "./anchor";
import { type Created, type Pin, WidgetApi } from "./api";
import { type CaptureCfg, DEFAULT_CONFIG, type WidgetConfig } from "./config";
import { installDiagnostics, snapshotDiagnostics } from "./diagnostics";
import { h, ICONS, icon } from "./dom";
import { environment, errText as errOr, uuid } from "./env";
import { consentBlock, identityFields } from "./form";
import { loadLocale, pickLocale, t, tn } from "./i18n";
import { idbKV } from "./idb";
import { elementAt, type Pick, Picker } from "./picker";
import { Outbox } from "./queue";
import { type Box, isRegion, type PinPct, pinBox, placeCard, regionPin } from "./region";
import { BugReport, hasDraft } from "./report";
import { type Reporter, store } from "./store";
import { STYLES } from "./styles";
import {
  ago,
  avatar,
  colorFor,
  isClosed,
  isEditable,
  KIND_LIST,
  type Kind,
  kindOf,
  shortName,
  tag,
} from "./ui";

export type WidgetEvent = "open" | "close" | "submit" | "error";
export type Mode = "comment" | "bug" | "panel";
export type WidgetOptions = {
  projectKey: string;
  endpoint: string;
  accent?: string | undefined;
  emit?: (event: WidgetEvent, data?: unknown) => void;
  identity?: Reporter;
  /** `data-locale` from the script tag; otherwise the browser's languages decide. */
  locale?: string | undefined;
};

type Placed = { pin: Pin; el: Element; marker: HTMLButtonElement; area: HTMLElement | null; moved: boolean };
type Card = {
  el: HTMLElement;
  target: () => Box | null;
  kind: "composer" | "thread";
  id?: string;
  off?: () => void;
  /** Composer only: true once the person typed something, so an outside click doesn't discard it. */
  dirty?: () => boolean;
};
type Filter = "open" | "resolved" | "mine";
type Panel = {
  el: HTMLElement;
  list: HTMLElement;
  count: HTMLElement;
  filters: HTMLButtonElement[];
  toggle: HTMLButtonElement;
  filter: Filter;
  q: string;
};

const PIN = 32; // marker size, px
const SHEET = 640; // below this width cards become bottom sheets and the panel goes full screen
const PANEL_W = 360;
const errText = (err: unknown) => errOr(err, t("genericError"));
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export class AnnotaWidget {
  private readonly api: WidgetApi;
  private readonly host = document.createElement("annota-root");
  private readonly root: HTMLDivElement;
  private cfg: WidgetConfig = DEFAULT_CONFIG;
  private publicRead = true;
  private ready = false;
  private destroyed = false;
  private pending: { mode?: Mode | undefined } | null = null;
  private launcher: HTMLButtonElement | null = null;
  private badge = h("span", { class: "count", hidden: true });
  private menu: HTMLElement | null = null;
  private menuAway: ((e: Event) => void) | null = null;
  private card: Card | null = null;
  private preview: { el: HTMLElement; p: Placed } | null = null;
  private previewTimer = 0;
  private panel: Panel | null = null;
  private placed: Placed[] = [];
  private orphans: Pin[] = [];
  private showPins = true;
  private showResolved = false;
  private haveClosed = false;
  private loadSeq = 0;
  private picker: Picker | null = null;
  private draft: { el: Element; pin: PinPct; node: HTMLElement } | null = null;
  private modalClose: (() => void) | null = null;
  private busy = false;
  private isOpen = false;
  private raf = 0;
  private cleanup: (() => void)[] = [];
  private identity: Reporter;
  private rightDown = { t: 0, x: 0, y: 0 };
  private capture: CaptureCfg = { console: "warnings", network: "failures", maskSelectors: [] };
  private outbox: Outbox<WidgetFeedbackCreate, Created> | null = null;
  private queued = 0;
  private draftWaiting = false;

  constructor(private readonly opts: WidgetOptions) {
    this.api = new WidgetApi(opts.endpoint, opts.projectKey);
    this.identity = opts.identity ?? {};
    const shadow = this.host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = STYLES;
    this.root = h("div", { class: "root" });
    shadow.append(style, this.root);
    // A hostile page stylesheet (`* { all: unset }`, `display: none` on unknown tags) must not reach us.
    this.host.style.cssText = "all:initial!important;display:block!important;position:static!important";
    // On <html>, not <body>: survives frameworks that replace the body.
    document.documentElement.append(this.host);
  }

  // --- Lifecycle ----------------------------------------------------------------------------------

  async start() {
    let loaded: Awaited<ReturnType<WidgetApi["config"]>>;
    const lang = pickLocale(this.opts.locale, navigator.languages ?? [navigator.language]);
    try {
      [loaded] = await Promise.all([this.api.config(this.opts.accent), loadLocale(lang, this.opts.endpoint)]);
    } catch (err) {
      console.warn("[annota] widget disabled:", errText(err));
      this.destroy();
      return;
    }
    if (this.destroyed) return;
    this.capture = loaded.capture;
    installDiagnostics(loaded.capture);
    this.cfg = loaded.widget;
    this.root.lang = lang;
    this.publicRead = loaded.project.publicRead;
    this.root.style.setProperty("--annota-accent", this.cfg.launcher.accent);

    const reposition = () => this.schedule();
    this.listen(window, "scroll", reposition, { passive: true, capture: true });
    this.listen(window, "resize", reposition, { passive: true });
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
    const deepLink = new URLSearchParams(location.search).get("annota");
    if (deepLink) setTimeout(() => void this.focusPin(deepLink), 300);
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
    clearTimeout(this.previewTimer);
    for (const fn of this.cleanup) fn();
    this.cleanup = [];
    cancelAnimationFrame(this.raf);
    this.host.remove();
  }

  identify(r: Reporter) {
    this.identity = { name: r.name?.trim() || undefined, email: r.email?.trim() || undefined };
  }

  open(mode?: Mode) {
    if (this.destroyed) return;
    if (!this.ready) {
      this.pending = { mode };
      return;
    }
    this.closeMenu();
    if (mode === "comment") {
      if (this.canComment) this.startPicking();
    } else if (mode === "bug") {
      if (this.canBug) void this.startBugReport();
    } else if (mode === "panel") this.openPanel();
    else this.openMenu();
  }

  close() {
    this.pending = null;
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
      console.warn("[annota] event handler failed", err);
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
      this.isOpen = false;
      this.emit("close");
    });
  }

  /** Add a guarded listener that `destroy()` removes. Errors are swallowed, never thrown at the host. */
  private listen<E extends Event>(
    target: EventTarget,
    type: string,
    fn: (e: E) => void,
    opts?: AddEventListenerOptions | boolean,
  ) {
    const safe = (e: Event) => {
      try {
        fn(e as E);
      } catch (err) {
        console.warn("[annota]", err);
      }
    };
    target.addEventListener(type, safe, opts);
    this.cleanup.push(() => target.removeEventListener(type, safe, opts));
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || !this.ready) return;
    const path = e.composedPath();
    if (e.key === "Escape") {
      if (this.card) this.closeCard();
      else if (this.menu) this.closeMenu();
      else if (this.panel) this.closePanel();
      return;
    }
    if (path.includes(this.host) || !this.cfg.shortcuts || e.ctrlKey || e.metaKey || e.altKey) return;
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
    if (!this.ready || !this.cfg.rightClickComment || !this.canComment || e.defaultPrevented) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || this.modalClose) return;
    // The context-menu key and Shift+F10 fire `contextmenu` without a right-button press — leave those alone.
    const r = this.rightDown;
    if (Date.now() - r.t > 1500 || Math.abs(e.clientX - r.x) > 4 || Math.abs(e.clientY - r.y) > 4) return;
    const path = e.composedPath();
    if (path.includes(this.host) || isEditable(path[0] ?? e.target)) return;
    if (getSelection()?.toString().trim()) return; // they probably want "Copy"
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
    const l = this.cfg.launcher;
    if (l.hidden) return;
    const [v, hz] = this.side();
    // The server's English defaults follow the visitor's language; a custom text is shown as written.
    const label = l.label === "Feedback" ? t("feedback") : l.label;
    const tooltip = l.tooltip === "Give feedback" ? t("giveFeedback") : l.tooltip;
    const name = tooltip ?? (l.shape === "pill" && label ? label : t("feedback"));
    const b = h(
      "button",
      {
        class: `launcher ${l.shape} ${v} ${hz}`,
        "aria-label": name,
        "aria-haspopup": "menu",
        "aria-expanded": "false",
        "data-tip": l.shape === "round" ? (tooltip ?? undefined) : undefined,
        onclick: () => (this.menu ? this.closeMenu() : this.open()),
      },
      h("span", { class: "li" }, icon(ICONS[l.icon === "pin" ? "logo" : l.icon])),
      l.shape === "pill" && label ? h("span", { class: "ll" }, label) : null,
      this.badge,
    );
    b.style.setProperty(v, `${l.offset.y}px`);
    b.style.setProperty(hz, `${l.offset.x}px`);
    this.launcher = b;
    this.root.append(b);
  }

  private openMenu() {
    if (this.menu) return;
    this.closeCard();
    const l = this.cfg.launcher;
    const [v, hz] = this.side();
    const item = (svg: string, title: string, sub: string, key: string, onclick: () => void) =>
      h(
        "button",
        { role: "menuitem", onclick },
        h("span", { class: "ico" }, icon(svg)),
        h("span", { class: "grow" }, title, h("small", {}, sub)),
        key && this.cfg.shortcuts ? h("kbd", {}, key) : null,
      );
    const open = this.openCount();
    const menu = h(
      "div",
      { class: `menu ${v}`, role: "menu", "aria-label": t("feedback") },
      this.canComment &&
        item(ICONS.comment, t("addComment"), t("addCommentSub"), "C", () => this.open("comment")),
      this.canBug &&
        item(ICONS.bug, t("reportBug"), this.draftWaiting ? t("draftSub") : t("reportBugSub"), "B", () =>
          this.open("bug"),
        ),
      this.publicRead &&
        item(ICONS.list, t("viewComments"), open ? t("openOnPage", { n: open }) : t("noneOpen"), "", () =>
          this.open("panel"),
        ),
      this.publicRead &&
        item(ICONS.eye, this.showPins ? t("hideComments") : t("showComments"), t("pinsOnPage"), "", () => {
          this.showPins = !this.showPins;
          this.closeMenu();
          this.schedule();
        }),
      this.queued > 0 &&
        item(ICONS.clock, tn("queued", this.queued), t("queuedSub"), "", () => {
          this.closeMenu();
          void this.outbox?.flush(true);
        }),
      h("div", { class: "foot" }, t("poweredBy")),
    );
    menu.style.setProperty(v, `${(l.hidden ? 0 : 60) + l.offset.y}px`);
    menu.style.setProperty(hz, `${l.offset.x}px`);
    menu.addEventListener("keydown", (e) => {
      const items = Array.from(menu.querySelectorAll<HTMLElement>("[role=menuitem]"));
      const i = items.indexOf(e.composedPath()[0] as HTMLElement);
      const d = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      items[(i + d + items.length) % items.length]?.focus();
    });
    this.menu = menu;
    this.root.append(menu);
    this.launcher?.setAttribute("aria-expanded", "true");
    (menu.querySelector("[role=menuitem]") as HTMLElement | null)?.focus();
    this.menuAway = (e: Event) => {
      if (!e.composedPath().includes(this.host)) this.closeMenu();
    };
    document.addEventListener("pointerdown", this.menuAway, true);
    this.active("menu");
  }

  private closeMenu() {
    if (!this.menu) return;
    this.menu.remove();
    this.menu = null;
    if (this.menuAway) document.removeEventListener("pointerdown", this.menuAway, true);
    this.launcher?.setAttribute("aria-expanded", "false");
    this.idle();
  }

  private toast(text: string) {
    const t = h("div", { class: "toast", role: "status", "aria-live": "polite" }, text);
    this.root.append(t);
    setTimeout(() => t.remove(), 3200);
  }

  // --- Pins ---------------------------------------------------------------------------------------

  private async loadPins() {
    const seq = ++this.loadSeq;
    const withClosed = this.showResolved || this.panel?.filter === "resolved";
    let items: Pin[] = [];
    if (this.publicRead) {
      try {
        items = (await this.api.pins(location.href, withClosed)).items;
      } catch {
        // Pins are a nicety; failing to load them must never break the page.
        return;
      }
    }
    if (seq !== this.loadSeq || this.destroyed) return;
    this.haveClosed = withClosed;
    // Optimistic pins still waiting for the server stay put.
    const keep = this.placed.filter((p) => p.pin.id.startsWith("tmp:"));
    for (const p of this.placed) if (!keep.includes(p)) this.unplace(p);
    this.placed = keep;
    this.orphans = [];
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
    const marker = h(
      "button",
      { class: `pin${moved ? " moved" : ""}`, style: `--c:${colorFor(pin.reporterName)}` },
      avatar(pin.reporterName),
      h("span", { class: "n" }),
    );
    const area = isRegion(pin.anchor.pin) ? h("div", { class: `area${moved ? " moved" : ""}` }) : null;
    const p: Placed = { pin, el: found.element, marker, area, moved };
    marker.addEventListener("click", (e) => {
      e.stopPropagation();
      this.openThread(pin, p);
    });
    marker.addEventListener("pointerenter", () => this.hover(p, true));
    marker.addEventListener("pointerleave", () => this.hover(p, false));
    marker.addEventListener("focus", () => this.hover(p, true));
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
    this.placed = this.placed.filter((x) => x !== p);
  }

  private label(p: Placed) {
    const { pin } = p;
    (p.marker.lastElementChild as HTMLElement).textContent = pin.number ? String(pin.number) : "…";
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
    return pinBox(r, (p.pin.anchor as AnchorBundle).pin);
  }

  /** What a card attached to this pin must stay clear of. */
  private targetOf(p: Placed): Box | null {
    const b = this.boxOf(p);
    return b && withMarker(b, !!p.area);
  }

  private schedule() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => {
      try {
        this.frame();
      } catch (err) {
        console.warn("[annota]", err);
      }
    });
  }

  private frame() {
    for (const p of this.placed) {
      const b = this.visible(p) ? this.boxOf(p) : null;
      p.marker.hidden = !b;
      if (p.area) p.area.hidden = !b;
      p.marker.classList.toggle("resolved", isClosed(p.pin.status));
      if (!b) continue;
      if (p.area) box(p.area, b);
      // The marker's tail points at the pin; for regions it sits on the top-right corner.
      p.marker.style.left = `${b.left + b.width}px`;
      p.marker.style.top = `${b.top - PIN}px`;
    }
    if (this.draft) {
      const r = this.draft.el.getBoundingClientRect();
      const b = pinBox(r, this.draft.pin);
      if (isRegion(this.draft.pin)) box(this.draft.node, b);
      else {
        this.draft.node.style.left = `${b.left}px`;
        this.draft.node.style.top = `${b.top - PIN}px`;
      }
    }
    if (this.card) this.position(this.card.el, this.card.target());
    if (this.preview) {
      const t = this.targetOf(this.preview.p);
      if (t) this.position(this.preview.el, t);
      else this.hidePreview();
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
    const n = this.openCount();
    this.badge.hidden = !n;
    this.badge.textContent = n > 99 ? "99+" : String(n);
    if (this.panel) this.panel.count.textContent = String(n);
  }

  private hover(p: Placed, on: boolean) {
    p.area?.classList.toggle("hot", on || this.card?.id === p.pin.id);
    clearTimeout(this.previewTimer);
    if (!on) return this.hidePreview();
    if (this.card?.id === p.pin.id) return;
    this.previewTimer = window.setTimeout(() => this.showPreview(p), 120);
  }

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
      ),
      pin.title && h("b", { class: "title" }, pin.title),
      h("p", { class: "text clamp" }, pin.body),
      h(
        "div",
        { class: "by" },
        avatar(pin.reporterName),
        h("span", {}, shortName(pin.reporterName)),
        h("span", { class: "muted" }, `· ${ago(pin.createdAt)}`),
        pin.replyCount > 0 && h("span", { class: "muted" }, `· ${tn("reply", pin.replyCount)}`),
      ),
    );
    this.preview = { el, p };
    this.root.append(el);
    this.position(el, this.targetOf(p));
  }

  private hidePreview() {
    this.preview?.el.remove();
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
        this.openThread(target.pin, target);
      }, 450);
    } else if (o) {
      this.openPanel();
      this.openThread(o, null);
    }
  }

  // --- Cards --------------------------------------------------------------------------------------

  private showCard(card: Card) {
    this.closeCard();
    this.hidePreview();
    this.card = card;
    this.root.append(card.el);
    this.position(card.el, card.target());
    this.active(card.kind);
  }

  private closeCard() {
    if (!this.card) return;
    const c = this.card;
    this.card = null;
    c.el.remove();
    c.off?.();
    this.draft?.node.remove();
    this.draft = null;
    this.idle();
  }

  // --- Comment mode -------------------------------------------------------------------------------

  private startPicking() {
    if (this.picker) return;
    this.closeCard();
    this.hidePreview();
    if (innerWidth < SHEET) this.closePanel();
    this.picker = new Picker(this.host, this.root, (pick) => {
      if (pick) this.openComposer(pick);
      else this.stopPicking();
    });
    this.root.classList.add("picking");
    this.active("comment");
  }

  private stopPicking() {
    if (!this.picker) return;
    this.picker.stop();
    this.picker = null;
    this.root.classList.remove("picking");
    this.idle();
  }

  private openComposer(pick: Pick, restore?: { text: string; kind: Kind; error: string; clientId: string }) {
    this.stopPicking();
    const anchor = captureAnchor(pick.el, pick.x, pick.y);
    if (pick.region) anchor.pin = regionPin(pick.el.getBoundingClientRect(), pick.region);
    const region = isRegion(anchor.pin);
    const clientId = restore?.clientId ?? uuid();
    let kind: Kind = restore?.kind ?? "comment";

    const chips = KIND_LIST.map((k) =>
      h(
        "button",
        {
          role: "radio",
          "aria-checked": String(k === kind),
          style: `--k:${kindOf(k).color}`,
          onclick: () => {
            kind = k;
            for (const [i, c] of chips.entries()) c.setAttribute("aria-checked", String(KIND_LIST[i] === k));
            text.focus();
          },
        },
        kindOf(k).label,
      ),
    );
    const text = h("textarea", {
      placeholder: region ? t("regionPlaceholder") : t("commentPlaceholder"),
      "aria-label": t("yourComment"),
      maxlength: 10000,
    });
    text.value = restore?.text ?? "";

    const ident = identityFields(this.identity);
    const consent = consentBlock(this.cfg.consent, this.opts.projectKey);

    const error = h("p", { class: "err", role: "alert" }, restore?.error ?? "");
    const send = h("button", { class: "btn primary" }, consent.need ? t("agreeSend") : t("send"));
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    let warned = false;

    const submit = () => {
      const body = text.value.trim();
      if (!body) {
        error.textContent = t("writeFirst");
        return text.focus();
      }
      const bad = ident.invalid();
      if (bad) {
        error.textContent = t("badEmail");
        return bad.focus();
      }
      consent.accept();
      void this.submitComment(pick, anchor, kind, body, ident.read() ?? {}, clientId);
    };
    send.addEventListener("click", submit);
    text.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submit();
      } else if (e.key === "Escape" && text.value.trim() && !warned) {
        e.preventDefault();
        warned = true;
        error.textContent = t("escAgain");
      }
    });
    text.addEventListener("input", () => {
      warned = false;
      error.textContent = "";
    });

    const el = h(
      "div",
      { class: "card composer", role: "dialog", "aria-label": t("newComment") },
      h("div", { class: "kinds", role: "radiogroup", "aria-label": t("type") }, ...chips),
      text,
      ...ident.els,
      consent.el,
      error,
      h(
        "div",
        { class: "foot" },
        h("span", { class: "muted grow" }, mac ? t("sendHintMac") : t("sendHint")),
        h("button", { class: "btn ghost", onclick: () => this.closeCard() }, t("cancel")),
        send,
      ),
    );

    const node = region
      ? h("div", { class: "area draft" })
      : h("div", { class: "pin draft", "aria-hidden": "true" }, h("span", { class: "av" }, icon(ICONS.plus)));
    this.showCard({
      el,
      kind: "composer",
      dirty: () => !!text.value.trim(),
      target: () => {
        const r = pick.el.getBoundingClientRect();
        return withMarker(pinBox(r, anchor.pin), region);
      },
    });
    this.draft = { el: pick.el, pin: anchor.pin, node };
    this.root.append(node);
    this.frame();
    text.focus();
  }

  private async submitComment(
    pick: Pick,
    anchor: AnchorBundle,
    kind: Kind,
    body: string,
    reporter: Reporter,
    clientId: string,
  ) {
    // Optimistic: the pin appears now and gets its number when the server answers.
    const pin: Pin = {
      id: `tmp:${clientId}`,
      number: 0,
      kind,
      status: "open",
      body: body.slice(0, 500),
      anchor,
      createdAt: new Date().toISOString(),
      reporterName: reporter.name ?? null,
      replyCount: 0,
    };
    this.closeCard();
    const placed = this.place(pin);
    placed?.marker.classList.add("pending");
    this.busy = true;
    this.schedule();
    try {
      const { feedback } = await this.api.submit({
        clientId,
        kind,
        body,
        page: { url: location.href, title: document.title.slice(0, 300) },
        anchor,
        environment: environment(),
        reporter: (reporter.name || reporter.email
          ? reporter
          : undefined) as WidgetFeedbackCreate["reporter"],
        diagnostics: kind === "bug" ? snapshotDiagnostics() : undefined,
      });
      pin.id = feedback.id;
      pin.number = feedback.number;
      store.addMine(this.opts.projectKey, { id: feedback.id, token: feedback.reporterToken });
      if (placed) {
        placed.marker.classList.remove("pending");
        this.label(placed);
      }
      this.toast(t("sent", { n: feedback.number }));
      this.emit("submit", { id: feedback.id, number: feedback.number, kind });
    } catch (err) {
      if (placed) this.unplace(placed);
      else this.orphans = this.orphans.filter((o) => o !== pin);
      this.emit("error", { message: errText(err) });
      if (!this.destroyed && pick.el.isConnected)
        this.openComposer(pick, { text: body, kind, error: errText(err), clientId });
      else this.toast(errText(err));
    } finally {
      this.busy = false;
      this.updateCount();
      this.renderList();
      this.idle();
    }
  }

  private message(name: string | null, at: string, body: string, team: boolean, title?: string | null) {
    return h(
      "div",
      { class: `msg${team ? " team" : ""}` },
      avatar(name),
      h(
        "div",
        { class: "mb" },
        h(
          "div",
          { class: "meta" },
          h("b", {}, name ?? t("visitor")),
          team && h("span", { class: "chip team" }, t("team")),
          h("span", { class: "muted" }, ago(at)),
        ),
        title && h("b", { class: "title" }, title),
        h("p", { class: "text" }, body),
      ),
    );
  }

  private openThread(pin: Pin, p: Placed | null) {
    if (pin.id.startsWith("tmp:")) return;
    if (innerWidth < SHEET) this.closePanel();
    const token = store.mine(this.opts.projectKey).find((m) => m.id === pin.id)?.token;
    const canResolve = !this.cfg.readOnly && (this.cfg.visitorsCanResolve || !!token);
    const closed = isClosed(pin.status);
    const resolve =
      canResolve &&
      h(
        "button",
        { class: "btn sm" },
        icon(closed ? ICONS.reopen : ICONS.check),
        closed ? t("reopen") : t("resolve"),
      );
    const copy = h(
      "button",
      { class: "ib", "aria-label": t("copyLink"), title: t("copyLink") },
      icon(ICONS.link),
    );
    const list = h(
      "div",
      { class: "scroll" },
      this.message(pin.reporterName, pin.createdAt, pin.body, false, pin.title),
    );
    const loading = pin.replyCount > 0 ? h("p", { class: "muted pad" }, t("loadingReplies")) : null;
    if (loading) list.append(loading);

    let reply: HTMLElement | null = null;
    if (!this.cfg.readOnly) {
      const box = h("textarea", {
        placeholder: t("replyPlaceholder"),
        "aria-label": t("reply"),
        rows: 1,
        maxlength: 5000,
      });
      const send = h("button", { class: "send", "aria-label": t("sendReply") }, icon(ICONS.send));
      const go = async () => {
        const body = box.value.trim();
        if (!body || send.disabled) return;
        send.disabled = true;
        const me = { ...store.reporter(), ...stripEmpty(this.identity) };
        try {
          const author = me.name || me.email ? stripEmpty(me) : undefined;
          const { comment } = await this.api.reply(pin.id, body, author);
          list.append(
            this.message(
              comment?.authorName ?? me.name ?? t("you"),
              comment?.createdAt ?? new Date().toISOString(),
              body,
              false,
            ),
          );
          list.scrollTop = list.scrollHeight;
          pin.replyCount++;
          box.value = "";
          this.renderList();
        } catch (err) {
          this.toast(errText(err));
          this.emit("error", { message: errText(err) });
        }
        send.disabled = false;
      };
      send.addEventListener("click", go);
      box.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void go();
        }
      });
      reply = h("div", { class: "reply" }, box, send);
    }

    const el = h(
      "div",
      {
        class: "card thread",
        role: "dialog",
        "aria-label": `${kindOf(pin.kind).label} #${pin.number}`,
        tabindex: -1,
      },
      h(
        "div",
        { class: "head" },
        tag(pin.kind),
        h("span", { class: "muted" }, `#${pin.number}`),
        closed && h("span", { class: "chip ok" }, t("resolved")),
        p?.moved && h("span", { class: "chip warn", title: t("movedTip") }, t("moved")),
        !p && h("span", { class: "chip warn" }, t("notOnPage")),
        h("span", { class: "grow" }),
        resolve,
        copy,
        h(
          "button",
          { class: "ib", "aria-label": t("close"), onclick: () => this.closeCard() },
          icon(ICONS.close),
        ),
      ),
      list,
      reply,
    );

    copy.addEventListener("click", () => {
      const u = new URL(location.href);
      u.searchParams.set("annota", pin.id);
      const link = u.toString();
      navigator.clipboard?.writeText(link).then(
        () => this.toast(t("linkCopied")),
        () => this.toast(link),
      ) ?? this.toast(link);
    });
    if (resolve)
      resolve.addEventListener("click", async () => {
        resolve.disabled = true;
        const next = isClosed(pin.status) ? "open" : "resolved";
        try {
          await this.api.setStatus(pin.id, next, token);
          pin.status = next;
          this.toast(t(next === "resolved" ? "resolvedN" : "reopenedN", { n: pin.number }));
          this.closeCard();
          this.schedule();
          this.updateCount();
          this.renderList();
        } catch (err) {
          resolve.disabled = false;
          this.toast(errText(err));
          this.emit("error", { message: errText(err) });
        }
      });

    p?.marker.classList.add("active");
    p?.area?.classList.add("hot");
    // Bring a pin that sits at the viewport edge into view; the card follows it as the page scrolls.
    const at = p && this.boxOf(p);
    if (at && (at.top < 48 || at.top + at.height > innerHeight - 48))
      scrollBy({ top: at.top + at.height / 2 - innerHeight / 2, behavior: reduced() ? "auto" : "smooth" });
    this.showCard({
      el,
      kind: "thread",
      id: pin.id,
      target: () => (p ? this.targetOf(p) : null),
      off: () => {
        p?.marker.classList.remove("active");
        p?.area?.classList.remove("hot");
      },
    });
    el.focus({ preventScroll: true });

    this.api.replies(pin.id).then(
      ({ items }) => {
        loading?.remove();
        if (this.card?.el !== el || !items.length) return;
        pin.replyCount = Math.max(pin.replyCount, items.length);
        const replies = items.map((m) => this.message(m.authorName, m.createdAt, m.body, m.team));
        list.firstElementChild?.after(h("div", { class: "replies" }, ...replies));
        this.schedule();
      },
      () => {
        if (loading) loading.textContent = t("repliesFailed");
      },
    );
  }

  // --- Side panel (F-011) -------------------------------------------------------------------------

  private openPanel() {
    if (this.panel) return;
    this.closeMenu();
    const list = h("div", { class: "plist" });
    const count = h("span", { class: "chip" });
    const names = { open: t("filterOpen"), resolved: t("filterResolved"), mine: t("filterMine") };
    const filters = (["open", "resolved", "mine"] as const).map((f) =>
      h("button", { "aria-pressed": String(f === "open"), onclick: () => this.setFilter(f) }, names[f]),
    );
    const search = h("input", {
      type: "search",
      placeholder: t("search"),
      "aria-label": t("searchComments"),
    });
    search.addEventListener("input", () => {
      if (!this.panel) return;
      this.panel.q = search.value;
      this.renderList();
    });
    const toggle = h(
      "button",
      {
        class: "switch",
        role: "switch",
        "aria-checked": String(this.showResolved),
        onclick: () => this.toggleResolved(),
      },
      h("span", { class: "knob" }),
      t("showResolved"),
    );
    const el = h(
      "aside",
      { class: "panel", role: "complementary", "aria-label": t("commentsOnPage") },
      h(
        "div",
        { class: "phead" },
        h("b", {}, t("comments")),
        count,
        h("span", { class: "grow" }),
        this.canComment &&
          h(
            "button",
            { class: "ib", "aria-label": t("addComment"), onclick: () => this.open("comment") },
            icon(ICONS.plus),
          ),
        h(
          "button",
          { class: "ib", "aria-label": t("closeComments"), onclick: () => this.closePanel() },
          icon(ICONS.close),
        ),
      ),
      h(
        "div",
        { class: "ptools" },
        h("div", { class: "seg", role: "group", "aria-label": t("filter") }, ...filters),
        h("label", { class: "search" }, icon(ICONS.search), search),
        toggle,
      ),
      list,
    );
    this.panel = { el, list, count, filters, toggle, filter: "open", q: "" };
    this.root.append(el);
    this.updateCount();
    this.renderList();
    this.schedule();
    this.active("panel");
  }

  private closePanel() {
    if (!this.panel) return;
    this.panel.el.remove();
    this.panel = null;
    this.schedule();
    this.idle();
  }

  private setFilter(f: Filter) {
    const panel = this.panel;
    if (!panel) return;
    panel.filter = f;
    for (const [i, b] of panel.filters.entries())
      b.setAttribute("aria-pressed", String(["open", "resolved", "mine"][i] === f));
    if (f === "resolved" && !this.haveClosed) void this.loadPins();
    this.renderList();
  }

  private toggleResolved() {
    this.showResolved = !this.showResolved;
    this.panel?.toggle.setAttribute("aria-checked", String(this.showResolved));
    if (this.showResolved && !this.haveClosed) void this.loadPins();
    this.schedule();
  }

  private renderList() {
    const panel = this.panel;
    if (!panel) return;
    const mine = new Set(store.mine(this.opts.projectKey).map((m) => m.id));
    const q = panel.q.trim().toLowerCase();
    const rows = [
      ...this.placed.map((p) => ({ pin: p.pin, p: p as Placed | null })),
      ...this.orphans.map((pin) => ({ pin, p: null as Placed | null })),
    ]
      .filter(({ pin }) =>
        panel.filter === "open"
          ? !isClosed(pin.status)
          : panel.filter === "resolved"
            ? isClosed(pin.status)
            : mine.has(pin.id) || pin.id.startsWith("tmp:"),
      )
      .filter(
        ({ pin }) =>
          !q ||
          `${pin.title ?? ""} ${pin.body} ${pin.reporterName ?? ""} #${pin.number}`.toLowerCase().includes(q),
      )
      .sort((a, b) => Date.parse(b.pin.createdAt) - Date.parse(a.pin.createdAt));

    const item = ({ pin, p }: { pin: Pin; p: Placed | null }) =>
      h(
        "button",
        {
          class: "item",
          "aria-label": `${kindOf(pin.kind).label} #${pin.number}: ${pin.body.slice(0, 80)}`,
          onclick: () => {
            if (p) {
              p.el.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" });
              setTimeout(() => this.openThread(pin, p), reduced() ? 0 : 350);
            } else this.openThread(pin, null);
          },
        },
        avatar(pin.reporterName),
        h(
          "span",
          { class: "ib-body" },
          h(
            "span",
            { class: "meta" },
            h("b", {}, shortName(pin.reporterName)),
            h("span", { class: "muted" }, `${pin.number ? `#${pin.number} · ` : ""}${ago(pin.createdAt)}`),
            h("span", { class: "grow" }),
            tag(pin.kind),
          ),
          h("span", { class: "text clamp2" }, pin.body),
          h(
            "span",
            { class: "meta" },
            pin.replyCount > 0 && h("span", { class: "muted" }, tn("reply", pin.replyCount)),
            isClosed(pin.status) && h("span", { class: "chip ok" }, t("resolved")),
            p?.moved && h("span", { class: "chip warn" }, t("moved")),
            !p && h("span", { class: "chip warn" }, t("notOnVersion")),
          ),
        ),
      );

    const empty = h(
      "div",
      { class: "empty" },
      h("b", {}, panel.q ? t("noMatches") : panel.filter === "mine" ? t("nothingFromYou") : t("noComments")),
      h(
        "span",
        { class: "muted" },
        panel.q
          ? t("tryDifferent")
          : this.canComment
            ? this.cfg.shortcuts
              ? t("pressC")
              : t("usePlus")
            : t("willShowHere"),
      ),
    );
    panel.list.replaceChildren(...(rows.length ? rows.map(item) : [empty]));
  }

  // --- Bug report mode (F-003) and offline outbox (F-010) ------------------------------------------

  private startOutbox() {
    const project = this.opts.projectKey;
    this.outbox = new Outbox<WidgetFeedbackCreate, Created>({
      kv: idbKV("outbox"),
      project,
      send: (p) => this.api.submitOnce(p),
      onSent: (_item, { feedback }) => {
        store.addMine(project, { id: feedback.id, token: feedback.reporterToken });
        this.toast(t("queuedSentToast", { n: feedback.number }));
        this.emit("submit", { id: feedback.id, number: feedback.number, kind: "bug" });
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
    if (this.busy || this.modalClose) return;
    this.closeCard();
    this.closePanel();
    this.active("bug");
    const report = new BugReport({
      host: this.host,
      root: this.root,
      endpoint: this.opts.endpoint,
      project: this.opts.projectKey,
      cfg: this.cfg,
      capture: this.capture,
      identity: this.identity,
      submit: (p) => this.api.submitOnce(p),
      queue: async (id, p) => {
        await this.outbox?.add(id, p);
      },
      toast: (text) => this.toast(text),
      sent: (id, number, token) => {
        store.addMine(this.opts.projectKey, { id, token });
        this.emit("submit", { id, number, kind: "bug" });
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
      console.warn("[annota]", err);
      report.close(false);
    }
  }
}

/** The box a card must not cover: the region (or point) plus the marker drawn above it. */
function withMarker(b: Box, region: boolean): Box {
  return region
    ? { left: b.left, top: b.top - PIN, width: b.width + PIN, height: b.height + PIN }
    : { left: b.left, top: b.top - PIN, width: 0, height: PIN };
}

function box(el: HTMLElement, b: Box) {
  el.style.left = `${b.left}px`;
  el.style.top = `${b.top}px`;
  el.style.width = `${b.width}px`;
  el.style.height = `${b.height}px`;
}

function stripEmpty(r: Reporter): { name?: string; email?: string } {
  const out: { name?: string; email?: string } = {};
  if (r.name) out.name = r.name;
  if (r.email) out.email = r.email;
  return out;
}
