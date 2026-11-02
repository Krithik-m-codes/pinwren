// Zoom and pan arithmetic for the attachment lightbox (same model as the widget's preview): the image sits at
// `(x, y)` scaled by `s` inside a stage; zooming keeps the point under the cursor fixed.

export type View = { s: number; x: number; y: number };
export type Bounds = { sw: number; sh: number; iw: number; ih: number };
export const MAX_ZOOM = 8;

/** The scale at which the whole image is visible, never enlarged past its natural size. */
export function fitScale({ sw, sh, iw, ih }: Bounds): number {
  if (iw <= 0 || ih <= 0 || sw <= 0 || sh <= 0) return 1;
  return Math.min(1, sw / iw, sh / ih);
}

/** Keep the image on screen: centred when smaller than the stage, otherwise never dragged past an edge. */
export function clampView(v: View, { sw, sh, iw, ih }: Bounds): View {
  const w = iw * v.s;
  const h = ih * v.s;
  return {
    s: v.s,
    x: w <= sw ? (sw - w) / 2 : Math.min(0, Math.max(sw - w, v.x)),
    y: h <= sh ? (sh - h) / 2 : Math.min(0, Math.max(sh - h, v.y)),
  };
}

/** Zoom to scale `next` (kept within fit..MAX_ZOOM) around the stage point (cx, cy). */
export function zoomAt(v: View, next: number, cx: number, cy: number, b: Bounds): View {
  const s = Math.min(MAX_ZOOM, Math.max(fitScale(b), next));
  const k = s / v.s;
  return clampView({ s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }, b);
}
