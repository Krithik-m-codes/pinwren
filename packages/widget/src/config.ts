// Widget configuration as served by `GET /w/config` (docs/contracts/wave-1.md §1, wave-3.md §1–§3).
// The type and its defaults are mirrored here rather than imported from `@pinwren/core` (which doesn't export
// the wave-3 fields yet): the server fills defaults too, but the widget must never trust that every key is
// present or valid — this file is the last line of defence before values reach the DOM.

export type LauncherPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left";

export type WidgetConfig = {
  launcher: {
    position: LauncherPosition;
    offset: { x: number; y: number };
    shape: "round" | "pill";
    label: string | null;
    icon: "pin" | "comment" | "bug";
    accent: string;
    tooltip: string | null;
    hidden: boolean;
  };
  modes: { comment: boolean; bug: boolean };
  shortcuts: boolean;
  rightClickComment: boolean;
  readOnly: boolean;
  visitorsCanResolve: boolean;
  consent: { enabled: boolean; text: string | null; privacyUrl: string | null };
  /** F-016: custom buttons in the thread card. The widget only ever renders `link` + `everyone`. */
  panelActions: PanelAction[];
  /** F-021: mask every text field in screenshots, no performance metadata, coarse user agent. */
  privacyMode: boolean;
};

export type PanelAction = {
  id: string;
  label: string;
  kind: "link" | "webhook";
  url: string;
  icon: "link" | "ticket" | "bot" | "external" | null;
  visibleTo: "everyone" | "team";
};

/** `branding` block of `GET /w/config` (wave-3 §2). */
export type Branding = { hidePoweredBy: boolean; dialogAccent: string | null; logoUrl: string | null };

export const DEFAULT_CONFIG: WidgetConfig = {
  launcher: {
    position: "bottom-right",
    offset: { x: 20, y: 20 },
    shape: "round",
    label: "Feedback",
    icon: "pin",
    accent: "#5b5bd6",
    tooltip: "Give feedback",
    hidden: false,
  },
  modes: { comment: true, bug: true },
  shortcuts: true,
  rightClickComment: false,
  readOnly: false,
  visitorsCanResolve: true,
  consent: { enabled: false, text: null, privacyUrl: null },
  panelActions: [],
  privacyMode: false,
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Deep-merge `raw` over `base`, keeping only keys `base` knows and values of the same JS type. */
function merge<T>(base: T, raw: unknown): T {
  if (!isObj(base)) return base;
  const src = isObj(raw) ? raw : {};
  const out: Obj = { ...base };
  for (const [k, def] of Object.entries(base)) {
    const v = src[k];
    // Nested objects are always re-created so callers can never mutate the shared defaults.
    if (isObj(def)) out[k] = merge(def, v);
    else if (v === undefined) continue;
    // Every string field is nullable or validated afterwards, so `null` is accepted where a string is.
    else if (def === null || typeof def === "string") {
      if (v === null || typeof v === "string") out[k] = v;
    } else if (typeof v === typeof def) out[k] = v;
  }
  return out as T;
}

const POSITIONS: LauncherPosition[] = ["bottom-right", "bottom-left", "top-right", "top-left"];
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function resolveConfig(raw: unknown, accentOverride?: string): WidgetConfig {
  const c = merge(DEFAULT_CONFIG, raw);
  const l = c.launcher;
  if (!POSITIONS.includes(l.position)) l.position = DEFAULT_CONFIG.launcher.position;
  if (l.shape !== "round" && l.shape !== "pill") l.shape = "round";
  if (!["pin", "comment", "bug"].includes(l.icon)) l.icon = "pin";
  if (accentOverride && HEX.test(accentOverride)) l.accent = accentOverride;
  // The accent goes into a CSS custom property; only plain hex colours are accepted.
  if (!HEX.test(l.accent)) l.accent = DEFAULT_CONFIG.launcher.accent;
  const clampOff = (n: number) => (Number.isFinite(n) ? Math.min(400, Math.max(0, n)) : 20);
  l.offset = { x: clampOff(l.offset.x), y: clampOff(l.offset.y) };
  c.panelActions = sanitizeActions(c.panelActions);
  return c;
}

const ACTION_ID = /^[a-z0-9-]{1,32}$/;
const ACTION_ICONS = ["link", "ticket", "bot", "external"] as const;

/** Keep at most 5 well-formed actions; anything malformed is dropped rather than half-rendered. */
export function sanitizeActions(raw: unknown): PanelAction[] {
  if (!Array.isArray(raw)) return [];
  const out: PanelAction[] = [];
  for (const a of raw) {
    if (!isObj(a) || typeof a.id !== "string" || !ACTION_ID.test(a.id)) continue;
    if (typeof a.label !== "string" || !a.label.trim() || typeof a.url !== "string") continue;
    if (a.kind !== "link" && a.kind !== "webhook") continue;
    if (!/^https?:\/\//i.test(a.url) || a.url.length > 2000) continue;
    out.push({
      id: a.id,
      label: a.label.trim().slice(0, 40),
      kind: a.kind,
      url: a.url,
      icon: ACTION_ICONS.includes(a.icon as never) ? (a.icon as PanelAction["icon"]) : null,
      visibleTo: a.visibleTo === "everyone" ? "everyone" : "team",
    });
    if (out.length === 5) break;
  }
  return out;
}

/**
 * Branding from the server. The accent becomes a CSS custom property (plain hex only) and the logo an <img
 * src>: only https URLs, or the Pinwren server's own `/api/assets/…` / `/api/brand-assets/…` (which may be
 * plain http on a development or LAN install).
 */
export function resolveBranding(raw: unknown, endpoint: string): Branding {
  const b = isObj(raw) ? raw : {};
  return {
    hidePoweredBy: b.hidePoweredBy === true,
    dialogAccent: typeof b.dialogAccent === "string" && HEX.test(b.dialogAccent) ? b.dialogAccent : null,
    logoUrl: safeLogoUrl(b.logoUrl, endpoint),
  };
}

export function safeLogoUrl(raw: unknown, endpoint: string): string | null {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 2000) return null;
  try {
    const base = new URL(endpoint);
    const u = new URL(raw.trim(), `${base.origin}/`);
    if (u.username || u.password) return null;
    if (u.protocol === "https:") return u.href;
    // The contract names /api/assets/; the server stores uploaded logos under /api/brand-assets/.
    if (u.origin === base.origin && /^\/api\/(brand-)?assets\//.test(u.pathname)) return u.href;
  } catch {}
  return null;
}

/** Black or white, whichever reads better on `hex` (WCAG relative luminance). */
export function readableOn(hex: string): "#ffffff" | "#18181b" {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.replace(/./g, "$&$&");
  const lin = (i: number) => {
    const c = Number.parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
  // Contrast against white vs. against near-black; prefer white on ties (brand buttons usually expect it).
  return 1.05 / (lum + 0.05) >= (lum + 0.05) / 0.06 ? "#ffffff" : "#18181b";
}

// `capture` block of `GET /w/config` (contract §1, `captureConfig` in @pinwren/core).
export type CaptureCfg = {
  console: "off" | "errors" | "warnings" | "all";
  network: "off" | "failures";
  maskSelectors: string[];
};

export function resolveCapture(raw: unknown): CaptureCfg {
  const c = isObj(raw) ? raw : {};
  const pick = <T extends string>(v: unknown, opts: readonly T[], def: T): T =>
    opts.includes(v as T) ? (v as T) : def;
  const masks = Array.isArray(c.maskSelectors) ? c.maskSelectors : [];
  return {
    console: pick(c.console, ["off", "errors", "warnings", "all"], "warnings"),
    network: pick(c.network, ["off", "failures"], "failures"),
    // A selector that doesn't parse would make the whole capture throw — drop it here instead.
    maskSelectors: masks.filter((m): m is string => typeof m === "string" && validSelector(m)).slice(0, 50),
  };
}

function validSelector(sel: string): boolean {
  if (!sel.trim() || sel.length > 200) return false;
  try {
    document.createDocumentFragment().querySelector(sel);
    return true;
  } catch {
    return false;
  }
}
