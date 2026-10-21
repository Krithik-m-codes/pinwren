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

const DRAG = 5; // px before a press becomes a region drag
const LONG_PRESS = 450;

export class Picker {
  private shield = h("div", { class: "shield", "aria-hidden": "true" });
  private outline = h("div", { class: "outline" }, h("span", {}));
  private draft = h("div", { class: "area draft" });
  private hint: HTMLElement;
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
    root.append(this.shield, this.outline, this.draft, this.hint);
    document.addEventListener("keydown", this.onKey, true);
    document.addEventListener("keyup", this.onKey, true);
  }

  stop() {
    clearTimeout(this.timer);
    document.removeEventListener("keydown", this.onKey, true);
    document.removeEventListener("keyup", this.onKey, true);
    for (const el of [this.shield, this.outline, this.draft, this.hint]) el.remove();
  }

  /** Re-measure after scroll/resize so the outline stays on its element. */
  refresh() {
    if (this.cur) this.show(this.cur);
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
    const el = this.withShift(this.at(e.clientX, e.clientY), e.shiftKey);
    if (el) this.done({ el, x: e.clientX, y: e.clientY });
  };

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
    if (e.key === "Enter" && c) {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      this.done({ el: c, x: r.left + r.width / 2, y: r.top + r.height / 2 });
    }
  };
}
