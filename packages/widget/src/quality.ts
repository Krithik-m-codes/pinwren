// Screenshot quality (project setting `capture.quality`; the reporter can drop to `low` for one report).
// `scale` caps the capture's pixel ratio, `q` is the WebP/JPEG quality, `maxWidth` shrinks the exported image.

export type Quality = "high" | "standard" | "low";

export const QUALITY: Record<Quality, { scale: number; q: number; maxWidth: number }> = {
  high: { scale: 3, q: 0.95, maxWidth: 0 },
  standard: { scale: 2, q: 0.85, maxWidth: 0 },
  low: { scale: 1, q: 0.6, maxWidth: 1280 },
};
