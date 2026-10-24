import { h, ICONS, icon } from "./dom";
import { t } from "./i18n";
import type { Box } from "./region";

// Presentation helpers shared by markers, cards, the launcher and the panel.

/** A stroke icon in the widget's style (24×24, currentColor). */
const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

/** Icons the core needs beyond dom.ts's: kind chips, the speed dial, resolved markers. */
export const UI_ICONS = {
  question: svg(
    '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2.2-2.4 3.7M12 17h.01"/>',
  ),
  pencil: svg('<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  dots: svg('<path d="M5 12h.01M12 12h.01M19 12h.01"/>'),
  eyeOff: svg(
    '<path d="M3 3l18 18M10.6 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6A17.4 17.4 0 0 0 2 12s3.5 7 10 7a9.8 9.8 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  ),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
};

// SitePing's four types on Pinwren's kinds: Question, Change (idea), Bug, Other (comment).
const KIND_DEFS = {
  question: ["#0d74ce", "kindQuestion", UI_ICONS.question],
  idea: ["#c2410c", "kindIdea", UI_ICONS.pencil],
  bug: ["#d93036", "kindBug", ICONS.bug],
  comment: ["#64748b", "kindComment", UI_ICONS.dots],
} as const;
export type Kind = keyof typeof KIND_DEFS;
/** Composer and filter order. */
export const KIND_LIST = Object.keys(KIND_DEFS) as Kind[];

/** Colour, icon and translated label of a feedback kind (unknown kinds render as "Other"). */
export const kindOf = (k: string) => {
  const [color, key, glyph] = KIND_DEFS[(k in KIND_DEFS ? k : "comment") as Kind];
  return { color, label: t(key), icon: glyph };
};

export const tag = (kind: string) => {
  const k = kindOf(kind);
  return h("span", { class: "tag", style: `--k:${k.color}` }, k.label);
};

/**
 * The composer's type chips (a radio group). Nothing is picked at first; an unpicked comment is sent as
 * "Other". `onPick` runs after a choice (the composer moves focus back to the text).
 */
export function kindChips(initial: Kind | null, onPick: () => void) {
  let value: Kind | null = initial;
  const chips = KIND_LIST.map((k) => {
    const def = kindOf(k);
    return h(
      "button",
      {
        type: "button",
        role: "radio",
        "aria-checked": String(k === value),
        style: `--k:${def.color}`,
        onclick: () => {
          value = value === k ? null : k;
          for (const [i, c] of chips.entries())
            c.setAttribute("aria-checked", String(KIND_LIST[i] === value));
          onPick();
        },
      },
      icon(def.icon),
      def.label,
    );
  });
  const el = h("div", { class: "kinds", role: "radiogroup", "aria-label": t("type") }, ...chips);
  // Arrow keys move between the chips, as in any radio group.
  el.addEventListener("keydown", (e) => {
    const d = ["ArrowRight", "ArrowDown"].includes(e.key)
      ? 1
      : ["ArrowLeft", "ArrowUp"].includes(e.key)
        ? -1
        : 0;
    if (!d) return;
    e.preventDefault();
    const i = chips.indexOf(e.composedPath()[0] as HTMLButtonElement);
    chips[(i + d + chips.length) % chips.length]?.focus();
  });
  return { el, value: (): Kind => value ?? "comment", picked: () => value };
}

/** Grow a textarea with its text where `field-sizing: content` isn't supported (Firefox, older Safari). */
export function autosize(ta: HTMLTextAreaElement) {
  if (typeof CSS !== "undefined" && CSS.supports("field-sizing", "content")) return;
  const fit = () => {
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight + 2, 220)}px`;
  };
  ta.addEventListener("input", fit);
  requestAnimationFrame(fit);
}

export const CLOSED = ["resolved", "wont_fix", "duplicate"];
export const isClosed = (status: string) => CLOSED.includes(status);

// --- Markers ------------------------------------------------------------------------------------------

/** Marker diameter, px. */
export const MARKER = 26;

type MarkerPin = { kind: string; number: number; status: string };

/** A numbered marker, coloured by kind; resolved ones show a muted check (see `paintMarker`). */
export function markerEl(pin: MarkerPin): HTMLButtonElement {
  const el = h(
    "button",
    { class: "pin" },
    h("span", { class: "n" }),
    h("span", { class: "ok", "aria-hidden": "true" }, icon(UI_ICONS.check)),
  );
  paintMarker(el, pin);
  return el;
}

/** Bring a marker in line with its pin: number ("…" until the server numbers it), kind colour, resolved. */
export function paintMarker(el: HTMLElement, pin: MarkerPin) {
  el.style.setProperty("--c", kindOf(pin.kind).color);
  el.classList.toggle("resolved", isClosed(pin.status));
  const n = el.querySelector(".n");
  if (n) n.textContent = pin.number ? String(pin.number) : "…";
}

/** Where a marker's top-left goes for a pin at `b`: centred on the point, or on a region's top-right corner. */
export function markerSpot(b: Box): { left: number; top: number } {
  return { left: b.left + b.width - MARKER / 2, top: b.top - MARKER / 2 };
}

/** Whether this visitor left the markers on for this project (the speed dial's eye; kept in localStorage). */
export function markersShown(project: string): boolean {
  try {
    return localStorage.getItem(`pinwren:markers:${project}`) !== "hidden";
  } catch {
    return true;
  }
}

export function setMarkersShown(project: string, shown: boolean) {
  try {
    if (shown) localStorage.removeItem(`pinwren:markers:${project}`);
    else localStorage.setItem(`pinwren:markers:${project}`, "hidden");
  } catch {
    // private browsing or blocked storage: the choice lasts for this page view
  }
}

// --- People and time ----------------------------------------------------------------------------------

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
  const first = words[0] ?? "";
  return words.length > 1 ? `${first} ${words.at(-1)?.[0]?.toUpperCase() ?? ""}.` : first;
}

const AVATAR = [
  "#5b5bd6",
  "#0d74ce",
  "#12a594",
  "#30a46c",
  "#d6409f",
  "#8e4ec6",
  "#e54d2e",
  "#ad5700",
] as const;

export function colorFor(name: string | null | undefined): string {
  let n = 0;
  for (const c of name ?? "") n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR[n % AVATAR.length] ?? AVATAR[0];
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
