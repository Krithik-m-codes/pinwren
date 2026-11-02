import { type Attachment, MAX_BYTES } from "./attachments";
import type { Box } from "./region";

// Pure helpers behind "Add screenshot" and the attachment preview (lazy widget-shots.js chunk): cropping a
// capture to a dragged region, fitting it under the attachment size limit, and the zoom / pan arithmetic of
// the lightbox. No DOM beyond canvas, so they are unit-tested directly.

export type ShotMode = "visible" | "full" | "area" | "element" | "tab";

/** `screenshot-area-2026-11-02-14-05-09.png` — readable, sortable, unique within a second. */
export function shotName(mode: ShotMode, now = new Date(), ext = "png"): string {
  return `screenshot-${mode}-${now.toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${ext}`;
}

/** The part of `canvas` that a viewport-space `box` covers, in canvas pixels, clamped inside it (≥ 1 px). */
export function cropRect(box: Box, vw: number, vh: number, cw: number, ch: number) {
  const sx = cw / Math.max(1, vw);
  const sy = ch / Math.max(1, vh);
  const x = Math.min(cw - 1, Math.max(0, Math.round(box.left * sx)));
  const y = Math.min(ch - 1, Math.max(0, Math.round(box.top * sy)));
  const w = Math.max(1, Math.min(cw - x, Math.round(box.width * sx)));
  const h = Math.max(1, Math.min(ch - y, Math.round(box.height * sy)));
  return { x, y, w, h };
}

/** Cut a viewport-space region out of a capture of the viewport (any device pixel ratio). */
export function cropCanvas(src: HTMLCanvasElement, box: Box, vw: number, vh: number): HTMLCanvasElement {
  const r = cropRect(box, vw, vh, src.width, src.height);
  const out = document.createElement("canvas");
  out.width = r.w;
  out.height = r.h;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is not available");
  ctx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return out;
}

/** Decoded size of a base64 data URL. */
export function dataUrlBytes(url: string): number {
  const i = url.indexOf(",");
  const b64 = url.slice(i + 1);
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

const MIME = /^data:(image\/[a-z]+);base64,/;

/** An attachment from a data URL (the editor's output); null when it isn't an image we accept. */
export function attachmentFromUrl(dataUrl: string, name: string): Attachment | null {
  const type = MIME.exec(dataUrl)?.[1];
  if (!type || !["image/png", "image/jpeg", "image/webp"].includes(type)) return null;
  return { name, contentType: type, dataUrl, size: dataUrlBytes(dataUrl) };
}

/**
 * Encode a canvas under the 5 MB attachment limit: lossless PNG when it fits, then WebP at falling quality,
 * then the same at half the size, until it does. Null only for a canvas too small to shrink further.
 */
export function canvasToAttachment(canvas: HTMLCanvasElement, name: string): Attachment | null {
  let src = canvas;
  const png = attachmentFromUrl(src.toDataURL("image/png"), name);
  if (png && png.size <= MAX_BYTES) return png;
  const base = name.replace(/\.\w+$/, "");
  for (let step = 0; step < 6; step++) {
    for (const q of [0.92, 0.8, 0.65]) {
      const a = attachmentFromUrl(src.toDataURL("image/webp", q), `${base}.webp`);
      if (a && a.size <= MAX_BYTES) return a;
    }
    if (src.width < 400) return null;
    const half = document.createElement("canvas");
    half.width = Math.round(src.width / 2);
    half.height = Math.round(src.height / 2);
    half.getContext("2d")?.drawImage(src, 0, 0, half.width, half.height);
    src = half;
  }
  return null;
}

// --- Lightbox view arithmetic -------------------------------------------------------------------

/** Where the image sits in the stage: `s` = scale, `x`/`y` = the offset of its top-left corner. */
export type View = { s: number; x: number; y: number };
export const MAX_ZOOM = 8;

/** The scale at which the whole image is visible (never enlarged beyond its natural size). */
export function fitScale(sw: number, sh: number, iw: number, ih: number): number {
  if (iw <= 0 || ih <= 0 || sw <= 0 || sh <= 0) return 1;
  return Math.min(1, sw / iw, sh / ih);
}

/** Keep the image on screen: centred when smaller than the stage, otherwise never dragged past an edge. */
export function clampView(v: View, sw: number, sh: number, iw: number, ih: number): View {
  const w = iw * v.s;
  const h = ih * v.s;
  const x = w <= sw ? (sw - w) / 2 : Math.min(0, Math.max(sw - w, v.x));
  const y = h <= sh ? (sh - h) / 2 : Math.min(0, Math.max(sh - h, v.y));
  return { s: v.s, x, y };
}

/** Zoom to scale `next` keeping the stage point (cx, cy) fixed — the cursor stays on what it points at. */
export function zoomAt(
  v: View,
  next: number,
  cx: number,
  cy: number,
  fit: number,
  bounds: [number, number, number, number],
): View {
  const s = Math.min(MAX_ZOOM, Math.max(fit, next));
  const k = s / v.s;
  return clampView({ s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }, ...bounds);
}
