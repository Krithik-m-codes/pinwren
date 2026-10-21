// A deliberately small Markdown renderer for admin-edited email templates (F-020). It is safe by
// construction: the whole source is HTML-escaped first, so the only tags in the output are the ones
// this file writes. `{{variable}}` values are inserted *after* Markdown is parsed, escaped, so a
// reporter called `**<script>**` renders literally and can never add formatting, links or markup.
//
// Supported: # / ## / ### headings, paragraphs (single newlines → <br>), > quotes, - / * lists,
// **bold**, *italic* / _italic_, `code`, [text](url) with http(s)/mailto targets.

/** Template variables are strings and numbers; anything else is shown as JSON rather than "[object Object]". */
function text(s: unknown): string {
  if (s === null || s === undefined) return "";
  if (typeof s === "string") return s;
  if (typeof s === "number" || typeof s === "boolean" || typeof s === "bigint") return s.toString();
  if (typeof s !== "object") return ""; // functions and symbols never reach a template
  try {
    return JSON.stringify(s);
  } catch {
    return ""; // circular
  }
}

export function esc(s: unknown): string {
  return text(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const unesc = (s: string) =>
  s
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");

/** Only http(s) and mailto links survive; anything else (javascript:, data:) renders as text. */
export function safeHref(u: string): string | null {
  const t = u.trim();
  if (/^mailto:[^\s<>"]+@[^\s<>"]+$/i.test(t)) return t;
  try {
    const url = new URL(t);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export const VARIABLE = /\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g;

/** Variable names used in a template string. */
export function variablesIn(s: string): string[] {
  return [...new Set([...s.matchAll(VARIABLE)].flatMap((m) => (m[1] ? [m[1]] : [])))];
}

// Private-use characters never appear in escaped template text, so they mark slots safely:
// U+E000/U+E001 around a variable index, U+E002/U+E003 around a parked link.
const SLOT = /(\d+)/g;
const LINK_SLOT = /(\d+)/g;
const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

export type Styles = { accent: string };

function emphasis(s: string): string {
  return s
    .replace(/`([^`\n]+)`/g, '<code style="font-family:ui-monospace,monospace;font-size:13px">$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>");
}

/** Plain-text form of inline Markdown: links become "text (url)", emphasis markers go. */
function plain(s: string): string {
  return s
    .replace(LINK, "$1 ($2)")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1");
}

/** Markdown + variables → { html, text }. Unknown variables render as empty. */
export function renderMarkdown(
  source: string,
  vars: Record<string, string>,
  styles: Styles,
): { html: string; text: string } {
  const values: string[] = [];
  const slotted = source.replace(/\r\n?/g, "\n").replace(VARIABLE, (_m, name: string) => {
    values.push(vars[name] ?? "");
    return `${values.length - 1}`;
  });
  // Single-pass replacements: an inserted value is never scanned again, so a value that happens to
  // contain marker characters can't pull in another value or markup.
  const raw = (s: string) => s.replace(SLOT, (_m, i: string) => values[Number(i)] ?? "");
  const fill = (s: string) =>
    s.replace(SLOT, (_m, i: string) => esc(values[Number(i)] ?? "").replaceAll("\n", "<br>"));
  const rawText = (escaped: string) => raw(unesc(escaped));

  const inline = (escaped: string): string => {
    // Links first, parked behind markers so emphasis rules never touch an href. The href is resolved
    // from the raw template text plus raw variable values, then validated and escaped once.
    const links: string[] = [];
    const parked = escaped.replace(LINK, (_m, text: string, href: string) => {
      const url = safeHref(rawText(href));
      links.push(
        url
          ? `<a href="${esc(url)}" style="color:${styles.accent}">${emphasis(text)}</a>`
          : `${emphasis(text)} (${esc(rawText(href))})`,
      );
      return `${links.length - 1}`;
    });
    return fill(emphasis(parked).replace(LINK_SLOT, (_m, i: string) => links[Number(i)] ?? ""));
  };

  const blocks = esc(slotted)
    .split(/\n{2,}/)
    .map((b) => b.replace(/^\n+|\n+$/g, ""))
    .filter((b) => b.trim());
  const html: string[] = [];
  const text: string[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const heading = /^(#{1,3})\s+(.*)$/.exec(block);
    if (heading && lines.length === 1) {
      const level = heading[1]?.length ?? 1;
      const size = level === 1 ? 18 : level === 2 ? 16 : 15;
      html.push(
        `<h${level} style="font-size:${size}px;margin:0 0 16px">${inline(heading[2] ?? "")}</h${level}>`,
      );
      text.push(plain(rawText(heading[2] ?? "")));
    } else if (lines.every((l) => l.startsWith("&gt;"))) {
      const quoted = lines.map((l) => l.replace(/^&gt;\s?/, ""));
      html.push(
        `<blockquote style="margin:0 0 16px;padding:8px 12px;border-left:3px solid ${styles.accent};background:#f6f6f9;font-size:14px;line-height:1.5">${inline(quoted.join("<br>"))}</blockquote>`,
      );
      text.push(plain(rawText(quoted.join("\n"))));
    } else if (lines.every((l) => /^[-*]\s+/.test(l))) {
      const items = lines.map((l) => l.replace(/^[-*]\s+/, ""));
      html.push(
        `<ul style="margin:0 0 12px;padding-left:20px;font-size:14px;line-height:1.5">${items.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`,
      );
      text.push(items.map((i) => `• ${plain(rawText(i))}`).join("\n"));
    } else {
      html.push(
        `<p style="font-size:14px;line-height:1.5;margin:0 0 12px">${inline(lines.join("<br>"))}</p>`,
      );
      text.push(plain(rawText(lines.join("\n"))));
    }
  }
  return { html: html.join("\n"), text: text.join("\n\n") };
}

/** Fill variables in a subject line: raw values, no line breaks, bounded length. */
export function renderSubject(source: string, vars: Record<string, string>): string {
  const one = source
    .replace(VARIABLE, (_m, name: string) => vars[name] ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return one.length > 150 ? `${one.slice(0, 149)}…` : one;
}
