// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_BYTES } from "./attachments";
import {
  attachmentFromUrl,
  canvasToAttachment,
  clampView,
  cropRect,
  dataUrlBytes,
  fitScale,
  MAX_ZOOM,
  shotName,
  zoomAt,
} from "./shot-math";

describe("shotName", () => {
  it("is readable and sortable", () => {
    const now = new Date("2026-11-02T14:05:09Z");
    expect(shotName("area", now)).toBe("screenshot-area-2026-11-02-14-05-09.png");
    expect(shotName("tab", now, "webp")).toBe("screenshot-tab-2026-11-02-14-05-09.webp");
  });
});

describe("cropRect", () => {
  const box = { left: 100, top: 50, width: 200, height: 100 };
  it("maps a viewport box onto a capture at any device pixel ratio", () => {
    expect(cropRect(box, 1000, 500, 1000, 500)).toEqual({ x: 100, y: 50, w: 200, h: 100 });
    expect(cropRect(box, 1000, 500, 2000, 1000)).toEqual({ x: 200, y: 100, w: 400, h: 200 });
    expect(cropRect(box, 1000, 500, 1500, 750)).toEqual({ x: 150, y: 75, w: 300, h: 150 });
  });
  it("clamps boxes that stick out and never returns an empty rectangle", () => {
    expect(cropRect({ left: 900, top: 450, width: 400, height: 400 }, 1000, 500, 1000, 500)).toEqual({
      x: 900,
      y: 450,
      w: 100,
      h: 50,
    });
    expect(cropRect({ left: -50, top: -20, width: 100, height: 40 }, 1000, 500, 1000, 500)).toEqual({
      x: 0,
      y: 0,
      w: 100,
      h: 40,
    });
    const tiny = cropRect({ left: 5000, top: 5000, width: 0, height: 0 }, 1000, 500, 1000, 500);
    expect(tiny.w).toBeGreaterThanOrEqual(1);
    expect(tiny.h).toBeGreaterThanOrEqual(1);
    expect(tiny.x + tiny.w).toBeLessThanOrEqual(1000);
  });
});

describe("data URLs", () => {
  it("measures the decoded size, with and without padding", () => {
    expect(dataUrlBytes("data:image/png;base64,QUJD")).toBe(3);
    expect(dataUrlBytes("data:image/png;base64,QUI=")).toBe(2);
    expect(dataUrlBytes("data:image/png;base64,QQ==")).toBe(1);
  });
  it("accepts only the image types a report can carry", () => {
    expect(attachmentFromUrl("data:image/webp;base64,QUJD", "a.webp")).toEqual({
      name: "a.webp",
      contentType: "image/webp",
      dataUrl: "data:image/webp;base64,QUJD",
      size: 3,
    });
    expect(attachmentFromUrl("data:image/svg+xml;base64,QUJD", "a.svg")).toBeNull();
    expect(attachmentFromUrl("data:text/html;base64,QUJD", "a.html")).toBeNull();
  });
});

describe("canvasToAttachment", () => {
  /** Canvases whose encoded size is `bytesFor(type, width)`; drawing is a no-op (happy-dom can't paint). */
  const fake = (bytesFor: (type: string, w: number) => number, width = 1000) => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: () => undefined,
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function (
      this: HTMLCanvasElement,
      type = "image/png",
    ) {
      return `data:${type};base64,${"A".repeat(Math.ceil((bytesFor(type, this.width) * 4) / 3))}`;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = width / 2;
    return canvas;
  };
  afterEach(() => vi.restoreAllMocks());

  it("keeps a PNG that fits", () => {
    const a = canvasToAttachment(
      fake(() => 1000),
      "s.png",
    );
    expect(a?.contentType).toBe("image/png");
    expect(a?.name).toBe("s.png");
  });
  it("falls back to WebP, then halves the size, until it fits", () => {
    const canvas = fake((type, w) => (type === "image/png" ? MAX_BYTES * 2 : w * 10_000));
    const a = canvasToAttachment(canvas, "s.png");
    expect(a?.contentType).toBe("image/webp");
    expect(a?.name).toBe("s.webp");
    expect(a?.size).toBeLessThanOrEqual(MAX_BYTES);
  });
  it("gives up on a picture that cannot be made small enough", () => {
    expect(
      canvasToAttachment(
        fake(() => MAX_BYTES * 3, 300),
        "s.png",
      ),
    ).toBeNull();
  });
});

describe("lightbox view", () => {
  const bounds: [number, number, number, number] = [800, 600, 1600, 1200];
  it("fits the whole image but never enlarges it", () => {
    expect(fitScale(800, 600, 1600, 1200)).toBe(0.5);
    expect(fitScale(800, 600, 100, 50)).toBe(1);
    expect(fitScale(800, 600, 0, 0)).toBe(1);
  });
  it("centres an image smaller than the stage and stops panning at its edges", () => {
    expect(clampView({ s: 0.25, x: 999, y: -999 }, ...bounds)).toEqual({ s: 0.25, x: 200, y: 150 });
    expect(clampView({ s: 1, x: 100, y: 100 }, ...bounds)).toEqual({ s: 1, x: 0, y: 0 });
    expect(clampView({ s: 1, x: -5000, y: -5000 }, ...bounds)).toEqual({ s: 1, x: -800, y: -600 });
  });
  it("zooms around the cursor, within the fit..max range", () => {
    const fit = 0.5;
    const v0 = clampView({ s: fit, x: 0, y: 0 }, ...bounds);
    const v1 = zoomAt(v0, 1, 400, 300, fit, bounds);
    expect(v1.s).toBe(1);
    // the image point under the stage centre is still under it
    expect((400 - v1.x) / v1.s).toBeCloseTo((400 - v0.x) / v0.s);
    expect((300 - v1.y) / v1.s).toBeCloseTo((300 - v0.y) / v0.s);
    expect(zoomAt(v1, 100, 0, 0, fit, bounds).s).toBe(MAX_ZOOM);
    expect(zoomAt(v1, 0.01, 0, 0, fit, bounds).s).toBe(fit);
  });
});
