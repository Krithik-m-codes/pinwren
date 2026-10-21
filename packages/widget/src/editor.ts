// Screenshot annotation editor (blueprint F-004): rectangle, arrow, pen, blur. Shapes are kept as
// vectors and flattened onto the screenshot only on export.

type Point = { x: number; y: number };
type Tool = "rect" | "arrow" | "pen" | "blur";
type Shape =
  | { tool: "rect" | "arrow" | "blur"; color: string; a: Point; b: Point }
  | { tool: "pen"; color: string; points: Point[] };

export const COLORS = ["#e5484d", "#f5a524", "#30a46c", "#0090ff", "#18181b"];

export class Editor {
  readonly canvas = document.createElement("canvas");
  private readonly ctx: CanvasRenderingContext2D;
  private shapes: Shape[] = [];
  private draft: Shape | null = null;
  tool: Tool = "rect";
  color = COLORS[0] as string;

  constructor(private readonly base: HTMLCanvasElement) {
    this.canvas.width = base.width;
    this.canvas.height = base.height;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available");
    this.ctx = ctx;
    this.canvas.addEventListener("pointerdown", this.onDown);
    this.render();
  }

  private toCanvas(e: PointerEvent): Point {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * this.canvas.width,
      y: ((e.clientY - r.top) / r.height) * this.canvas.height,
    };
  }

  private onDown = (e: PointerEvent) => {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.toCanvas(e);
    this.draft =
      this.tool === "pen"
        ? { tool: "pen", color: this.color, points: [p] }
        : { tool: this.tool, color: this.color, a: p, b: p };
    const move = (ev: PointerEvent) => {
      if (!this.draft) return;
      const q = this.toCanvas(ev);
      if (this.draft.tool === "pen") this.draft.points.push(q);
      else this.draft.b = q;
      this.render();
    };
    const up = () => {
      this.canvas.removeEventListener("pointermove", move);
      this.canvas.removeEventListener("pointerup", up);
      this.canvas.removeEventListener("pointercancel", up);
      if (this.draft && !isTiny(this.draft)) this.shapes.push(this.draft);
      this.draft = null;
      this.render();
    };
    this.canvas.addEventListener("pointermove", move);
    this.canvas.addEventListener("pointerup", up);
    this.canvas.addEventListener("pointercancel", up);
  };

  undo() {
    this.shapes.pop();
    this.render();
  }

  get count() {
    return this.shapes.length;
  }

  private render() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.base, 0, 0);
    const lw = Math.max(3, canvas.width / 400);
    for (const s of this.draft ? [...this.shapes, this.draft] : this.shapes) drawShape(ctx, this.base, s, lw);
  }

  /** Flattened image as a data URL, kept under the server's 8 MB limit. */
  export(): string {
    const webp = this.canvas.toDataURL("image/webp", 0.85);
    if (webp.startsWith("data:image/webp")) return webp;
    return this.canvas.toDataURL("image/jpeg", 0.85); // Safari can't encode WebP
  }

  destroy() {
    this.canvas.removeEventListener("pointerdown", this.onDown);
  }
}

function isTiny(s: Shape) {
  if (s.tool === "pen") return s.points.length < 2;
  return Math.abs(s.a.x - s.b.x) < 4 && Math.abs(s.a.y - s.b.y) < 4;
}

function drawShape(ctx: CanvasRenderingContext2D, base: HTMLCanvasElement, s: Shape, lw: number) {
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
  } else {
    const x = Math.min(s.a.x, s.b.x);
    const y = Math.min(s.a.y, s.b.y);
    const w = Math.abs(s.a.x - s.b.x);
    const h = Math.abs(s.a.y - s.b.y);
    if (s.tool === "rect") {
      ctx.strokeRect(x, y, w, h);
    } else if (s.tool === "blur") {
      pixelate(ctx, base, x, y, w, h);
    } else {
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
