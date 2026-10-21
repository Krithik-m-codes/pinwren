// Screenshot capture + annotation editor — built as its own file (widget-capture.js) and loaded only when
// someone reports a bug, so SnapDOM and the editor never weigh on the page otherwise (blueprint 05 §2, §6).
import { snapdom } from "@zumer/snapdom";
import { Editor } from "./editor";

export type CaptureMode = "visible" | "full" | "element";

/** Always hidden: the widget itself, opted-out nodes, and fields that may hold secrets. */
const MASK = [
  "annota-root",
  "[data-annota-ignore]",
  "[data-annota-mask]",
  "input[type=password]",
  "[autocomplete^=cc-]",
];
/** The colour behind `el`: its own or the nearest ancestor's background, else white — so transparent areas of
 * a full-page or element capture don't come out black. */
function backgroundOf(el: Element): string {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const c = getComputedStyle(e).backgroundColor;
    if (c && c !== "transparent" && !/rgba\(.*,\s*0\)$/.test(c)) return c;
  }
  return "#ffffff";
}

const MAX_SIDE = 16_000; // browsers refuse larger canvases
const MAX_PIXELS = 36e6;

/** Capture the visible viewport, the whole page, or one element. `masks` are the project's extra selectors. */
async function capture(mode: CaptureMode, masks: string[], el?: Element): Promise<HTMLCanvasElement> {
  const target = mode === "element" && el ? el : document.documentElement;
  let scale = Math.min(devicePixelRatio || 1, 2);
  if (mode !== "visible") {
    const r = target.getBoundingClientRect();
    const w = mode === "full" ? Math.max(document.documentElement.scrollWidth, r.width) : r.width;
    const h = mode === "full" ? Math.max(document.documentElement.scrollHeight, r.height) : r.height;
    scale = Math.min(scale, MAX_SIDE / Math.max(1, w, h), Math.sqrt(MAX_PIXELS / Math.max(1, w * h)));
  }
  const result = await snapdom(target, {
    clip: mode === "visible" ? "viewport" : null,
    scale,
    backgroundColor: backgroundOf(target === document.documentElement ? document.body : target),
    exclude: [...MASK, ...masks],
    excludeMode: "hide",
    embedFonts: true,
  });
  return result.toCanvas();
}

const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

/**
 * Fallback when DOM capture fails: one frame of a user-approved screen share. Must be called from a click
 * (getDisplayMedia needs user activation). `hide`/`show` take the widget off the screen for the frame.
 * The tracks are always stopped, so the browser's "sharing" indicator goes away immediately.
 */
async function screenShare(hide: () => void, show: () => void): Promise<HTMLCanvasElement> {
  const md = navigator.mediaDevices;
  if (!md?.getDisplayMedia) throw new Error("Screen sharing isn't supported in this browser");
  const stream = await md.getDisplayMedia({
    video: { displaySurface: "browser" },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: "include",
  } as DisplayMediaStreamOptions);
  try {
    hide();
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    // Let the hidden widget leave the shared surface before grabbing the frame.
    await frame();
    await new Promise((r) => setTimeout(r, 250));
    const until = Date.now() + 3000;
    while (!video.videoWidth && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
    if (!video.videoWidth) throw new Error("No video frame");
    const c = document.createElement("canvas");
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available");
    ctx.drawImage(video, 0, 0);
    video.srcObject = null;
    return c;
  } finally {
    for (const t of stream.getTracks()) t.stop();
    show();
  }
}

export type CaptureModule = {
  capture: typeof capture;
  screenShare: typeof screenShare;
  Editor: typeof Editor;
};

(window as unknown as { __annotaCapture: CaptureModule }).__annotaCapture = { capture, screenShare, Editor };
