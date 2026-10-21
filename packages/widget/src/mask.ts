// Screenshot masking (blueprint 05 §6, wave-3 §4). Masked elements are hidden in the DOM clone *and* painted
// over afterwards as solid neutral blocks of the element's size, so a reader of the report sees "something
// was here and was withheld" instead of a hole that looks like a rendering bug.

export type Rect = { left: number; top: number; width: number; height: number };

/** Built-in masks: opted-in nodes and fields that may hold secrets. */
export const MASKS = ["[data-annota-mask]", "input[type=password]", "[autocomplete^=cc-]"];

/** Privacy mode (wave-3 §3): every field a person can type into. */
export const PRIVACY_MASKS = [
  "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset]):not([type=image]):not([type=range]):not([type=color]):not([type=file])",
  "textarea",
  "select",
  '[contenteditable]:not([contenteditable="false"])',
];

export const BLOCK_FILL = "#a1a1aa";

/**
 * Where each masked element's block goes on the captured canvas. `rects` and `origin` are in viewport
 * coordinates (getBoundingClientRect); `origin` is the area the canvas shows (viewport, whole document or one
 * element). Blocks are rounded outwards so no anti-aliased sliver of the content survives, and clipped to
 * the canvas; blocks entirely outside it are dropped.
 */
export function blockGeometry(rects: readonly Rect[], origin: Rect, cw: number, ch: number): Rect[] {
  if (origin.width <= 0 || origin.height <= 0 || cw <= 0 || ch <= 0) return [];
  const sx = cw / origin.width;
  const sy = ch / origin.height;
  const out: Rect[] = [];
  for (const r of rects) {
    if (!(r.width > 0 && r.height > 0)) continue;
    const x1 = Math.max(0, Math.floor((r.left - origin.left) * sx));
    const y1 = Math.max(0, Math.floor((r.top - origin.top) * sy));
    const x2 = Math.min(cw, Math.ceil((r.left + r.width - origin.left) * sx));
    const y2 = Math.min(ch, Math.ceil((r.top + r.height - origin.top) * sy));
    if (x2 > x1 && y2 > y1) out.push({ left: x1, top: y1, width: x2 - x1, height: y2 - y1 });
  }
  return out;
}

/** Viewport rects of every element matching `selectors` (invalid selectors are skipped, never thrown). */
export function maskedRects(selectors: readonly string[], root: ParentNode = document): Rect[] {
  const seen = new Set<Element>();
  const rects: Rect[] = [];
  for (const sel of selectors) {
    let found: NodeListOf<Element>;
    try {
      found = root.querySelectorAll(sel);
    } catch {
      continue;
    }
    for (const el of found) {
      if (seen.has(el) || el.closest("annota-root, [data-annota-ignore]")) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0)
        rects.push({ left: r.left, top: r.top, width: r.width, height: r.height });
    }
  }
  return rects;
}

/** Paint the blocks onto the canvas in place. */
export function paintBlocks(canvas: HTMLCanvasElement, blocks: readonly Rect[]) {
  const ctx = canvas.getContext("2d");
  if (!ctx || !blocks.length) return;
  ctx.save();
  ctx.fillStyle = BLOCK_FILL;
  for (const b of blocks) ctx.fillRect(b.left, b.top, b.width, b.height);
  ctx.restore();
}
