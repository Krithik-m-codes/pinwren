// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { blockGeometry, maskedRects, PRIVACY_MASKS } from "./mask";

describe("blockGeometry", () => {
  const viewport = { left: 0, top: 0, width: 1280, height: 800 };

  it("maps viewport rects onto a 2× visible-area capture", () => {
    expect(blockGeometry([{ left: 100, top: 50, width: 200, height: 40 }], viewport, 2560, 1600)).toEqual([
      { left: 200, top: 100, width: 400, height: 80 },
    ]);
  });

  it("rounds outwards so no sliver of the content survives", () => {
    const [b] = blockGeometry([{ left: 10.4, top: 20.6, width: 30.2, height: 10.1 }], viewport, 1280, 800);
    expect(b).toEqual({ left: 10, top: 20, width: 31, height: 11 });
  });

  it("offsets by the captured area: full page (scrolled) and a single element", () => {
    // Scrolled 300 px: the document's top is at -300 in viewport coordinates.
    const doc = { left: 0, top: -300, width: 1280, height: 2400 };
    expect(blockGeometry([{ left: 40, top: 10, width: 100, height: 30 }], doc, 1280, 2400)).toEqual([
      { left: 40, top: 310, width: 100, height: 30 },
    ]);
    const el = { left: 200, top: 100, width: 400, height: 200 };
    expect(blockGeometry([{ left: 220, top: 150, width: 100, height: 20 }], el, 800, 400)).toEqual([
      { left: 40, top: 100, width: 200, height: 40 },
    ]);
  });

  it("clips to the canvas and drops blocks outside it or without size", () => {
    const el = { left: 200, top: 100, width: 400, height: 200 };
    expect(
      blockGeometry(
        [
          { left: 150, top: 80, width: 100, height: 40 }, // straddles the top-left corner
          { left: 900, top: 100, width: 50, height: 50 }, // right of the element
          { left: 300, top: 150, width: 0, height: 20 }, // no width
        ],
        el,
        400,
        200,
      ),
    ).toEqual([{ left: 0, top: 0, width: 50, height: 20 }]);
    expect(
      blockGeometry([{ left: 0, top: 0, width: 10, height: 10 }], { ...el, width: 0 }, 400, 200),
    ).toEqual([]);
  });
});

describe("maskedRects", () => {
  it("finds built-in and privacy masks, skipping ignored subtrees and bad selectors", () => {
    document.body.innerHTML = `
      <input id="name"><input type="checkbox" id="cb"><input type="hidden" id="hid"><textarea id="ta"></textarea>
      <div data-pinwren-ignore><input id="ignored"></div><p contenteditable="true" id="ce">x</p>`;
    const seen: string[] = [];
    const orig = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      seen.push(this.id);
      return {
        left: 1,
        top: 2,
        width: 3,
        height: 4,
        right: 4,
        bottom: 6,
        x: 1,
        y: 2,
        toJSON() {},
      } as DOMRect;
    };
    try {
      const rects = maskedRects([...PRIVACY_MASKS, "::not-a-selector("]);
      expect(seen.sort()).toEqual(["ce", "name", "ta"]);
      expect(rects).toHaveLength(3);
    } finally {
      Element.prototype.getBoundingClientRect = orig;
    }
  });
});
