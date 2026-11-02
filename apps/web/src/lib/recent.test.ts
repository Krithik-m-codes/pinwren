import { describe, expect, it } from "vitest";
import { MAX_RECENT, parseRecent, withRecent } from "./recent";

const item = (n: number) => ({ id: `f${n}`, number: n, title: `Item ${n}`, project: "Site" });

describe("recent items", () => {
  it("puts the newest first and never duplicates", () => {
    const list = withRecent(withRecent([], item(1)), item(2));
    expect(withRecent(list, item(1)).map((r) => r.id)).toEqual(["f1", "f2"]);
  });

  it("keeps only the most recent few", () => {
    let list = parseRecent(null);
    for (let n = 1; n <= MAX_RECENT + 3; n++) list = withRecent(list, item(n));
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0]?.id).toBe(`f${MAX_RECENT + 3}`);
  });

  it("drops entries that are not well-formed", () => {
    const raw = JSON.stringify([item(1), { id: 2 }, null, "x", item(1), { ...item(3), extra: true }]);
    expect(parseRecent(raw).map((r) => r.id)).toEqual(["f1", "f3"]);
    expect(parseRecent("not json")).toEqual([]);
    expect(parseRecent('{"a":1}')).toEqual([]);
  });

  it("trims very long titles", () => {
    expect(withRecent([], { ...item(1), title: "x".repeat(500) })[0]?.title).toHaveLength(200);
  });
});
