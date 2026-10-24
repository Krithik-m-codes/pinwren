// Widget export (F-018, wave-3 §5): the comments listed in the panel, built client-side from the same
// `GET /w/feedback` data the widget already has. CSV is written for spreadsheets: UTF-8 BOM so Excel reads
// non-ASCII correctly, RFC 4180 quoting, CRLF rows, and cells that a spreadsheet would run as a formula
// (`= + - @`, tab, CR) prefixed with `'` (OWASP "CSV injection").

export type ExportPin = {
  id: string;
  number: number;
  kind: string;
  status: string;
  title?: string | null | undefined;
  body: string;
  reporterName: string | null;
  createdAt: string;
};

export type ExportRow = {
  number: number;
  kind: string;
  status: string;
  title: string;
  body: string;
  author: string;
  created: string;
  pageUrl: string;
  deepLink: string;
};

export const COLUMNS: [keyof ExportRow, string][] = [
  ["number", "Number"],
  ["kind", "Kind"],
  ["status", "Status"],
  ["title", "Title"],
  ["body", "Body"],
  ["author", "Author"],
  ["created", "Created"],
  ["pageUrl", "Page URL"],
  ["deepLink", "Deep link"],
];

/** Our own parameters: deep link, page-link token, review link. Never part of a page's address. */
const OWN_PARAMS = ["pinwren", "pwt", "pinwren_review"];

/** The page URL without our own `?pinwren=` / `pwt=` / `pinwren_review=` parameters (≤ 2000 characters). */
export function cleanPageUrl(href: string): string {
  try {
    const u = new URL(href);
    for (const k of OWN_PARAMS) u.searchParams.delete(k);
    return u.href.slice(0, 2000);
  } catch {
    return href;
  }
}

/** `<page url>?pinwren=<id>` — keeps the page's own query string and hash. */
export function deepLink(pageUrl: string, id: string): string {
  try {
    const u = new URL(pageUrl);
    u.searchParams.set("pinwren", id);
    return u.href;
  } catch {
    return pageUrl;
  }
}

export function toRows(pins: readonly ExportPin[], pageUrl: string): ExportRow[] {
  const page = cleanPageUrl(pageUrl);
  return pins.map((p) => ({
    number: p.number,
    kind: p.kind,
    status: p.status,
    title: p.title ?? "",
    body: p.body,
    author: p.reporterName ?? "",
    created: p.createdAt,
    pageUrl: page,
    deepLink: deepLink(page, p.id),
  }));
}

/** One CSV cell: formula-neutralised, then quoted when it contains a delimiter, quote or line break. */
export function csvCell(value: string | number): string {
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const BOM = "﻿";

export function toCsv(rows: readonly ExportRow[]): string {
  const lines = [COLUMNS.map(([, label]) => csvCell(label)).join(",")];
  for (const r of rows) lines.push(COLUMNS.map(([k]) => csvCell(r[k])).join(","));
  return `${BOM}${lines.join("\r\n")}\r\n`;
}

export function toJson(rows: readonly ExportRow[]): string {
  return `${JSON.stringify(rows, null, 2)}\n`;
}

/** `pinwren-<host>-<yyyy-mm-dd>.<ext>`, safe on every file system. */
export function fileName(pageUrl: string, ext: "csv" | "json", now = new Date()): string {
  let host = "page";
  try {
    host = new URL(pageUrl).hostname.replace(/[^a-z0-9.-]/gi, "") || "page";
  } catch {
    // not a URL — keep "page"
  }
  return `pinwren-${host}-${now.toISOString().slice(0, 10)}.${ext}`;
}

/** Hand the text to the browser as a download. `at` is where the temporary link lives (our shadow root). */
export function download(at: HTMLElement, name: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.hidden = true;
  at.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
