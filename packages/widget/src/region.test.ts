// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { type Box, boxFrom, contains, isRegion, pinBox, placeCard, regionAnchor, regionPin } from "./region";

const B = (left: number, top: number, width: number, height: number): Box => ({ left, top, width, height });

describe("boxFrom", () => {
  it("normalises drags in any direction", () => {
    expect(boxFrom(50, 60, 10, 20)).toEqual(B(10, 20, 40, 40));
    expect(boxFrom(10, 20, 50, 60)).toEqual(B(10, 20, 40, 40));
  });
});

describe("regionPin / pinBox", () => {
  const el = B(100, 200, 400, 200);

  it("stores the region as percentages of the anchor element's box", () => {
    expect(regionPin(el, B(140, 240, 200, 50))).toEqual({ xPct: 10, yPct: 20, wPct: 50, hPct: 25 });
  });

  it("round-trips through pinBox, and scales with the element", () => {
    const pin = regionPin(el, B(140, 240, 200, 50));
    expect(pinBox(el, pin)).toEqual(B(140, 240, 200, 50));
    // The element moved and halved in width (a narrower breakpoint): the region follows it.
    expect(pinBox(B(20, 900, 200, 200), pin)).toEqual(B(40, 940, 100, 50));
  });

  it("clips a region that spills outside the element", () => {
    expect(regionPin(el, B(50, 150, 600, 100))).toEqual({ xPct: 0, yPct: 0, wPct: 100, hPct: 25 });
  });

  it("handles zero-size elements without NaN", () => {
    const pin = regionPin(B(0, 0, 0, 0), B(0, 0, 10, 10));
    expect(Object.values(pin).every(Number.isFinite)).toBe(true);
  });

  it("tells point pins from regions", () => {
    expect(isRegion({ xPct: 5, yPct: 5 })).toBe(false);
    expect(isRegion({ xPct: 5, yPct: 5, wPct: 10, hPct: 0 })).toBe(false);
    expect(isRegion({ xPct: 5, yPct: 5, wPct: 10, hPct: 10 })).toBe(true);
  });
});

describe("contains", () => {
  it("allows a couple of pixels of slack for borders", () => {
    expect(contains(B(0, 0, 100, 100), B(-1, -1, 102, 102))).toBe(true);
    expect(contains(B(0, 0, 100, 100), B(-5, 0, 50, 50))).toBe(false);
  });
});

describe("regionAnchor", () => {
  document.body.innerHTML = `<main><section><article><h3>Title</h3></article></section></main>`;
  const boxes = new Map<string, Box>([
    ["H3", B(20, 20, 200, 30)],
    ["ARTICLE", B(10, 10, 300, 200)],
    ["SECTION", B(0, 0, 1000, 400)],
    ["MAIN", B(0, 0, 1000, 2000)],
  ]);
  const boxOf = (el: Element) => boxes.get(el.tagName) ?? B(0, 0, 0, 0);
  const h3 = document.querySelector("h3") as Element;

  it("picks the smallest element containing the whole region", () => {
    expect(regionAnchor(h3, B(30, 25, 100, 20), boxOf).tagName).toBe("H3");
    expect(regionAnchor(h3, B(30, 25, 250, 100), boxOf).tagName).toBe("ARTICLE");
    expect(regionAnchor(h3, B(30, 25, 600, 100), boxOf).tagName).toBe("SECTION");
  });

  it("falls back to the element under the centre when nothing below <body> contains it", () => {
    expect(regionAnchor(h3, B(-50, 0, 2000, 3000), boxOf).tagName).toBe("H3");
  });
});

describe("placeCard", () => {
  const card = { width: 340, height: 200 };
  it("goes below the target when it fits", () => {
    expect(placeCard(B(100, 100, 50, 50), card, 1280, 800)).toEqual({ left: 100, top: 160 });
  });
  it("flips above when there is no room below", () => {
    expect(placeCard(B(100, 650, 50, 50), card, 1280, 800)).toEqual({ left: 100, top: 440 });
  });
  it("stays inside the viewport and clear of an open side panel", () => {
    expect(placeCard(B(1200, 100, 10, 10), card, 1280, 800).left).toBe(1280 - 340 - 12);
    expect(placeCard(B(1200, 100, 10, 10), card, 1280, 800, 360).left).toBe(1280 - 360 - 340 - 12);
    expect(placeCard(B(-50, 100, 10, 10), card, 1280, 800).left).toBe(12);
  });
});
