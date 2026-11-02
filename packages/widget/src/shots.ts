// "Add screenshot" and the attachment preview — the lazy widget-shots.js chunk, loaded when the bug report
// opens. The capture itself (SnapDOM, screen share) stays in widget-capture.js; this file is the UI around
// it: the menu, drag-to-select, the thumbnail grid, the zoomable lightbox and the annotate dialog.
import { type Attachment, fmtSize } from "./attachments";
import { adoptStyle, h, icon, trapFocus } from "./dom";
import type { Editor } from "./editor";
import { addEnglish, t } from "./i18n";
import * as I from "./icons";
import { enShots } from "./locales/en-shots";
import { type Box, boxFrom } from "./region";
import { type Tool, COLORS } from "./shapes";
import {
  canvasToAttachment,
  clampView,
  cropCanvas,
  fitScale,
  shotName,
  type ShotMode,
  type View,
  zoomAt,
} from "./shot-math";
import { SHOTS_CSS } from "./shots-styles";

addEnglish(enShots); // this module is part of widget-shots.js, which brings its own English

// Everything on screen that this chunk opened, so closing the report can take it all down.
const live = new Set<() => void>();
export const closeAll = () => {
  for (const close of [...live]) close();
};

/**
 * Keys for an open overlay. Listens on `window` in the capture phase so it runs before the report's own
 * document-level shortcuts (Esc closes the report, letters switch editor tools); `fn` returns true for a
 * key it used, which is then kept from everything else.
 */
function grabKeys(fn: (e: KeyboardEvent) => boolean): () => void {
  const on = (e: KeyboardEvent) => {
    if (!fn(e)) return;
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener("keydown", on, true);
  return () => window.removeEventListener("keydown", on, true);
}

/** Keep receiving a drag's events outside the element; a synthetic or already-ended pointer can't be captured. */
function keepPointer(el: HTMLElement, id: number) {
  try {
    el.setPointerCapture(id);
  } catch {
    // the drag still works while the pointer stays over the element
  }
}

// --- The menu -----------------------------------------------------------------------------------

const ITEMS: Record<ShotMode, [string, () => string]> = {
  visible: [I.view, () => t("capVisible")],
  full: [I.page, () => t("capFull")],
  area: [I.rect, () => t("shotArea")],
  element: [I.target, () => t("capElement")],
  tab: [I.screen, () => t("shotTab")],
};

/** The "Add screenshot ▾" button and its menu. `pick` runs straight from the click, so screen share keeps its user activation. */
export function shotMenu(root: HTMLElement, modes: ShotMode[], pick: (mode: ShotMode) => void) {
  adoptStyle(root, "shots", SHOTS_CSS);
  const button = h(
    "button",
    { type: "button", class: "btn sm sh-add", "aria-haspopup": "menu", "aria-expanded": "false" },
    icon(I.screen),
    t("shotAdd"),
    icon(I.chevron),
  );
  let menu: HTMLElement | null = null;
  let off: (() => void)[] = [];
  const close = (refocus = false) => {
    live.delete(close0);
    for (const f of off) f();
    off = [];
    menu?.remove();
    menu = null;
    button.setAttribute("aria-expanded", "false");
    if (refocus) button.focus();
  };
  const close0 = () => close();
  const open = () => {
    const items = modes.map((m) =>
      h(
        "button",
        {
          type: "button",
          role: "menuitem",
          onclick: () => {
            close();
            pick(m);
          },
        },
        icon(ITEMS[m][0]),
        ITEMS[m][1](),
      ),
    );
    const el = h("div", { class: "sh-menu", role: "menu", "aria-label": t("shotAdd") }, ...items);
    menu = el;
    root.append(el);
    const r = button.getBoundingClientRect();
    const mh = el.offsetHeight || items.length * 32 + 8;
    const below = r.bottom + 4 + mh <= innerHeight - 8;
    el.style.left = `${Math.max(8, Math.min(r.left, innerWidth - (el.offsetWidth || 220) - 8))}px`;
    el.style.top = `${below ? r.bottom + 4 : Math.max(8, r.top - 4 - mh)}px`;
    button.setAttribute("aria-expanded", "true");
    live.add(close0);
    items[0]?.focus();
    const outside = (e: Event) => {
      const path = e.composedPath();
      if (!path.includes(el) && !path.includes(button)) close();
    };
    document.addEventListener("pointerdown", outside, true);
    off.push(() => document.removeEventListener("pointerdown", outside, true));
    off.push(
      grabKeys((e) => {
        if (e.key === "Escape") return (close(true), true);
        if (e.key === "Tab") return (close(), false);
        const i = items.indexOf(focusedItem(el) as HTMLButtonElement);
        const to =
          e.key === "ArrowDown"
            ? (i + 1) % items.length
            : e.key === "ArrowUp"
              ? (i - 1 + items.length) % items.length
              : e.key === "Home"
                ? 0
                : e.key === "End"
                  ? items.length - 1
                  : -1;
        if (to < 0) return false;
        items[to]?.focus();
        return true;
      }),
    );
  };
  button.addEventListener("click", () => (menu ? close() : open()));
  return {
    el: button,
    /** Greyed out while a capture runs or the attachment limit is reached. */
    setDisabled(on: boolean) {
      button.disabled = on;
      if (on) close();
    },
  };
}

const focusedItem = (menu: HTMLElement) => (menu.getRootNode() as ShadowRoot | Document).activeElement;

// --- Select an area -----------------------------------------------------------------------------

/** Dim the page and let the person drag a rectangle over it; the box is in viewport coordinates, null if cancelled. */
export function pickArea(root: HTMLElement): Promise<Box | null> {
  adoptStyle(root, "shots", SHOTS_CSS);
  return new Promise((resolve) => {
    const sel = h("div", { class: "sh-sel" });
    sel.hidden = true;
    const shield = h("div", { class: "sh-shield", "aria-hidden": "true" }, sel);
    const hint = h("div", { class: "sh-hint", role: "status" }, t("shotAreaHint"));
    let from: { x: number; y: number } | null = null;
    let offKeys = () => {
      // set below
    };
    const end = (box: Box | null) => {
      live.delete(cancel);
      offKeys();
      shield.remove();
      hint.remove();
      resolve(box);
    };
    const cancel = () => end(null);
    const paint = (b: Box) =>
      Object.assign(sel.style, {
        left: `${b.left}px`,
        top: `${b.top}px`,
        width: `${b.width}px`,
        height: `${b.height}px`,
      });
    shield.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      keepPointer(shield, e.pointerId);
      from = { x: e.clientX, y: e.clientY };
    });
    shield.addEventListener("pointermove", (e) => {
      if (!from) return;
      const b = boxFrom(from.x, from.y, e.clientX, e.clientY);
      sel.hidden = false;
      shield.classList.add("drag");
      paint(b);
    });
    shield.addEventListener("pointerup", (e) => {
      if (!from) return;
      const b = boxFrom(from.x, from.y, e.clientX, e.clientY);
      from = null;
      if (b.width >= 8 && b.height >= 8) end(b);
      else {
        sel.hidden = true; // a stray click: try again
        shield.classList.remove("drag");
      }
    });
    shield.addEventListener("pointercancel", () => {
      from = null;
      sel.hidden = true;
      shield.classList.remove("drag");
    });
    offKeys = grabKeys((e) => e.key === "Escape" && (cancel(), true));
    live.add(cancel);
    root.append(shield, hint);
  });
}

// --- Thumbnails ---------------------------------------------------------------------------------

export type GridHooks = {
  remove(a: Attachment): void;
  /** Present when an annotation editor is available; images only. */
  annotate?: ((a: Attachment) => void) | undefined;
  /** Whether this attachment can be taken again (a screenshot made here), and how. */
  retake?: { can(a: Attachment): boolean; run(a: Attachment): void } | undefined;
};

const isImage = (a: Attachment) => a.contentType.startsWith("image/");

/**
 * The attachment thumbnails: a grid of fixed-ratio cards (no layout shift while images decode), cached per
 * attachment so a re-render never decodes a picture twice. Click opens the lightbox.
 */
export function grid(root: HTMLElement, hooks: GridHooks) {
  adoptStyle(root, "shots", SHOTS_CSS);
  const el = h("div", { class: "sh-grid", role: "list", "aria-label": t("attachments") });
  el.hidden = true;
  const cards = new WeakMap<Attachment, HTMLElement>();
  let list: Attachment[] = [];

  const card = (a: Attachment): HTMLElement => {
    const img = isImage(a);
    const c = h("div", { class: "sh-card", role: "listitem" });
    const ph = (svg: string, text: string, cls = "") => h("span", { class: `sh-ph ${cls}` }, icon(svg), text);
    let thumb: HTMLElement;
    if (img) {
      const pic = h("img", { src: a.dataUrl, alt: "", decoding: "async", draggable: "false" });
      pic.addEventListener("load", () => {
        if (pic.naturalHeight > pic.naturalWidth * 1.1) c.classList.add("tall");
        c.classList.add("loaded");
      });
      pic.addEventListener("error", () => {
        c.classList.add("failed");
        thumb.append(ph(I.alert, t("imgFailed"), "err"));
      });
      thumb = h(
        "button",
        {
          type: "button",
          class: "sh-thumb",
          "aria-label": t("previewOpen", { name: a.name }),
          onclick: () => lightbox(root, list.filter(isImage), a, hooks, thumb),
        },
        h("span", { class: "sh-skel" }),
        pic,
      );
    } else
      thumb = h("div", { class: "sh-thumb pdf" }, ph(I.file, (a.name.split(".").pop() ?? "").toUpperCase()));
    const act = (svg: string, label: string, run: () => void) =>
      h(
        "button",
        { type: "button", class: "sh-ib", "aria-label": label, title: label, onclick: run },
        icon(svg),
      );
    c.append(
      thumb,
      h(
        "div",
        { class: "sh-acts" },
        img && hooks.annotate && act(I.pen, t("annotateFile", { name: a.name }), () => hooks.annotate?.(a)),
        hooks.retake?.can(a) && act(I.reopen, t("retakeFile", { name: a.name }), () => hooks.retake?.run(a)),
        act(I.close, t("removeFile", { name: a.name }), () => hooks.remove(a)),
      ),
      h(
        "div",
        { class: "sh-meta" },
        h("span", { class: "sh-name", title: a.name }, a.name),
        h("small", {}, fmtSize(a.size)),
      ),
    );
    return c;
  };

  return {
    el,
    render(next: Attachment[]) {
      list = next;
      el.replaceChildren(
        ...next.map((a) => {
          let c = cards.get(a);
          if (!c) cards.set(a, (c = card(a)));
          return c;
        }),
      );
      el.hidden = !next.length;
    },
  };
}

// --- Lightbox -----------------------------------------------------------------------------------

/** A full-window viewer: zoom with the wheel, +/−, or the buttons; drag or use the arrows to pan; double-click toggles. */
function lightbox(
  root: HTMLElement,
  images: Attachment[],
  start: Attachment,
  hooks: GridHooks,
  opener: Element,
) {
  let at = Math.max(0, images.indexOf(start));
  let view: View = { s: 1, x: 0, y: 0 };
  let iw = 0;
  let ih = 0;
  let fit = 1;
  const cur = () => images[at] ?? start;

  const img = h("img", { alt: "", draggable: "false", decoding: "async" });
  img.style.visibility = "hidden";
  const spin = h("span", { class: "spin", role: "status", "aria-label": t("capturing") });
  const fail = h("span", { class: "sh-ph err" }, icon(I.alert), t("imgFailed"));
  fail.hidden = true;
  const stage = h("div", { class: "sh-stage", tabindex: 0 }, img, spin, fail);
  const name = h("span", {});
  const sub = h("small", {});
  const pct = h("span", { class: "sh-zoom", "aria-live": "polite" });
  const ib = (svg: string, label: string, run: () => void) =>
    h(
      "button",
      { type: "button", class: "sh-ib", "aria-label": label, title: label, onclick: run },
      icon(svg),
    );
  const bounds = (): [number, number, number, number] => [stage.clientWidth, stage.clientHeight, iw, ih];

  const apply = (v: View) => {
    view = v;
    img.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.s})`;
    pct.textContent = `${Math.round(v.s * 100)}%`;
    stage.classList.toggle("pan", v.s > fit + 0.001);
  };
  const toFit = () => {
    fit = fitScale(stage.clientWidth, stage.clientHeight, iw, ih);
    apply(clampView({ s: fit, x: 0, y: 0 }, ...bounds()));
  };
  const zoom = (to: number, cx = stage.clientWidth / 2, cy = stage.clientHeight / 2) => {
    if (iw) apply(zoomAt(view, to, cx, cy, fit, bounds()));
  };
  const pan = (dx: number, dy: number) =>
    iw && apply(clampView({ ...view, x: view.x + dx, y: view.y + dy }, ...bounds()));

  const show = () => {
    const a = cur();
    name.textContent = a.name;
    sub.textContent = [images.length > 1 && t("imgPos", { i: at + 1, n: images.length }), fmtSize(a.size)]
      .filter(Boolean)
      .join(" · ");
    iw = ih = 0;
    img.style.visibility = "hidden";
    spin.hidden = false;
    fail.hidden = true;
    img.onload = () => {
      iw = img.naturalWidth;
      ih = img.naturalHeight;
      img.style.width = `${iw}px`;
      img.style.height = `${ih}px`;
      spin.hidden = true;
      toFit();
      img.style.visibility = "";
    };
    img.onerror = () => {
      spin.hidden = true;
      fail.hidden = false;
    };
    img.src = a.dataUrl;
    prev.hidden = next.hidden = images.length < 2;
    annotateBtn.hidden = !hooks.annotate;
    retakeBtn.hidden = !hooks.retake?.can(a);
    for (const [b, key] of [
      [annotateBtn, "annotateFile"],
      [retakeBtn, "retakeFile"],
      [removeBtn, "removeFile"],
    ] as const) {
      const label = t(key, { name: a.name });
      b.setAttribute("aria-label", label);
      b.title = label;
    }
  };
  const go = (d: number) => {
    if (images.length < 2) return;
    at = (at + d + images.length) % images.length;
    show();
  };

  const done = (then?: () => void) => {
    live.delete(close);
    offKeys();
    window.removeEventListener("resize", onResize);
    release();
    box.remove();
    then?.();
  };
  const close = () => done();
  const onResize = () => {
    if (!iw) return;
    const wasFit = view.s <= fit + 0.001;
    fit = fitScale(stage.clientWidth, stage.clientHeight, iw, ih);
    apply(wasFit ? clampView({ s: fit, x: 0, y: 0 }, ...bounds()) : clampView(view, ...bounds()));
  };

  const annotateBtn = ib(I.pen, "", () => done(() => hooks.annotate?.(cur())));
  const retakeBtn = ib(I.reopen, "", () => done(() => hooks.retake?.run(cur())));
  const removeBtn = ib(I.trash, "", () => done(() => hooks.remove(cur())));
  const prev = ib(I.chevron, t("imgPrev"), () => go(-1));
  const next = ib(I.chevron, t("imgNext"), () => go(1));
  prev.classList.add("sh-nav", "prev");
  next.classList.add("sh-nav", "next");
  prev.style.rotate = "90deg";
  next.style.rotate = "-90deg";
  const closeBtn = ib(I.close, t("previewClose"), close);

  const box = h(
    "div",
    {
      class: "sh-lb",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": t("previewOpen", { name: start.name }),
    },
    h(
      "div",
      { class: "sh-bar" },
      h("div", { class: "sh-title" }, name, sub),
      ib(I.minus, t("zoomOut"), () => zoom(view.s / 1.4)),
      pct,
      ib(I.plus, t("zoomIn"), () => zoom(view.s * 1.4)),
      ib(I.view, t("zoomFit"), toFit),
      ib(I.target, t("zoomFull"), () => zoom(1)),
      annotateBtn,
      retakeBtn,
      removeBtn,
      closeBtn,
    ),
    h(
      "div",
      { class: "sh-stagewrap", style: "position:relative;min-height:0;display:grid" },
      stage,
      prev,
      next,
    ),
  );

  let drag: { id: number; x: number; y: number } | null = null;
  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !iw) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    keepPointer(stage, e.pointerId);
    stage.classList.add("panning");
  });
  stage.addEventListener("pointermove", (e) => {
    if (!drag) return;
    pan(e.clientX - drag.x, e.clientY - drag.y);
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  const endDrag = () => {
    drag = null;
    stage.classList.remove("panning");
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  stage.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      zoom(view.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false },
  );
  stage.addEventListener("dblclick", (e) => {
    const r = stage.getBoundingClientRect();
    zoom(view.s > fit + 0.001 ? fit : Math.max(1, fit * 2), e.clientX - r.left, e.clientY - r.top);
  });
  window.addEventListener("resize", onResize);

  const offKeys = grabKeys((e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const zoomed = view.s > fit + 0.001;
    switch (e.key) {
      case "Escape":
        close();
        return true;
      case "+":
      case "=":
        zoom(view.s * 1.4);
        return true;
      case "-":
        zoom(view.s / 1.4);
        return true;
      case "0":
        toFit();
        return true;
      case "1":
        zoom(1);
        return true;
      case "ArrowLeft":
        return zoomed ? (pan(60, 0), true) : images.length > 1 && (go(-1), true);
      case "ArrowRight":
        return zoomed ? (pan(-60, 0), true) : images.length > 1 && (go(1), true);
      case "ArrowUp":
        return zoomed && (pan(0, 60), true);
      case "ArrowDown":
        return zoomed && (pan(0, -60), true);
      default:
        return false;
    }
  });
  live.add(close);
  root.append(box);
  const release = trapFocus(box, opener);
  show();
  closeBtn.focus();
}

// --- Annotate -----------------------------------------------------------------------------------

function toCanvas(src: HTMLCanvasElement | string): Promise<HTMLCanvasElement> {
  if (typeof src !== "string") return Promise.resolve(src);
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
    img.src = src;
  });
}

const TOOLS: [Tool, string, string, string][] = [
  ["rect", I.rect, "toolRect", "R"],
  ["ellipse", I.ellipse, "toolEllipse", "O"],
  ["arrow", I.arrow, "toolArrow", "A"],
  ["pen", I.pen, "toolPen", "P"],
  ["highlighter", I.highlighter, "toolHighlighter", "H"],
  ["text", I.text, "toolText", "T"],
  ["blur", I.blur, "toolBlur", "B"],
  ["crop", I.crop, "toolCrop", "C"],
];

/**
 * The annotation editor in a dialog of its own. Resolves with the picture to attach (`changed` is false when
 * nothing was drawn, so the caller may keep what it has), or null when cancelled.
 */
export async function annotate(
  root: HTMLElement,
  Ed: typeof Editor,
  src: HTMLCanvasElement | string,
  confirm = t("annotateSave"),
): Promise<{ canvas: HTMLCanvasElement; changed: boolean } | null> {
  adoptStyle(root, "shots", SHOTS_CSS);
  const base = await toCanvas(src);
  return new Promise((resolve) => {
    const ed = new Ed(base, [], t("textPlaceholder"));
    const syncs: (() => void)[] = [];
    const tb = (
      attrs: Record<string, string>,
      child: Node,
      run: () => void,
      on: () => boolean,
      ok = () => true,
    ) => {
      const b = h("button", { type: "button", class: "tb", ...attrs, onclick: run }, child);
      syncs.push(() => {
        b.disabled = !ok();
        b.setAttribute("aria-pressed", String(on()));
      });
      return b;
    };
    const finish = (result: { canvas: HTMLCanvasElement; changed: boolean } | null) => {
      live.delete(cancel);
      offKeys();
      release();
      ed.destroy();
      dialog.remove();
      resolve(result);
    };
    const cancel = () => finish(null);
    const save = async () => {
      if (!ed.count) {
        finish({ canvas: base, changed: false });
        return;
      }
      try {
        finish({ canvas: await toCanvas(ed.export()), changed: true });
      } catch (err) {
        console.warn("[pinwren]", err);
        finish(null);
      }
    };
    const okBtn = h("button", { type: "button", class: "btn primary", onclick: save }, confirm);
    const dialog = h(
      "div",
      { class: "modal sh-ann", role: "dialog", "aria-modal": "true", "aria-label": t("annotateTitle") },
      h(
        "div",
        { class: "editor" },
        h(
          "div",
          { class: "toolbar", role: "toolbar", "aria-label": t("annotateTitle") },
          h(
            "div",
            { class: "tgroup" },
            ...TOOLS.map(([tool, svg, key, k]) =>
              tb(
                { "aria-label": t(key as never), "data-tip": `${t(key as never)} · ${k}` },
                icon(svg),
                () => ed.setTool(tool),
                () => ed.tool === tool,
              ),
            ),
          ),
          h("span", { class: "sep" }),
          h(
            "div",
            { class: "tgroup" },
            ...COLORS.map((c) =>
              tb(
                { class: "swatch", style: `--sw:${c}`, "aria-label": t("colour", { c }) },
                document.createTextNode(""),
                () => ed.setColor(c),
                () => ed.color === c,
              ),
            ),
          ),
          h("span", { class: "sep" }),
          tb(
            { "aria-label": t("undo"), "data-tip": t("undo") },
            icon(I.undo),
            () => ed.undo(),
            () => false,
            () => ed.canUndo,
          ),
          tb(
            { "aria-label": t("redo"), "data-tip": t("redo") },
            icon(I.redo),
            () => ed.redo(),
            () => false,
            () => ed.canRedo,
          ),
          h("span", { class: "grow" }),
          h("button", { type: "button", class: "btn ghost", onclick: cancel }, t("cancel")),
          okBtn,
        ),
        h("div", { class: "canvas-wrap" }, ed.el),
      ),
    );
    ed.onChange = () => {
      for (const s of syncs) s();
    };
    for (const s of syncs) s();
    const offKeys = grabKeys((e) => {
      const first = e.composedPath()[0];
      if (first instanceof Element && first.closest(".ed-text, input, textarea")) return false;
      if (e.key === "Escape") return (cancel(), true);
      return ed.key(e);
    });
    live.add(cancel);
    root.append(dialog);
    const release = trapFocus(dialog);
    okBtn.focus();
  });
}

/** A captured canvas as an attachment under the size limit, or null if it can't be made small enough. */
export const toAttachment = (canvas: HTMLCanvasElement, mode: ShotMode): Attachment | null =>
  canvasToAttachment(canvas, shotName(mode));

export const shots = {
  shotMenu,
  pickArea,
  grid,
  annotate,
  closeAll,
  cropCanvas,
  toAttachment,
  canvasToAttachment,
  shotName,
};
export type ShotsModule = typeof shots;

(window as unknown as { __pinwrenShots: ShotsModule }).__pinwrenShots = shots;
