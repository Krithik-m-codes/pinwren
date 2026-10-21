// Geometry for region comments (blueprint F-002, contract §2): a dragged rectangle is anchored to the
// smallest element that contains it and stored as percentages of that element's box, so it follows the
// element across breakpoints and re-layouts.

export type Box = { left: number; top: number; width: number; height: number };
export type PinPct = { xPct: number; yPct: number; wPct?: number | undefined; hPct?: number | undefined };

/** Rectangle spanned by two drag corners, whatever direction the drag went. */
export function boxFrom(x1: number, y1: number, x2: number, y2: number): Box {
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

/** Whether `outer` contains `inner`, allowing `slack` px for borders and sub-pixel rounding. */
export function contains(outer: Box, inner: Box, slack = 2): boolean {
  return (
    inner.left >= outer.left - slack &&
    inner.top >= outer.top - slack &&
    inner.left + inner.width <= outer.left + outer.width + slack &&
    inner.top + inner.height <= outer.top + outer.height + slack
  );
}

/**
 * Walk up from the element under the region's centre to the first ancestor whose box contains the
 * whole region. If nothing below <body> does, fall back to the element under the centre.
 */
export function regionAnchor(
  under: Element,
  region: Box,
  boxOf: (el: Element) => Box = (el) => el.getBoundingClientRect(),
): Element {
  for (let el: Element | null = under; el; el = el.parentElement) {
    if (el === document.body || el === document.documentElement) break;
    if (contains(boxOf(el), region)) return el;
  }
  return under;
}

const pct = (v: number, size: number) => (size > 0 ? Math.min(100, Math.max(0, (v / size) * 100)) : 0);
const round = (n: number) => Math.round(n * 100) / 100;

/** Region → `anchor.pin` relative to the anchor element's box (clipped to that box). */
export function regionPin(el: Box, region: Box): Required<PinPct> {
  const x = pct(region.left - el.left, el.width);
  const y = pct(region.top - el.top, el.height);
  const r = pct(region.left + region.width - el.left, el.width);
  const b = pct(region.top + region.height - el.top, el.height);
  return { xPct: round(x), yPct: round(y), wPct: round(Math.max(0, r - x)), hPct: round(Math.max(0, b - y)) };
}

/** Inverse of `regionPin`: where a stored pin/region sits on the element's current box. */
export function pinBox(el: Box, pin: PinPct): Box {
  return {
    left: el.left + (pin.xPct / 100) * el.width,
    top: el.top + (pin.yPct / 100) * el.height,
    width: ((pin.wPct ?? 0) / 100) * el.width,
    height: ((pin.hPct ?? 0) / 100) * el.height,
  };
}

/** True when the pin describes a region rather than a single point. */
export const isRegion = (pin: PinPct) => (pin.wPct ?? 0) > 0 && (pin.hPct ?? 0) > 0;

/**
 * Where a floating card goes next to `target`: below it if it fits, else above, else whichever side has
 * more room; always clamped inside the viewport (minus `rightInset`, e.g. an open side panel).
 */
export function placeCard(
  target: Box,
  card: { width: number; height: number },
  vw: number,
  vh: number,
  rightInset = 0,
  gap = 10,
): { left: number; top: number } {
  const m = 12;
  const below = target.top + target.height + gap;
  const above = target.top - gap - card.height;
  let top: number;
  if (below + card.height <= vh - m) top = below;
  else if (above >= m) top = above;
  else top = vh - (target.top + target.height) > target.top ? below : above;
  top = Math.max(m, Math.min(top, vh - card.height - m));
  const maxLeft = vw - rightInset - card.width - m;
  const left = Math.max(m, Math.min(target.left, maxLeft));
  return { left, top };
}
