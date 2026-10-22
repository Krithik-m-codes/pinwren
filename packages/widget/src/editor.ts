// Screenshot annotation editor (blueprint F-004) — the lazy widget-editor.js chunk (wave-4 §7). Shapes stay
// vectors (see shapes.ts) and are flattened onto the screenshot only on export, so undo/redo, drafts and
// re-rendering at any size are lossless.
import {
  COLORS,
  cropOf,
  ellipseOf,
  History,
  isTiny,
  type Point,
  rectOf,
  type Shape,
  type Size,
  strokeWidth,
  TOOL_KEYS,
  type Tool,
  textSize,
} from "./shapes";

const MAX_DATA_URL = 10_500_000; // the API accepts 11 MB of data URL
type TextShape = Extract<Shape, { tool: "text" }>;

export class Editor {
  readonly el = document.createElement("div");
  readonly canvas = document.createElement("canvas");
  private readonly ctx: CanvasRenderingContext2D;
  private readonly history = new History<Shape>();
  private draft: Shape | null = null;
  private typing: { input: HTMLInputElement; shape: TextShape } | null = null;
  tool: Tool = "rect";
  color: string = COLORS[0];
  size: Size = "m";
  /** Called after every change of tool, colour, size or shapes, so the toolbar and draft can follow. */
  onChange: (() => void) | null = null;

  constructor(
    private readonly base: HTMLCanvasElement,
    shapes: Shape[] = [],
    private readonly textPlaceholder = "",
  ) {
    this.el.className = "ed";
    this.canvas.width = base.width;
    this.canvas.height = base.height;
    this.canvas.dataset.tool = this.tool;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available");
    this.ctx = ctx;
    this.history.load(shapes);
    this.canvas.dataset.shapes = String(shapes.length);
    this.el.append(this.canvas);
    this.canvas.addEventListener("pointerdown", this.onDown);
    this.render();
  }

  get shapes(): Shape[] {
    return this.history.items.slice();
  }
  get count() {
    return this.history.items.length;
  }
  get canUndo() {
    return this.history.canUndo;
  }
  get canRedo() {
    return this.history.canRedo;
  }

  private changed() {
    this.render();
    this.canvas.dataset.shapes = String(this.count); // lets tests (and devtools) see the vector count
    try {
      this.onChange?.();
    } catch (err) {
      console.warn("[pinwren]", err);
    }
  }

  setTool(tool: Tool) {
    this.commitText();
    this.tool = tool;
    this.canvas.dataset.tool = tool;
    this.changed();
  }
  setColor(c: string) {
    this.color = c;
    if (this.typing) this.typing.input.style.color = c;
    this.changed();
  }
  setSize(s: Size) {
    this.size = s;
    this.changed();
  }
  undo() {
    this.commitText();
    this.history.undo();
    this.changed();
  }
  redo() {
    this.history.redo();
    this.changed();
  }

  /** Editor shortcuts: R O A P T B C pick tools, Ctrl/⌘+Z undo, Ctrl/⌘+Shift+Z or Ctrl+Y redo. */
  key(e: KeyboardEvent): boolean {
    if (e.altKey) return false;
    const k = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (k === "z" && !e.shiftKey) this.undo();
      else if ((k === "z" && e.shiftKey) || k === "y") this.redo();
      else return false;
      return true;
    }
    const tool = TOOL_KEYS[k];
    if (!tool || e.shiftKey) return false;
    this.setTool(tool);
    return true;
  }

  private toCanvas(e: PointerEvent): Point {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * this.canvas.width,
      y: ((e.clientY - r.top) / r.height) * this.canvas.height,
    };
  }

  private onDown = (e: PointerEvent) => {
    if (e.button > 0) return;
    e.preventDefault();
    this.commitText();
    const p = this.toCanvas(e);
    if (this.tool === "text") {
      this.placeText(p);
      return;
    }
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // pointer capture is a nicety; drawing works without it
    }
    const { color, size } = this;
    this.draft =
      this.tool === "pen"
        ? { tool: "pen", color, size, points: [p] }
        : { tool: this.tool, color, size, a: p, b: p };
    const move = (ev: PointerEvent) => {
      const d = this.draft;
      if (!d || d.tool === "text") return;
      const q = this.toCanvas(ev);
      if (d.tool === "pen") d.points.push(q);
      else d.b = q;
      this.render();
    };
    const up = () => {
      this.canvas.removeEventListener("pointermove", move);
      this.canvas.removeEventListener("pointerup", up);
      this.canvas.removeEventListener("pointercancel", up);
      const d = this.draft;
      this.draft = null;
      if (d && !isTiny(d)) this.history.push(d);
      this.changed();
    };
    this.canvas.addEventListener("pointermove", move);
    this.canvas.addEventListener("pointerup", up);
    this.canvas.addEventListener("pointercancel", up);
  };

  /** Click → an inline input on the canvas; Enter (or clicking elsewhere) commits, Esc cancels. */
  private placeText(at: Point) {
    const px = textSize(this.canvas.width, this.size);
    const r = this.canvas.getBoundingClientRect();
    const k = r.width / this.canvas.width || 1;
    const input = document.createElement("input");
    input.className = "ed-text";
    input.placeholder = this.textPlaceholder;
    input.setAttribute("aria-label", this.textPlaceholder);
    input.maxLength = 200;
    Object.assign(input.style, {
      left: `${(at.x / this.canvas.width) * 100}%`,
      top: `${(at.y / this.canvas.height) * 100}%`,
      fontSize: `${px * k}px`,
      color: this.color,
    });
    input.addEventListener("keydown", (e) => {
      e.stopPropagation(); // typing "r" must not switch tools, and Esc must not close the report
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        if (e.key === "Escape") input.value = "";
        this.commitText();
      }
    });
    input.addEventListener("blur", () => this.commitText());
    this.typing = { input, shape: { tool: "text", color: this.color, size: this.size, at, text: "", px } };
    this.el.append(input);
    requestAnimationFrame(() => input.focus({ preventScroll: true }));
  }

  private commitText() {
    const t = this.typing;
    if (!t) return;
    this.typing = null;
    t.input.remove();
    t.shape.text = t.input.value.trim();
    t.shape.color = this.color;
    if (!isTiny(t.shape)) this.history.push(t.shape);
    this.changed();
  }

  private render(forExport = false) {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.base, 0, 0);
    const all = this.draft ? [...this.history.items, this.draft] : this.history.items;
    for (const s of all) if (s.tool !== "crop") drawShape(ctx, this.base, s);
    if (forExport) return;
    // Show the crop as a dimmed surround; the pixels themselves are only cut on export.
    const d = this.draft?.tool === "crop" ? this.draft : null;
    const crop = d ? rectOf(d.a, d.b) : cropOf(this.shapes, canvas.width, canvas.height);
    if (crop) {
      ctx.save();
      ctx.fillStyle = "rgba(9,9,11,.6)";
      ctx.beginPath();
      ctx.rect(0, 0, canvas.width, canvas.height);
      ctx.rect(crop.x, crop.y, crop.w, crop.h);
      ctx.fill("evenodd");
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = Math.max(1, canvas.width / 800);
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);
      ctx.restore();
    }
  }

  /** Flattened (and cropped) image as a data URL, kept under the server's size limit. */
  export(): string {
    this.commitText();
    this.render(true);
    const crop = cropOf(this.shapes, this.canvas.width, this.canvas.height);
    let src: HTMLCanvasElement = this.canvas;
    if (crop) {
      src = document.createElement("canvas");
      src.width = crop.w;
      src.height = crop.h;
      src.getContext("2d")?.drawImage(this.canvas, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
    }
    let out = encode(src, 0.85);
    // Very tall full-page captures: lower the quality, then halve the size until it fits.
    if (out.length > MAX_DATA_URL) out = encode(src, 0.6);
    while (out.length > MAX_DATA_URL && src.width > 400) {
      const half = document.createElement("canvas");
      half.width = Math.round(src.width / 2);
      half.height = Math.round(src.height / 2);
      half.getContext("2d")?.drawImage(src, 0, 0, half.width, half.height);
      src = half;
      out = encode(src, 0.7);
    }
    this.render();
    return out;
  }

  destroy() {
    this.typing = null;
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.el.remove();
  }
}

function encode(c: HTMLCanvasElement, q: number) {
  const webp = c.toDataURL("image/webp", q);
  return webp.startsWith("data:image/webp") ? webp : c.toDataURL("image/jpeg", q); // Safari can't encode WebP
}

function drawShape(ctx: CanvasRenderingContext2D, base: HTMLCanvasElement, s: Shape) {
  const lw = strokeWidth(ctx.canvas.width, s.size);
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = lw;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (s.tool === "pen") {
    ctx.beginPath();
    for (const [i, p] of s.points.entries()) {
      if (i) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
    }
    ctx.stroke();
  } else if (s.tool === "text") {
    ctx.font = `600 ${s.px}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textBaseline = "top";
    // A white halo keeps the label readable on any background.
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = s.px / 5;
    ctx.strokeText(s.text, s.at.x, s.at.y);
    ctx.fillText(s.text, s.at.x, s.at.y);
  } else if (s.tool === "ellipse") {
    const e = ellipseOf(s.a, s.b);
    ctx.beginPath();
    ctx.ellipse(e.cx, e.cy, Math.max(1, e.rx), Math.max(1, e.ry), 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (s.tool !== "crop") {
    const r = rectOf(s.a, s.b);
    if (s.tool === "rect") ctx.strokeRect(r.x, r.y, r.w, r.h);
    else if (s.tool === "blur") pixelate(ctx, base, r.x, r.y, r.w, r.h);
    else {
      const angle = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
      const head = lw * 5;
      ctx.beginPath();
      ctx.moveTo(s.a.x, s.a.y);
      ctx.lineTo(s.b.x, s.b.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s.b.x, s.b.y);
      ctx.lineTo(s.b.x - head * Math.cos(angle - 0.45), s.b.y - head * Math.sin(angle - 0.45));
      ctx.lineTo(s.b.x - head * Math.cos(angle + 0.45), s.b.y - head * Math.sin(angle + 0.45));
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Coarse pixelation — irreversible, unlike a CSS blur, so it is safe for hiding personal data. */
function pixelate(
  ctx: CanvasRenderingContext2D,
  base: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  if (w < 1 || h < 1) return;
  const block = Math.max(8, Math.round(Math.min(w, h) / 6));
  const tiny = document.createElement("canvas");
  tiny.width = Math.max(1, Math.ceil(w / block));
  tiny.height = Math.max(1, Math.ceil(h / block));
  const t = tiny.getContext("2d");
  if (!t) return;
  t.drawImage(base, x, y, w, h, 0, 0, tiny.width, tiny.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tiny, 0, 0, tiny.width, tiny.height, x, y, w, h);
}

export type EditorModule = { Editor: typeof Editor };
(window as unknown as { __pinwrenEditor: EditorModule }).__pinwrenEditor = { Editor };
