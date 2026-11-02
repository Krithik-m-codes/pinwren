import { h } from "./dom";
import { t } from "./i18n";
import { type Box, boxFrom, regionAnchor } from "./region";

// Comment mode (blueprint 05 §4 "picking"): a transparent shield over the page catches the pointer so a
// press-drag never selects page text or triggers page handlers. Click = point pin, drag = region,
// Shift = parent element, arrows walk the DOM, Enter picks, Esc exits. Touch: long-press, then drag.

export type Pick = { el: Element; x: number; y: number; region?: Box };

/** Topmost page element at a point, looking through the widget's own overlay. */
export function elementAt(host: Element, x: number, y: number): Element | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el === host || el === document.documentElement || el === document.body) continue;
    return el;
  }
  return null;
}

export type PickMode = "element" | "region";
/** The last mode used, kept for the page's lifetime so a second comment starts where the first left off. */
let lastMode: PickMode = "element";

/** The ancestors of `el` from the page's top level down to `el` itself, at most `max` of them (breadcrumb). */
export function crumbPath(el: Element, max = 5): Element[] {
  const path: Element[] = [];
  for (
    let n: Element | null = el;
    n && n !== document.body && n !== document.documentElement;
    n = n.parentElement
  )
    path.unshift(n);
  return path.slice(-max);
}

const DRAG = 5; // px before a press becomes a region drag
const LONG_PRESS = 450;

export class Picker {
  private shield = h("div", { class: "shield", "aria-hidden": "true" });
  private outline = h("div", { class: "outline" }, h("span", {}));
  private draft = h("div", { class: "area draft" });
  private hint: HTMLElement;
  private crumbs = h("div", { class: "crumbs" });
  private modeBtns: Record<PickMode, HTMLButtonElement> | null = null;
  mode: PickMode = lastMode;
  private cur: Element | null = null;
  private last: { x: number; y: number; shift: boolean } | null = null;
  private down: {
    x: number;
    y: number;
    id: number;
    touch: boolean;
    armed: boolean;
    px: number;
    py: number;
  } | null = null;
  private dragging = false;
  private timer = 0;

  constructor(
    private readonly host: HTMLElement,
    root: HTMLElement,
    private readonly done: (p: Pick | null) => void,
    /** Element-capture mode (bug reports): a click picks an element; no region drag. */
    private readonly elementOnly = false,
  ) {
    const touch = matchMedia("(pointer: coarse)").matches;
    this.hint = h(
      "div",
      { class: "hint", role: "status" },
      !elementOnly && this.modeToggle(),
      elementOnly ? t("hintElement") : touch ? t("hintTouch") : t("hintMouse"),
      !touch && h("kbd", {}, "Shift"),
      !touch && t("parent"),
      h("kbd", {}, "Esc"),
      t("exit"),
    );
    this.draft.hidden = true;
    this.outline.hidden = true;
    const s = this.shield;
    s.addEventListener("pointerdown", this.onDown);
    s.addEventListener("pointermove", this.onMove);
    s.addEventListener("pointerup", this.onUp);
    s.addEventListener("pointercancel", this.reset);
    s.addEventListener("contextmenu", (e) => e.preventDefault());
    this.crumbs.hidden = true;
    root.append(this.shield, this.outline, this.draft, this.hint, this.crumbs);
    document.addEventListener("keydown", this.onKey, true);
    document.addEventListener("keyup", this.onKey, true);
  }

  stop() {
    clearTimeout(this.timer);
    document.removeEventListener("keydown", this.onKey, true);
    document.removeEventListener("keyup", this.onKey, true);
    for (const el of [this.shield, this.outline, this.draft, this.hint, this.crumbs]) el.remove();
  }

  /** Re-measure after scroll/resize so the outline stays on its element. */
  refresh() {
    if (this.cur?.isConnected) this.show(this.cur);
    else if (this.cur) this.show(null);
  }

  private at(x: number, y: number): Element | null {
    return elementAt(this.host, x, y);
  }

  private withShift(el: Element | null, shift: boolean) {
    const p = el?.parentElement;
    return shift && p && p !== document.body && p !== document.documentElement ? p : el;
  }

  private show(el: Element | null) {
    this.cur = el;
    this.outline.hidden = !el;
    this.paintCrumbs(el);
    if (!el) return;
    const r = el.getBoundingClientRect();
    Object.assign(this.outline.style, {
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    (this.outline.firstElementChild as HTMLElement).textContent =
      `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}`;
  }

  /** The path to the hovered element: a click walks up to a parent, the last one picks. */
  private paintCrumbs(el: Element | null) {
    this.crumbs.hidden = !el || this.mode === "region";
    this.crumbs.replaceChildren();
    if (!el) return;
    const path = crumbPath(el);
    for (const [i, n] of path.entries()) {
      const last = i === path.length - 1;
      const b = h("button", {
        type: "button",
        class: `crumb${last ? " cur" : ""}`,
        ...(last ? { "aria-current": "true" } : {}),
        onclick: () => {
          if (last) this.pickEl(n);
          else this.show(n);
        },
      });
      b.append(n.tagName.toLowerCase());
      this.crumbs.append(b);
    }
  }

  private pickEl(el: Element) {
    const r = el.getBoundingClientRect();
    this.done({ el, x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }

  private hover(x: number, y: number, shift: boolean) {
    this.last = { x, y, shift };
    this.show(this.withShift(this.at(x, y), shift));
  }

  private onDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    const touch = e.pointerType !== "mouse";
    this.down = {
      x: e.clientX,
      y: e.clientY,
      id: e.pointerId,
      touch,
      armed: !touch,
      px: e.clientX,
      py: e.clientY,
    };
    this.dragging = false;
    try {
      this.shield.setPointerCapture(e.pointerId);
    } catch {
      // pointer capture is a nicety; picking works without it
    }
    if (touch) {
      this.timer = window.setTimeout(() => {
        if (!this.down) return;
        this.down.armed = true;
        this.hover(this.down.x, this.down.y, false);
        if ("vibrate" in navigator) navigator.vibrate(10); // absent in Safari
      }, LONG_PRESS);
    }
  };

  private onMove = (e: PointerEvent) => {
    const d = this.down;
    if (!d) {
      this.hover(e.clientX, e.clientY, e.shiftKey);
      return;
    }
    const dist = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    if (!d.armed) {
      // Touch before the long-press fires: the shield blocks native scrolling, so pan by hand.
      if (dist > 8) clearTimeout(this.timer);
      scrollBy(d.px - e.clientX, d.py - e.clientY);
      d.px = e.clientX;
      d.py = e.clientY;
      return;
    }
    if (!this.dragging && dist > DRAG && !this.elementOnly) {
      this.dragging = true;
      this.draft.hidden = false;
      // A drag is a region in either mode, but it must not flip the (remembered) mode: the next plain click
      // would then do nothing.
    }
    if (this.dragging) {
      const b = boxFrom(d.x, d.y, e.clientX, e.clientY);
      Object.assign(this.draft.style, {
        left: `${b.left}px`,
        top: `${b.top}px`,
        width: `${b.width}px`,
        height: `${b.height}px`,
      });
      // Outline the element the region will be anchored to, so the person sees what it sticks to.
      const under = this.at(b.left + b.width / 2, b.top + b.height / 2);
      this.show(under && regionAnchor(under, b));
    } else this.hover(e.clientX, e.clientY, e.shiftKey);
  };

  private onUp = (e: PointerEvent) => {
    const d = this.down;
    clearTimeout(this.timer);
    if (!d?.armed) {
      this.reset();
      return;
    }
    const region = this.dragging ? boxFrom(d.x, d.y, e.clientX, e.clientY) : null;
    this.reset();
    if (region && region.width >= 8 && region.height >= 8) {
      const under = this.at(region.left + region.width / 2, region.top + region.height / 2);
      if (under) this.done({ el: regionAnchor(under, region), x: region.left, y: region.top, region });
      return;
    }
    // Region mode wants a drag; a stray click is not a comment.
    if (this.mode === "region" && !this.elementOnly) return;
    const el = this.withShift(this.at(e.clientX, e.clientY), e.shiftKey);
    if (el) this.done({ el, x: e.clientX, y: e.clientY });
  };

  private modeToggle(): HTMLElement {
    const mk = (m: PickMode, text: string) => {
      const b = h("button", {
        type: "button",
        class: "mode",
        role: "radio",
        "aria-checked": String(this.mode === m),
        onclick: () => this.setMode(m),
      });
      b.append(text);
      return b;
    };
    const el = h("div", { class: "modes", role: "radiogroup", "aria-label": t("pickMode") });
    this.modeBtns = { element: mk("element", t("modeElement")), region: mk("region", t("modeRegion")) };
    el.append(this.modeBtns.element, this.modeBtns.region);
    return el;
  }

  setMode(m: PickMode) {
    if (this.elementOnly || m === this.mode) return;
    this.mode = lastMode = m;
    for (const k of ["element", "region"] as const)
      this.modeBtns?.[k].setAttribute("aria-checked", String(k === m));
    if (m === "region") this.show(null);
  }

  private reset = () => {
    clearTimeout(this.timer);
    this.down = null;
    this.dragging = false;
    this.draft.hidden = true;
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Shift" && this.last && !this.down) {
      this.hover(this.last.x, this.last.y, e.type === "keydown");
      return;
    }
    if (e.type !== "keydown") return;
    if (
      !this.elementOnly &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !(e.target as Element).closest("input,textarea,select,[contenteditable]")
    ) {
      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        this.setMode("element");
        return;
      }
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        this.setMode("region");
        return;
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.done(null);
      return;
    }
    const c = this.cur;
    const next =
      e.key === "ArrowUp"
        ? this.withShift(c, true)
        : e.key === "ArrowDown"
          ? c?.firstElementChild
          : e.key === "ArrowLeft"
            ? c?.previousElementSibling
            : e.key === "ArrowRight"
              ? c?.nextElementSibling
              : undefined;
    if (next !== undefined) {
      e.preventDefault();
      if (next) {
        next.scrollIntoView({ block: "nearest" });
        this.show(next);
      } else if (!c)
        this.show(document.querySelector("main, [role=main]") ?? document.body.firstElementChild);
      return;
    }
    if (
      e.key === "Enter" &&
      c &&
      !(e.composedPath()[0] instanceof HTMLButtonElement) &&
      this.mode === "element"
    ) {
      e.preventDefault();
      this.pickEl(c);
    }
  };
}
