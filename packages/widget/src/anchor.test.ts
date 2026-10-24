// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { captureAnchor, resolveAnchor, similarity } from "./anchor";

describe("similarity", () => {
  it("is 1 for identical text and 0 for unrelated text", () => {
    expect(similarity("Start a subscription", "Start a subscription")).toBe(1);
    expect(similarity("Start a subscription", "zzzz")).toBe(0);
  });
  it("tolerates small edits", () => {
    expect(similarity("Start a subscription", "Start your subscription")).toBeGreaterThan(0.7);
  });
});

describe("anchors", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main>
        <section><h1 data-testid="hero">Small-batch coffee</h1><p>Roasted Mondays</p></section>
        <section><button class="cta css-1x2y3z">Start a subscription</button></section>
      </main>`;
  });

  it("re-finds an element by its test id even after the DOM moves", () => {
    const h1 = document.querySelector("h1") as Element;
    const anchor = captureAnchor(h1, 10, 10);
    document.querySelector("main")?.prepend(document.createElement("div"));
    expect(resolveAnchor(anchor)?.element).toBe(h1);
  });

  it("keeps stable ids and drops generated ones (useId prefix, UUIDs, digit runs)", () => {
    const h1 = document.querySelector("h1") as Element;
    const idOf = (id: string) => {
      h1.id = id;
      return captureAnchor(h1, 0, 0).attrs?.id;
    };
    expect(idOf("pricing-hero")).toBe("pricing-hero");
    expect(idOf("hero-r2")).toBe("hero-r2"); // `:r` only counts at the start
    expect(idOf(":r1:")).toBeUndefined();
    expect(idOf("el-3f2a9c1b-77aa-4f00")).toBeUndefined();
    expect(idOf("node-12345")).toBeUndefined();
    h1.removeAttribute("id");
  });

  it("ignores hashed CSS-in-JS class names in the selector", () => {
    const btn = document.querySelector("button") as Element;
    expect(captureAnchor(btn, 0, 0).css).not.toContain("css-1x2y3z");
  });

  it("falls back to fuzzy text matching when the structure changes", () => {
    const btn = document.querySelector("button") as Element;
    const anchor = captureAnchor(btn, 0, 0);
    document.body.innerHTML = `<div class="new-layout"><div><a role="button">x</a></div>
      <div><button class="primary">Start a subscription</button></div></div>`;
    const found = resolveAnchor(anchor);
    expect(found?.element.textContent).toBe("Start a subscription");
  });

  it("reports an orphan instead of guessing when the element is gone", () => {
    const btn = document.querySelector("button") as Element;
    const anchor = captureAnchor(btn, 0, 0);
    document.body.innerHTML = "<p>Completely different page</p>";
    expect(resolveAnchor(anchor)).toBeNull();
  });
});
