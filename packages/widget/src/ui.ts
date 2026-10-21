import { h, ICONS, icon } from "./dom";
import { type Key, t } from "./i18n";

// Presentation helpers shared by pins, cards and the panel.

const KIND_DEFS = {
  comment: ["#5b5bd6", "kindComment"],
  bug: ["#d93036", "kindBug"],
  idea: ["#b45309", "kindIdea"],
  question: ["#0d74ce", "kindQuestion"],
} as const;
export type Kind = keyof typeof KIND_DEFS;
export const KIND_LIST = Object.keys(KIND_DEFS) as Kind[];

/** Colour and translated label of a feedback kind (unknown kinds render as comments). */
export const kindOf = (k: string) => {
  const [color, key] = KIND_DEFS[(k in KIND_DEFS ? k : "comment") as Kind];
  return { color, label: t(key as Key) };
};

export const tag = (kind: string) => {
  const k = kindOf(kind);
  return h("span", { class: "tag", style: `--k:${k.color}` }, k.label);
};

export const CLOSED = ["resolved", "wont_fix", "duplicate"];
export const isClosed = (status: string) => CLOSED.includes(status);

export function initials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** "Sarah Miller" → "Sarah M." — the short form used on cards. */
export function shortName(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return t("visitor");
  return words.length > 1 ? `${words[0]} ${words[words.length - 1]?.[0]?.toUpperCase()}.` : (words[0] ?? "");
}

const AVATAR = ["#5b5bd6", "#0d74ce", "#12a594", "#30a46c", "#d6409f", "#8e4ec6", "#e54d2e", "#ad5700"];

export function colorFor(name: string | null | undefined): string {
  let n = 0;
  for (const c of name ?? "") n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR[n % AVATAR.length] as string;
}

export function ago(iso: string, now = Date.now()): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return t("justNow");
  if (s < 3600) return t("minutesAgo", { n: Math.floor(s / 60) });
  if (s < 86400) return t("hoursAgo", { n: Math.floor(s / 3600) });
  if (s < 604800) return t("daysAgo", { n: Math.floor(s / 86400) });
  return new Date(ms).toLocaleDateString();
}

/** Targets where a shortcut or right-click belongs to the page, not to us. */
export function isEditable(t: EventTarget | null): boolean {
  const el = t as Element | null;
  if (!el || typeof el.closest !== "function") return false;
  return (
    (el as HTMLElement).isContentEditable ||
    !!el.closest('input, textarea, select, a[href], [contenteditable]:not([contenteditable="false"])')
  );
}

export const avatar = (name: string | null | undefined) =>
  h(
    "span",
    { class: "av", style: `--c:${colorFor(name)}`, "aria-hidden": "true" },
    initials(name) || icon(ICONS.user),
  );
