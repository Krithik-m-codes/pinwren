// Widget configuration as served by `GET /w/config` (docs/contracts/wave-1.md §1).
// `@annota/core` does not export `widgetConfig` yet, so the type and its defaults are mirrored here;
// the server fills defaults too, but the widget must never trust that every key is present.

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
};

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
  return c;
}

// `capture` block of `GET /w/config` (contract §1, `captureConfig` in @annota/core).
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
