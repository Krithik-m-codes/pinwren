import { describe, expect, it } from "vitest";
import { QUALITY } from "./quality";

describe("QUALITY", () => {
  it("gets smaller from high to low", () => {
    expect(QUALITY.high.scale).toBeGreaterThan(QUALITY.standard.scale);
    expect(QUALITY.standard.scale).toBeGreaterThan(QUALITY.low.scale);
    expect(QUALITY.high.q).toBeGreaterThan(QUALITY.standard.q);
    expect(QUALITY.standard.q).toBeGreaterThan(QUALITY.low.q);
  });
  it("only the low setting shrinks the picture", () => {
    expect(QUALITY.high.maxWidth).toBe(0);
    expect(QUALITY.standard.maxWidth).toBe(0);
    expect(QUALITY.low.maxWidth).toBeGreaterThan(0);
  });
});
