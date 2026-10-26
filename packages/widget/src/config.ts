// Widget configuration as served by `GET /w/config` (docs/contracts/wave-1.md §1, wave-3.md §1–§3,
// wave-4.md §3–§4). The type and its defaults are mirrored here rather than imported from `@pinwren/core`
// (which doesn't export the newer fields yet): the server fills defaults too, but the widget must never trust
// that every key is present or valid — this file is the last line of defence before values reach the DOM.
import type { WidgetFeedbackCreate } from "@pinwren/core";

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
  /**
   * F-012 (wave-4 §4, wave-5 §2): where and for whom the widget shows. Widget-side only; `forceShow` overrides
   * every rule, a valid review link (`?pinwren_review=`) overrides `mode`.
   */
  visibility: {
    environments: "all" | "non-production";
    minViewportWidth: number;
    mode: VisibilityMode;
    urlPatterns: string[];
    queryParam: string;
  };
};

export type VisibilityMode = "always" | "identified" | "queryParam" | "urlPatterns" | "manual";
export const VISIBILITY_MODES: readonly VisibilityMode[] = [
  "always",
  "identified",
  "queryParam",
  "urlPatterns",
  "manual",
];

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
    accent: "#d63a1c",
    tooltip: "Give feedback",
    hidden: false,
  },
  modes: { comment: true, bug: true },
  shortcuts: true,
  rightClickComment: false,
  readOnly: false,
  visitorsCanResolve: false,
  consent: { enabled: false, text: null, privacyUrl: null },
  panelActions: [],
  privacyMode: false,
  visibility: {
    environments: "all",
    minViewportWidth: 0,
    mode: "always",
    urlPatterns: [],
    queryParam: "pinwren",
  },
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
  if (!["round", "pill"].includes(l.shape)) l.shape = "round";
  if (!["pin", "comment", "bug"].includes(l.icon)) l.icon = "pin";
  if (accentOverride && HEX.test(accentOverride)) l.accent = accentOverride;
  // The accent goes into a CSS custom property; only plain hex colours are accepted.
  if (!HEX.test(l.accent)) l.accent = DEFAULT_CONFIG.launcher.accent;
  const clampOff = (n: number) => (Number.isFinite(n) ? Math.min(400, Math.max(0, n)) : 20);
  l.offset = { x: clampOff(l.offset.x), y: clampOff(l.offset.y) };
  c.panelActions = sanitizeActions(c.panelActions);
  const v = c.visibility;
  if (v.environments !== "non-production") v.environments = "all";
  v.minViewportWidth = Number.isFinite(v.minViewportWidth)
    ? Math.min(10_000, Math.max(0, Math.round(v.minViewportWidth)))
    : 0;
  if (!VISIBILITY_MODES.includes(v.mode)) v.mode = "always";
  // `merge` keeps any object for an array default: only a real list of short strings counts.
  v.urlPatterns = Array.isArray(v.urlPatterns)
    ? v.urlPatterns
        .filter((x): x is string => typeof x === "string" && !!x.trim() && x.length <= 500)
        .slice(0, 50)
    : [];
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(v.queryParam)) v.queryParam = "pinwren";
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
  } catch {
    // not a URL — no logo
  }
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
  /** Screenshot sharpness: `high` keeps full detail, `low` is small and fast (the reporter can pick `low`). */
  quality: "high" | "standard" | "low";
  /** Offer the reporter a "Reduce capture quality" switch. */
  allowReduceQuality: boolean;
  /** F-007 session replay (wave-4 §3): off by default; a rolling buffer of the last `seconds`. */
  replay: { enabled: boolean; seconds: number };
  /** Take a masked screenshot of the visible area with every new comment (Page Review places it). */
  screenshotOnComment: boolean;
};

export function resolveCapture(raw: unknown): CaptureCfg {
  const c = isObj(raw) ? raw : {};
  const pick = <T extends string>(v: unknown, opts: readonly T[], def: T): T =>
    opts.includes(v as T) ? (v as T) : def;
  const masks = Array.isArray(c.maskSelectors) ? c.maskSelectors : [];
  return {
    console: pick(c.console, ["off", "errors", "warnings", "all"], "warnings"),
    network: pick(c.network, ["off", "failures"], "failures"),
    quality: pick(c.quality, ["high", "standard", "low"], "standard"),
    allowReduceQuality: c.allowReduceQuality !== false,
    // A selector that doesn't parse would make the whole capture throw — drop it here instead.
    maskSelectors: masks.filter((m): m is string => typeof m === "string" && validSelector(m)).slice(0, 50),
    replay: resolveReplay(c.replay),
    screenshotOnComment: c.screenshotOnComment === true,
  };
}

function resolveReplay(raw: unknown): CaptureCfg["replay"] {
  const r = isObj(raw) ? raw : {};
  const s = typeof r.seconds === "number" && Number.isFinite(r.seconds) ? Math.round(r.seconds) : 60;
  return { enabled: r.enabled === true, seconds: Math.min(120, Math.max(30, s)) };
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

// --- Wire additions not yet in @pinwren/core (wave-4 §3, §4, §6) ---------------------------------------

/** `replay` of `POST /w/feedback`: a gzip JSON array of rrweb events. */
export type ReplayPayload = { dataUrl: string; durationMs: number; events: number };
/** `consent` of `POST /w/feedback`: which notice the reporter accepted, and when. */
export type ConsentRecord = { version: string; acceptedAt: string };
/** `reporter` with a signed identity: `externalId` is the host app's user id, `signature` its HMAC. */
export type ReporterPayload = NonNullable<WidgetFeedbackCreate["reporter"]> & {
  signature?: string | undefined;
};

/**
 * Host-supplied context (`Pinwren.setMetadata`), sent with every report and comment. The server caps the whole
 * `metadata` object at 16 KB of JSON; the widget keeps the host's part under this, leaving room for timings.
 */
export const MAX_HOST_METADATA_BYTES = 14_000;

/** A plain JSON object within the cap, or null (with the reason) for anything else. */
export function hostMetadata(raw: unknown): { ok: Record<string, unknown> | null; error?: string } {
  if (raw === null || raw === undefined) return { ok: null };
  if (typeof raw !== "object" || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype)
    return { ok: null, error: "setMetadata takes a plain object (or null)" };
  let json: string;
  try {
    json = JSON.stringify(raw);
  } catch {
    return { ok: null, error: "setMetadata: the object can't be turned into JSON" };
  }
  if (json.length > MAX_HOST_METADATA_BYTES)
    return { ok: null, error: `setMetadata: keep it under ${MAX_HOST_METADATA_BYTES} bytes of JSON` };
  // A copy, so later changes by the host don't leak into reports already being written.
  return { ok: JSON.parse(json) as Record<string, unknown> };
}

/** The `metadata` to send: the host's fields plus the widget's own (which win on a clash), under 16 KB. */
export function mergeMetadata(
  host: Record<string, unknown> | null,
  own: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const out = { ...host, ...own };
  if (!Object.keys(out).length) return undefined;
  // Timings are the first thing to go when the host's part leaves no room for them.
  return JSON.stringify(out).length <= 16_384 ? out : (host ?? undefined);
}

export type FeedbackPayload = Omit<WidgetFeedbackCreate, "reporter"> & {
  reporter?: ReporterPayload | undefined;
  replay?: ReplayPayload | undefined;
  consent?: ConsentRecord | undefined;
};
