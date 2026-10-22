// Screenshot capture — built as its own file (widget-capture.js: SnapDOM + this glue) and loaded only when
// someone reports a bug, so SnapDOM never weighs on the page otherwise (blueprint 05 §2, §6). The annotation
// editor is a separate chunk (widget-editor.js, wave-4 §7) that downloads alongside it.
import { snapdom } from "@zumer/snapdom";
import { blockGeometry, MASKS, maskedRects, paintBlocks, type Rect } from "./mask";

export type CaptureMode = "visible" | "full" | "element";

/** Left out of the picture entirely: the widget itself and opted-out nodes. */
const HIDE = ["pinwren-root", "[data-pinwren-ignore]"];
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
  const r = target.getBoundingClientRect();
  // The area the canvas will show, in viewport coordinates — needed to place the mask blocks.
  let origin: Rect = { left: 0, top: 0, width: innerWidth, height: innerHeight };
  if (mode !== "visible") {
    const w = mode === "full" ? Math.max(document.documentElement.scrollWidth, r.width) : r.width;
    const h = mode === "full" ? Math.max(document.documentElement.scrollHeight, r.height) : r.height;
    origin = mode === "full" ? { left: r.left, top: r.top, width: w, height: h } : rectOf(r);
    scale = Math.min(scale, MAX_SIDE / Math.max(1, w, h), Math.sqrt(MAX_PIXELS / Math.max(1, w * h)));
  }
  const masked = [...MASKS, ...masks];
  // Measured before the (async) capture so the blocks match the frame SnapDOM clones.
  const rects = maskedRects(masked);
  const result = await snapdom(target, {
    clip: mode === "visible" ? "viewport" : null,
    scale,
    backgroundColor: backgroundOf(target === document.documentElement ? document.body : target),
    exclude: [...HIDE, ...masked],
    excludeMode: "hide",
    embedFonts: true,
  });
  const canvas = await result.toCanvas();
  paintBlocks(canvas, blockGeometry(rects, origin, canvas.width, canvas.height));
  return canvas;
}

const rectOf = (r: DOMRect): Rect => ({ left: r.left, top: r.top, width: r.width, height: r.height });

const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

/**
 * Fallback when DOM capture fails: one frame of a user-approved screen share. Must be called from a click
 * (getDisplayMedia needs user activation). `hide`/`show` take the widget off the screen for the frame.
 * The tracks are always stopped, so the browser's "sharing" indicator goes away immediately.
 */
async function screenShare(
  hide: () => void,
  show: () => void,
  masks: string[] = [],
): Promise<HTMLCanvasElement> {
  // No mediaDevices on insecure (http://) pages, and no getDisplayMedia on mobile browsers.
  if (!("mediaDevices" in navigator) || !("getDisplayMedia" in navigator.mediaDevices))
    throw new Error("Screen sharing isn't supported in this browser");
  const stream = await navigator.mediaDevices.getDisplayMedia({
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
    // A shared tab shows the viewport, so masked elements can be blocked out there too. A shared window or
    // screen has unknown framing (aspect ratio differs) and can't be mapped onto the page.
    const vw = innerWidth;
    const vh = innerHeight;
    if (Math.abs(c.width / c.height - vw / vh) < 0.02)
      paintBlocks(
        c,
        blockGeometry(
          maskedRects([...MASKS, ...masks]),
          { left: 0, top: 0, width: vw, height: vh },
          c.width,
          c.height,
        ),
      );
    return c;
  } finally {
    for (const t of stream.getTracks()) t.stop();
    show();
  }
}

export type CaptureModule = {
  capture: typeof capture;
  screenShare: typeof screenShare;
};

(window as unknown as { __pinwrenCapture: CaptureModule }).__pinwrenCapture = {
  capture,
  screenShare,
};
