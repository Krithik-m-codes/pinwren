import { describe, expect, it } from "vitest";
import {
  bounds,
  cropOf,
  ellipseOf,
  History,
  isTiny,
  type Shape,
  sanitizeShapes,
  strokeWidth,
  TOOL_KEYS,
  textSize,
} from "./shapes";

const P = (x: number, y: number) => ({ x, y });

describe("ellipse", () => {
  it("is inscribed in the dragged box, in any drag direction", () => {
    expect(ellipseOf(P(10, 20), P(110, 80))).toEqual({ cx: 60, cy: 50, rx: 50, ry: 30 });
    expect(ellipseOf(P(110, 80), P(10, 20))).toEqual({ cx: 60, cy: 50, rx: 50, ry: 30 });
  });
  it("has the dragged box as its bounds", () => {
    const s: Shape = { tool: "ellipse", color: "#e5484d", size: "m", a: P(110, 80), b: P(10, 20) };
    expect(bounds(s)).toEqual({ x: 10, y: 20, w: 100, h: 60 });
  });
});

describe("text labels", () => {
  const label: Shape = { tool: "text", color: "#0090ff", size: "m", at: P(100, 50), text: "Broken", px: 20 };
  it("measures with the given function and pads for the outline", () => {
    expect(bounds(label, (t, px) => t.length * px * 0.5)).toEqual({ x: 95, y: 45, w: 70, h: 34 });
  });
  it("falls back to an approximate width", () => {
    expect(bounds(label).w).toBeCloseTo(6 * 20 * 0.56 + 10);
  });
  it("scales the font with the screenshot width, clamped, per size", () => {
    expect(textSize(1280, "m")).toBe(27);
    expect(textSize(2560, "m")).toBe(53);
    expect(textSize(300, "m")).toBe(14); // floor
    expect(textSize(10_000, "m")).toBe(96); // ceiling
    expect(textSize(1280, "s")).toBeLessThan(textSize(1280, "m"));
    expect(textSize(1280, "l")).toBeGreaterThan(textSize(1280, "m"));
  });
  it("drops empty labels", () => {
    expect(isTiny({ ...label, text: "   " })).toBe(true);
    expect(isTiny(label)).toBe(false);
  });
});

describe("other shapes", () => {
  it("pen bounds cover every point", () => {
    const pen: Shape = { tool: "pen", color: "#18181b", size: "s", points: [P(5, 9), P(30, 2), P(12, 40)] };
    expect(bounds(pen)).toEqual({ x: 5, y: 2, w: 25, h: 38 });
  });
  it("clicks without a drag are tiny", () => {
    expect(isTiny({ tool: "rect", color: "#e5484d", size: "m", a: P(5, 5), b: P(7, 8) })).toBe(true);
    expect(isTiny({ tool: "arrow", color: "#e5484d", size: "m", a: P(5, 5), b: P(50, 8) })).toBe(false);
    expect(isTiny({ tool: "pen", color: "#e5484d", size: "m", points: [P(1, 1)] })).toBe(true);
  });
  it("stroke width grows with the canvas and the size setting", () => {
    expect(strokeWidth(400, "m")).toBe(2);
    expect(strokeWidth(2400, "m")).toBe(6);
    expect(strokeWidth(2400, "l")).toBeGreaterThan(strokeWidth(2400, "s"));
  });
  it("maps every tool to a shortcut key", () => {
    expect(TOOL_KEYS).toEqual({
      r: "rect",
      o: "ellipse",
      a: "arrow",
      p: "pen",
      t: "text",
      b: "blur",
      c: "crop",
    });
  });
});

describe("crop", () => {
  const crop = (a: [number, number], b: [number, number]): Shape => ({
    tool: "crop",
    color: "#e5484d",
    size: "m",
    a: P(...a),
    b: P(...b),
  });
  it("uses the latest crop, clamped to the canvas", () => {
    expect(cropOf([crop([10, 10], [50, 50]), crop([-20, 300], [700, 100])], 640, 400)).toEqual({
      x: 0,
      y: 100,
      w: 640,
      h: 200,
    });
  });
  it("ignores slivers and the absence of a crop", () => {
    expect(cropOf([crop([10, 10], [14, 200])], 640, 400)).toBeNull();
    expect(cropOf([], 640, 400)).toBeNull();
  });
});

describe("History (undo/redo)", () => {
  it("undoes and redoes in order", () => {
    const h = new History<string>();
    expect(h.canUndo).toBe(false);
    h.push("a");
    h.push("b");
    h.push("c");
    expect(h.undo()).toBe("c");
    expect(h.undo()).toBe("b");
    expect(h.items).toEqual(["a"]);
    expect(h.canRedo).toBe(true);
    expect(h.redo()).toBe("b");
    expect(h.items).toEqual(["a", "b"]);
  });
  it("a new shape after undo drops the redo branch", () => {
    const h = new History<string>();
    h.push("a");
    h.push("b");
    h.undo();
    h.push("x");
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBeUndefined();
    expect(h.items).toEqual(["a", "x"]);
  });
  it("undo on empty is a no-op; load replaces and clears redo", () => {
    const h = new History<string>();
    expect(h.undo()).toBeUndefined();
    h.push("a");
    h.undo();
    h.load(["p", "q"]);
    expect(h.items).toEqual(["p", "q"]);
    expect(h.canRedo).toBe(false);
  });
});

describe("sanitizeShapes (drafts read back from IndexedDB)", () => {
  it("keeps valid shapes and drops anything malformed", () => {
    const good: Shape[] = [
      { tool: "rect", color: "#e5484d", size: "m", a: P(1, 2), b: P(3, 4) },
      { tool: "text", color: "#0090ff", size: "l", at: P(1, 2), text: "hi", px: 30 },
      { tool: "pen", color: "#18181b", size: "s", points: [P(1, 1), P(2, 2)] },
    ];
    const bad = [
      null,
      "x",
      { tool: "rect", color: "red;}", size: "m", a: P(1, 2), b: P(3, 4) },
      { tool: "nuke", color: "#e5484d", size: "m", a: P(1, 2), b: P(3, 4) },
      { tool: "pen", color: "#e5484d", size: "m", points: [{ x: "1", y: 2 }] },
      { tool: "text", color: "#e5484d", size: "xl", at: P(1, 2), text: "x", px: 3 },
    ];
    expect(sanitizeShapes([...good, ...bad])).toEqual(good);
    expect(sanitizeShapes({})).toEqual([]);
  });
});
