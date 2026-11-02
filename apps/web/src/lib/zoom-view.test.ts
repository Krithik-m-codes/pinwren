import { describe, expect, it } from "vitest";
import { clampView, fitScale, MAX_ZOOM, zoomAt } from "./zoom-view";

const b = { sw: 800, sh: 600, iw: 1600, ih: 1200 };

describe("zoom view", () => {
  it("fits the whole image but never enlarges it", () => {
    expect(fitScale(b)).toBe(0.5);
    expect(fitScale({ ...b, iw: 100, ih: 50 })).toBe(1);
    expect(fitScale({ ...b, iw: 0, ih: 0 })).toBe(1);
  });

  it("centres a small image and stops panning at the edges", () => {
    expect(clampView({ s: 0.25, x: 999, y: -999 }, b)).toEqual({ s: 0.25, x: 200, y: 150 });
    expect(clampView({ s: 1, x: 100, y: 100 }, b)).toEqual({ s: 1, x: 0, y: 0 });
    expect(clampView({ s: 1, x: -5000, y: -5000 }, b)).toEqual({ s: 1, x: -800, y: -600 });
  });

  it("zooms around the cursor within fit..max", () => {
    const v0 = clampView({ s: 0.5, x: 0, y: 0 }, b);
    const v1 = zoomAt(v0, 1, 100, 80, b);
    expect(v1.s).toBe(1);
    expect((100 - v1.x) / v1.s).toBeCloseTo((100 - v0.x) / v0.s);
    expect((80 - v1.y) / v1.s).toBeCloseTo((80 - v0.y) / v0.s);
    expect(zoomAt(v1, 100, 0, 0, b).s).toBe(MAX_ZOOM);
    expect(zoomAt(v1, 0.01, 0, 0, b).s).toBe(0.5);
  });
});
