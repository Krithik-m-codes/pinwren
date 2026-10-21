// Screenshot capture — built as its own file (widget-capture.js) and loaded only when someone
// reports a bug, so SnapDOM never weighs on the page otherwise (blueprint 05 §2, §6).
import { snapdom } from "@zumer/snapdom";

const MASK = [
  "annota-root",
  "[data-annota-ignore]",
  "[data-annota-mask]",
  "input[type=password]",
  "[autocomplete^=cc-]",
];

async function captureViewport(): Promise<HTMLCanvasElement> {
  const result = await snapdom(document.documentElement, {
    clip: "viewport",
    scale: Math.min(devicePixelRatio || 1, 2),
    exclude: MASK,
    excludeMode: "hide",
    embedFonts: true,
  });
  return result.toCanvas();
}

(window as unknown as { __annotaCapture: typeof captureViewport }).__annotaCapture = captureViewport;
