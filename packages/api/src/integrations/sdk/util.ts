import { type NewIssue, TrackerError } from "./types";

// Small helpers shared by adapters and the code around them.

/** `ENG-12` → 12. */
export function keyNumber(key: unknown): number | null {
  if (typeof key !== "string") return null;
  const m = /^[A-Za-z][A-Za-z0-9_]*-(\d+)$/.exec(key);
  return m?.[1] ? Number(m[1]) : null;
}

/** A Linear / Jira issue's key from the team / project key and its number. */
export const issueKey = (cfg: { repo: string }, number: number) => `${cfg.repo}-${number}`;

/**
 * Escape untrusted text for GitHub/GitLab/Linear Markdown: HTML is entity-encoded, Markdown punctuation is
 * backslash-escaped, and `@` / `#` get a zero-width space so names can't mention people or link
 * other issues.
 */
export function mdEscape(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/([\\`*_{}[\]()+\-.!|~=])/g, "\\$1")
    .replace(/#/g, "#​")
    .replace(/@/g, "@​");
}

/** The first of `name` among `items` (case-insensitive), for matching configured names to a tracker's own. */
export const byName = <T extends { name: string }>(items: T[], name: string): T | undefined =>
  items.find((i) => i.name.toLowerCase() === name.toLowerCase());

/** Chunks of at most `n` characters (Notion limits a text run to 2000). */
export function chunkText(s: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out.length ? out : [""];
}

export const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** A tracker's item reference from its numeric id and web URL, refusing anything that isn't a real item. */
export function refFrom(n: unknown, url: unknown): { number: number; url: string } {
  const number = Number(n);
  if (!Number.isInteger(number) || number <= 0 || typeof url !== "string" || !/^https?:\/\//.test(url)) {
    throw new TrackerError("The tracker did not return an issue", null);
  }
  return { number, url };
}

/**
 * The issue as plain text for trackers that show a text field verbatim (Asana notes): the quoted words, the
 * facts and the dashboard link. Falls back to the Markdown body when no structured source was given.
 */
export function plainBody(issue: Pick<NewIssue, "body" | "source">): string {
  const s = issue.source;
  if (!s) return issue.body;
  return [
    s.quote
      .split(/\r?\n/)
      .map((l) => `> ${l}`)
      .join("\n"),
    "",
    ...s.facts.map(([k, v]) => `${k}: ${v}`),
    "",
    `Open #${s.number} in ${s.productName}: ${s.link} (sign-in required)`,
    "",
    `Created by ${s.productName}. Completing or reopening this task updates the item.`,
  ].join("\n");
}
