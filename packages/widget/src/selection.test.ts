// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { findQuote, locateQuote, MAX_QUOTE, pageSelection, rangeAt, toTextRange } from "./selection";

function setup(html: string) {
  document.body.innerHTML = html;
  return document.getElementById("p") as HTMLElement;
}

describe("selection → textRange", () => {
  it("measures offsets across nested elements in the common ancestor's text", () => {
    const p = setup(`<p id="p">Small-batch <b>coffee</b>, roasted <i>every</i> Monday.</p>`);
    const r = document.createRange();
    const b = p.querySelector("b")?.firstChild as Text;
    const i = p.querySelector("i")?.firstChild as Text;
    r.setStart(b, 2); // "ffee"
    r.setEnd(i, 3); // "eve"
    const tr = toTextRange(p, r);
    expect(tr.quote).toBe("ffee, roasted eve");
    expect(p.textContent?.slice(tr.startOffset, tr.endOffset)).toBe(tr.quote);
    expect(tr).toEqual({ startOffset: 14, endOffset: 31, quote: "ffee, roasted eve" });
  });

  it("caps the quote at 500 characters but keeps the real end offset", () => {
    const p = setup(`<p id="p">${"x".repeat(800)}</p>`);
    const r = document.createRange();
    r.setStart(p.firstChild as Text, 100);
    r.setEnd(p.firstChild as Text, 750);
    const tr = toTextRange(p, r);
    expect(tr.quote).toHaveLength(MAX_QUOTE);
    expect(tr.endOffset - tr.startOffset).toBe(650);
  });
});

describe("locateQuote / rangeAt / findQuote", () => {
  it("uses the stored offsets while the text is unchanged", () => {
    expect(locateQuote("Hello brave new world", { startOffset: 6, endOffset: 11, quote: "brave" })).toEqual([
      6, 11,
    ]);
  });

  it("follows the quote when text before it changed, picking the nearest occurrence", () => {
    const text = "Intro! Hello brave new world. Be brave.";
    expect(locateQuote(text, { startOffset: 6, endOffset: 11, quote: "brave" })).toEqual([13, 18]);
    expect(locateQuote(text, { startOffset: 40, endOffset: 45, quote: "brave" })).toEqual([33, 38]);
  });

  it("gives up when the quoted text is gone", () => {
    expect(locateQuote("Hello world", { startOffset: 6, endOffset: 11, quote: "brave" })).toBeNull();
    expect(locateQuote("Hello", { startOffset: 0, endOffset: 0, quote: "" })).toBeNull();
  });

  it("builds a live range over text nodes and re-finds a stored quote", () => {
    const p = setup(`<p id="p">Small-batch <b>coffee</b>, roasted <i>every</i> Monday.</p>`);
    const r = rangeAt(p, 14, 31);
    expect(r?.toString()).toBe("ffee, roasted eve");
    expect(rangeAt(p, 5, 5)).toBeNull();
    expect(rangeAt(p, 0, 999)).toBeNull();
    // The page re-rendered with extra text in front: the highlight still lands on the quote.
    p.insertAdjacentHTML("afterbegin", "<em>New!</em> ");
    expect(findQuote(p, { startOffset: 14, endOffset: 31, quote: "ffee, roasted eve" })?.toString()).toBe(
      "ffee, roasted eve",
    );
    p.textContent = "Completely different copy";
    expect(findQuote(p, { startOffset: 14, endOffset: 31, quote: "ffee, roasted eve" })).toBeNull();
  });
});

describe("pageSelection", () => {
  it("returns the page selection and its common ancestor, not ours or a field's", () => {
    const p = setup(
      `<p id="p">Some <b>bold</b> text</p><pinwren-root id="host"><span id="in">x</span></pinwren-root>`,
    );
    const host = document.getElementById("host") as HTMLElement;
    const sel = getSelection() as Selection;
    const r = document.createRange();
    r.setStart(p.firstChild as Text, 0);
    r.setEnd(p.lastChild as Text, 3);
    sel.removeAllRanges();
    sel.addRange(r);
    const got = pageSelection(host, () => false);
    expect(got?.el).toBe(p);
    expect(got?.range.toString()).toBe("Some bold te");
    expect(pageSelection(host, (el) => el === p)).toBeNull();

    const inner = document.getElementById("in")?.firstChild as Text;
    const r2 = document.createRange();
    r2.selectNodeContents(inner);
    sel.removeAllRanges();
    sel.addRange(r2);
    expect(pageSelection(host, () => false)).toBeNull();
    sel.removeAllRanges();
    expect(pageSelection(host, () => false)).toBeNull();
  });
});
