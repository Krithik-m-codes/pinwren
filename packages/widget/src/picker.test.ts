// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { crumbPath, type Pick, Picker } from "./picker";

function page() {
  document.body.innerHTML = `<main id="m"><section><p id="p"><span id="s">hi</span></p></section></main>`;
  const host = document.createElement("div");
  const root = document.body.appendChild(document.createElement("div"));
  return { host, root };
}
const key = (k: string) =>
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});

describe("crumbPath", () => {
  it("lists the ancestors down to the element, capped", () => {
    page();
    const s = document.getElementById("s") as Element;
    expect(crumbPath(s).map((e) => e.tagName)).toEqual(["MAIN", "SECTION", "P", "SPAN"]);
    expect(crumbPath(s, 2).map((e) => e.tagName)).toEqual(["P", "SPAN"]);
  });
});

describe("Picker modes", () => {
  it("offers an Element / Region toggle that follows E and R", () => {
    const { host, root } = page();
    const picker = new Picker(host, root, () => undefined);
    const radios = [...root.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(radios).toHaveLength(2);
    expect(picker.mode).toBe("element");
    expect(radios[0]?.getAttribute("aria-checked")).toBe("true");
    key("r");
    expect(picker.mode).toBe("region");
    expect(radios[1]?.getAttribute("aria-checked")).toBe("true");
    radios[0]?.click();
    expect(picker.mode).toBe("element");
    picker.stop();
  });

  it("remembers the mode for the next comment", () => {
    const { host, root } = page();
    const a = new Picker(host, root, () => undefined);
    a.setMode("region");
    a.stop();
    const b = new Picker(host, root, () => undefined);
    expect(b.mode).toBe("region");
    b.setMode("element");
    b.stop();
  });

  it("cancels on Escape", () => {
    const { host, root } = page();
    const done = vi.fn<(p: Pick | null) => void>();
    const picker = new Picker(host, root, done);
    key("Escape");
    expect(done).toHaveBeenCalledWith(null);
    picker.stop();
  });

  it("walks the DOM with the arrows and picks with Enter in element mode", () => {
    const { host, root } = page();
    const done = vi.fn<(p: Pick | null) => void>();
    const picker = new Picker(host, root, done);
    // Nothing hovered yet: an arrow starts at <main>, ArrowDown goes to its first child.
    key("ArrowUp");
    key("ArrowDown");
    const crumbs = [...root.querySelectorAll(".crumb")].map((c) => c.textContent);
    expect(crumbs.length).toBeGreaterThan(0);
    key("Enter");
    expect(done).toHaveBeenCalledTimes(1);
    picker.stop();
  });

  it("has no toggle for element-only capture (bug reports)", () => {
    const { host, root } = page();
    const picker = new Picker(host, root, () => undefined, true);
    expect(root.querySelector('[role="radiogroup"]')).toBeNull();
    picker.setMode("region");
    expect(picker.mode).not.toBe("region");
    picker.stop();
  });
});
