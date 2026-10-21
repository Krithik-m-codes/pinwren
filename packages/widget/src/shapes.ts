// Pure annotation-shape model shared by the editor (lazy chunk) and the report form (core): no canvas,
// no DOM, so it is unit-testable and cheap to import from either bundle.

export type Point = { x: number; y: number };
export type Tool = "rect" | "ellipse" | "arrow" | "pen" | "text" | "blur" | "crop";
export type Size = "s" | "m" | "l";
export type Bounds = { x: number; y: number; w: number; h: number };
export type Shape =
  | { tool: "rect" | "ellipse" | "arrow" | "blur" | "crop"; color: string; size: Size; a: Point; b: Point }
  | { tool: "pen"; color: string; size: Size; points: Point[] }
  | { tool: "text"; color: string; size: Size; at: Point; text: string; px: number };

export const COLORS = ["#e5484d", "#f5a524", "#30a46c", "#0090ff", "#18181b"] as const;
export const TOOLS: Tool[] = ["rect", "ellipse", "arrow", "pen", "text", "blur", "crop"];
/** Keyboard shortcuts inside the editor. */
export const TOOL_KEYS: Record<string, Tool> = {
  r: "rect",
  o: "ellipse",
  a: "arrow",
  p: "pen",
  t: "text",
  b: "blur",
  c: "crop",
};

const SCALE: Record<Size, number> = { s: 0.65, m: 1, l: 1.6 };

/** Stroke width in canvas pixels: proportional to the screenshot so lines look the same at any DPR. */
export const strokeWidth = (canvasW: number, size: Size) => Math.max(2, canvasW / 400) * SCALE[size];

/** Text label font size in canvas pixels, scaled to the screenshot width (≈ 1/48th, 14–96 px). */
export const textSize = (canvasW: number, size: Size) =>
  Math.round(Math.min(96, Math.max(14, canvasW / 48)) * SCALE[size]);

export function rectOf(a: Point, b: Point): Bounds {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/** The ellipse inscribed in the dragged box. */
export function ellipseOf(a: Point, b: Point) {
  const r = rectOf(a, b);
  return { cx: r.x + r.w / 2, cy: r.y + r.h / 2, rx: r.w / 2, ry: r.h / 2 };
}

/** Rough text width when no canvas is available to measure (≈ 0.56 em per character). */
export const approxWidth = (text: string, px: number) => text.length * px * 0.56;

/** Axis-aligned bounds of any shape; text uses `measure` (canvas measureText in the editor). */
export function bounds(s: Shape, measure: (text: string, px: number) => number = approxWidth): Bounds {
  if (s.tool === "pen") {
    const xs = s.points.map((p) => p.x);
    const ys = s.points.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  if (s.tool === "text") {
    // `at` is the top-left of the label; the box includes the outline padding on each side.
    const pad = s.px * 0.25;
    return { x: s.at.x - pad, y: s.at.y - pad, w: measure(s.text, s.px) + pad * 2, h: s.px * 1.2 + pad * 2 };
  }
  return rectOf(s.a, s.b);
}

/** A click without a real drag — dropped rather than drawn. */
export function isTiny(s: Shape): boolean {
  if (s.tool === "pen") return s.points.length < 2;
  if (s.tool === "text") return !s.text.trim();
  return Math.abs(s.a.x - s.b.x) < 4 && Math.abs(s.a.y - s.b.y) < 4;
}

/** The crop in effect: the most recent crop shape, clamped to the canvas. */
export function cropOf(shapes: Shape[], w: number, h: number): Bounds | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s?.tool !== "crop") continue;
    const r = rectOf(s.a, s.b);
    const x = Math.max(0, Math.round(r.x));
    const y = Math.max(0, Math.round(r.y));
    const cw = Math.min(w, Math.round(r.x + r.w)) - x;
    const ch = Math.min(h, Math.round(r.y + r.h)) - y;
    return cw >= 8 && ch >= 8 ? { x, y, w: cw, h: ch } : null;
  }
  return null;
}

/** Undo/redo stack. A new shape after an undo discards the redo branch, like every editor. */
export class History<T> {
  private done: T[] = [];
  private undone: T[] = [];

  get items(): readonly T[] {
    return this.done;
  }
  get canUndo() {
    return this.done.length > 0;
  }
  get canRedo() {
    return this.undone.length > 0;
  }
  push(item: T) {
    this.done.push(item);
    this.undone = [];
  }
  undo(): T | undefined {
    const s = this.done.pop();
    if (s !== undefined) this.undone.push(s);
    return s;
  }
  redo(): T | undefined {
    const s = this.undone.pop();
    if (s !== undefined) this.done.push(s);
    return s;
  }
  load(items: T[]) {
    this.done = items.slice();
    this.undone = [];
  }
}

/** Validate shapes restored from a draft (IndexedDB is page-writable, so never trust its shape). */
export function sanitizeShapes(raw: unknown): Shape[] {
  if (!Array.isArray(raw)) return [];
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const pt = (p: unknown): p is Point => !!p && num((p as Point).x) && num((p as Point).y);
  const hex = (c: unknown) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
  const size = (z: unknown): z is Size => z === "s" || z === "m" || z === "l";
  return raw.filter((x: unknown): x is Shape => {
    if (!x || typeof x !== "object") return false;
    const s = x as Record<string, unknown>;
    if (!hex(s.color) || !size(s.size)) return false;
    if (s.tool === "pen") return Array.isArray(s.points) && s.points.every(pt);
    if (s.tool === "text") return pt(s.at) && typeof s.text === "string" && num(s.px);
    return (TOOLS as readonly unknown[]).includes(s.tool) && pt(s.a) && pt(s.b);
  });
}
