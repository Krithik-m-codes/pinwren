// Comment on a text selection (blueprint 05 §4–§5): the anchor element is the selection's common ancestor and
// `textRange` holds character offsets into that element's text plus the quoted text (≤ 500 chars), so the
// quote can be found and highlighted again as long as the text still matches.

export type TextRange = { startOffset: number; endOffset: number; quote: string };

export const MAX_QUOTE = 500;

/** Characters of `root`'s text that come before the boundary point (node, offset). */
export function textOffset(root: Node, node: Node, offset: number): number {
  const r = document.createRange();
  r.setStart(root, 0);
  r.setEnd(node, offset);
  return r.toString().length;
}

export function toTextRange(root: Element, range: Range): TextRange {
  const startOffset = textOffset(root, range.startContainer, range.startOffset);
  const endOffset = textOffset(root, range.endContainer, range.endOffset);
  return { startOffset, endOffset, quote: range.toString().slice(0, MAX_QUOTE) };
}

/**
 * Where the quote is in `text` now: at the stored offsets if it's still there, otherwise its occurrence
 * nearest to them (the text around it changed); null when the quote is gone.
 */
export function locateQuote(text: string, tr: TextRange): [number, number] | null {
  const { quote, startOffset } = tr;
  const len = Math.max(tr.endOffset - startOffset, quote.length);
  if (!quote.trim() || len <= 0) return null;
  const clamp = (end: number) => Math.min(text.length, end);
  if (text.startsWith(quote, startOffset)) return [startOffset, clamp(startOffset + len)];
  let best = -1;
  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) {
    if (best < 0 || Math.abs(at - startOffset) < Math.abs(best - startOffset)) best = at;
  }
  return best < 0 ? null : [best, clamp(best + len)];
}

/** A live Range over characters [start, end) of `root`'s text, or null when the offsets don't fit. */
export function rangeAt(root: Element, start: number, end: number): Range | null {
  if (start < 0 || end <= start) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const r = document.createRange();
  let pos = 0;
  let started = false;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = (n as Text).data.length;
    if (!started && start < pos + len) {
      r.setStart(n, start - pos);
      started = true;
    }
    if (started && end <= pos + len) {
      r.setEnd(n, end - pos);
      return r;
    }
    pos += len;
  }
  return null;
}

/** Re-find a stored text range inside its (re-attached) anchor element. */
export function findQuote(root: Element, tr: TextRange): Range | null {
  const at = locateQuote(root.textContent, tr);
  return at ? rangeAt(root, at[0], at[1]) : null;
}

/**
 * Screen rectangles of the *text* in a range. `Range.getClientRects()` also returns the border boxes of
 * elements wholly inside the range, which would paint whole paragraphs as one block.
 */
export function textRects(range: Range, max = 200): DOMRect[] {
  const root = range.commonAncestorContainer;
  if (root.nodeType === Node.TEXT_NODE) return Array.from(range.getClientRects()).filter(visible);
  const out: DOMRect[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n && out.length < max; n = walker.nextNode()) {
    if (!range.intersectsNode(n)) continue;
    const r = document.createRange();
    r.selectNodeContents(n);
    if (n === range.startContainer) r.setStart(n, range.startOffset);
    if (n === range.endContainer) r.setEnd(n, range.endOffset);
    for (const rect of r.getClientRects()) if (visible(rect)) out.push(rect);
  }
  return out;
}

const visible = (r: DOMRect) => r.width > 0.5 && r.height > 0.5;

/** The page's current text selection, if it is something worth commenting on (not in our UI or a field). */
export function pageSelection(
  host: Element,
  editable: (el: Element) => boolean,
): { range: Range; el: Element } | null {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!range.toString().trim()) return null;
  const node = range.commonAncestorContainer;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!el || el === host || host.contains(el) || el === document.documentElement || editable(el)) return null;
  return { range: range.cloneRange(), el };
}
