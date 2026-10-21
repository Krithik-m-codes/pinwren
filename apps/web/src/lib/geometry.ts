import type { AnchorBundle } from "@pinwren/core";

// Pin geometry on a viewport screenshot. The widget stores the anchor element's box in page
// coordinates (`rect.x/y` include scroll) plus the viewport size and scroll position at capture time,
// and the pin as percentages of that box (`wPct/hPct` present = a region). A viewport screenshot
// covers [scrollY, scrollY + vh] × [0, vw], so a pin maps onto any capture taken at the same viewport
// width — other widths reflow the page and positions would lie, so those are reported as unplaceable.

export type Capture = { vw: number; vh: number; scrollY: number };

export type Placement = {
  /** Percent of the capture width/height. */
  left: number;
  top: number;
  width?: number;
  height?: number;
  region: boolean;
};

export const captureOf = (a: AnchorBundle): Capture => ({
  vw: a.rect.vw,
  vh: a.rect.vh,
  scrollY: a.rect.scrollY,
});

export const isRegion = (a: AnchorBundle | null | undefined) =>
  !!a && a.pin.wPct !== undefined && a.pin.hPct !== undefined;

/**
 * Where `anchor`'s pin lands on `capture`, or null when it can't be placed honestly: a different
 * viewport width (> 2 % off), or a point scrolled outside the captured viewport.
 */
export function placeOn(anchor: AnchorBundle, capture: Capture): Placement | null {
  const { rect, pin } = anchor;
  if (!capture.vw || !capture.vh || !rect.vw) return null;
  if (Math.abs(rect.vw - capture.vw) / capture.vw > 0.02) return null;
  const x = rect.x + (pin.xPct / 100) * rect.w;
  const y = rect.y - capture.scrollY + (pin.yPct / 100) * rect.h;
  const left = (x / capture.vw) * 100;
  const top = (y / capture.vh) * 100;
  if (left < -1 || left > 101 || top < -1 || top > 101) return null;
  if (isRegion(anchor)) {
    const width = (((pin.wPct ?? 0) / 100) * rect.w * 100) / capture.vw;
    const height = (((pin.hPct ?? 0) / 100) * rect.h * 100) / capture.vh;
    return {
      left,
      top,
      width: Math.min(width, 100 - left),
      height: Math.min(height, 100 - top),
      region: true,
    };
  }
  return { left: clamp(left), top: clamp(top), region: false };
}

const clamp = (n: number) => Math.min(100, Math.max(0, n));
