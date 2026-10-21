import type { AnchorBundle } from "@pinwren/core";
import { finder } from "@medv/finder";

// Anchor capture and re-attachment (blueprint F-030/F-031). A pin is stored with several
// independent ways to find its element again, so it survives redesigns and re-renders.

/** Class names produced by CSS-in-JS / CSS modules / hashing — useless across deploys. */
const UNSTABLE_CLASS =
  /^(css|sc|jsx|emotion|svelte|astro)-[\w-]{4,}$|_[a-z0-9]{5,}$|^[a-z]{1,3}[A-Z0-9]\w{5,}$|[[:\]/]/;
/** Generated ids: React useId (`:r1:`), UUIDs, long digit runs. */
const UNSTABLE_ID = /^:r|[0-9a-f]{8}-[0-9a-f]{4}|\d{4,}/i;

const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

function textOf(el: Element, max = 120) {
  return normalize(el instanceof HTMLElement ? el.innerText : el.textContent).slice(0, max);
}

function xpathOf(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node?.nodeType === 1 && node !== document.documentElement) {
    const tag = node.tagName.toLowerCase();
    let i = 1;
    let sib = node.previousElementSibling;
    while (sib) {
      if (sib.tagName === node.tagName) i++;
      sib = sib.previousElementSibling;
    }
    parts.unshift(`${tag}[${i}]`);
    node = node.parentElement;
  }
  return `/html/${parts.join("/")}`;
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

function depth(el: Element) {
  let d = 0;
  for (let n = el.parentElement; n; n = n.parentElement) d++;
  return d;
}

function siblingText(el: Element, dir: "prev" | "next") {
  const sib = dir === "prev" ? el.previousElementSibling : el.nextElementSibling;
  return sib ? textOf(sib, 32) : "";
}

export function captureAnchor(el: Element, clientX: number, clientY: number): AnchorBundle {
  const rect = el.getBoundingClientRect();
  let css = "";
  try {
    css = finder(el, {
      className: (c) => !UNSTABLE_CLASS.test(c),
      idName: (id) => !UNSTABLE_ID.test(id),
      attr: (name) => name === "data-testid" || name === "data-pinwren-anchor" || name === "aria-label",
      timeoutMs: 300,
    });
  } catch {
    css = el.tagName.toLowerCase();
  }
  const pct = (v: number, size: number) => (size > 0 ? Math.min(100, Math.max(0, (v / size) * 100)) : 50);
  const attrs = {
    pinwrenAnchor: el.getAttribute("data-pinwren-anchor") ?? undefined,
    testId: el.getAttribute("data-testid") ?? undefined,
    id: el.id && !UNSTABLE_ID.test(el.id) ? el.id : undefined,
    ariaLabel: el.getAttribute("aria-label") ?? undefined,
    name: el.getAttribute("name") ?? undefined,
  };
  return {
    v: 1,
    attrs,
    css: css.slice(0, 2000),
    xpath: xpathOf(el).slice(0, 2000),
    text: { content: textOf(el), prefix: siblingText(el, "prev"), suffix: siblingText(el, "next") },
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute("role") ?? undefined,
    structure: {
      depth: depth(el),
      siblingIndex: el.parentElement ? Array.from(el.parentElement.children).indexOf(el) : 0,
      childTagsHash: hash(Array.from(el.children, (c) => c.tagName).join(",")),
    },
    rect: {
      x: rect.left + scrollX,
      y: rect.top + scrollY,
      w: rect.width,
      h: rect.height,
      vw: innerWidth,
      vh: innerHeight,
      scrollY,
    },
    pin: { xPct: pct(clientX - rect.left, rect.width), yPct: pct(clientY - rect.top, rect.height) },
  };
}

/** Dice coefficient on bigrams — cheap, order-tolerant text similarity in [0, 1]. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const n = grams.get(g) ?? 0;
    if (n > 0) {
      grams.set(g, n - 1);
      hits++;
    }
  }
  return (2 * hits) / (a.length + b.length - 2);
}

function byXPath(xpath: string): Element | null {
  try {
    const r = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return r.singleNodeValue as Element | null;
  } catch {
    return null;
  }
}

function safeQueryAll(selector: string): Element[] {
  try {
    return Array.from(document.querySelectorAll(selector));
  } catch {
    return [];
  }
}

export type Resolved = { element: Element; confidence: number } | null;

/**
 * Find the pinned element again. Strategies run from most to least reliable; text similarity
 * guards against a selector that now points at something else.
 */
export function resolveAnchor(a: AnchorBundle): Resolved {
  const text = a.text.content;
  const textOk = (el: Element) => !text || similarity(textOf(el), text) >= 0.6;

  const explicit = [
    a.attrs?.pinwrenAnchor && `[data-pinwren-anchor="${CSS.escape(a.attrs.pinwrenAnchor)}"]`,
    a.attrs?.testId && `[data-testid="${CSS.escape(a.attrs.testId)}"]`,
    a.attrs?.id && `#${CSS.escape(a.attrs.id)}`,
  ].filter(Boolean) as string[];
  for (const sel of explicit) {
    const found = safeQueryAll(sel);
    if (found.length === 1 && found[0]) return { element: found[0], confidence: 1 };
  }

  const byCss = safeQueryAll(a.css);
  if (byCss.length === 1 && byCss[0] && textOk(byCss[0])) return { element: byCss[0], confidence: 0.9 };

  const byPath = byXPath(a.xpath);
  if (byPath?.tagName.toLowerCase() === a.tag && textOk(byPath)) return { element: byPath, confidence: 0.8 };

  // Fuzzy search among elements of the same tag.
  if (!text) return null;
  let best: Resolved = null;
  for (const el of safeQueryAll(a.tag)) {
    if (el.closest("pinwren-root")) continue;
    const t = similarity(textOf(el), text);
    if (t < 0.4) continue;
    const prev = similarity(siblingText(el, "prev"), a.text.prefix);
    const next = similarity(siblingText(el, "next"), a.text.suffix);
    const r = el.getBoundingClientRect();
    const dist = Math.hypot(r.left + scrollX - a.rect.x, r.top + scrollY - a.rect.y);
    const geo = Math.max(0, 1 - dist / 2000);
    const score = 0.6 * t + 0.15 * prev + 0.15 * next + 0.1 * geo;
    if (score >= 0.65 && (!best || score > best.confidence)) best = { element: el, confidence: score };
  }
  return best;
}
