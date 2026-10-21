import { z } from "zod";

// Per-project widget and capture configuration (wave-1 contract §1). Every field has a default, so
// `widgetConfig.parse({})` is the complete default config and the stored JSON only holds what an
// admin changed. `.prefault({})` (not `.default`) runs the inner defaults for a missing object.

const hexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a hex colour like #5b5bd6");

export const LAUNCHER_POSITIONS = ["bottom-right", "bottom-left", "top-right", "top-left"] as const;
export const LAUNCHER_SHAPES = ["round", "pill"] as const;
export const LAUNCHER_ICONS = ["pin", "comment", "bug"] as const;
export const CONSOLE_CAPTURE_LEVELS = ["off", "errors", "warnings", "all"] as const;
export const NETWORK_CAPTURE_MODES = ["off", "failures"] as const;

export const widgetConfig = z.object({
  launcher: z
    .object({
      position: z.enum(LAUNCHER_POSITIONS).default("bottom-right"),
      offset: z
        .object({
          x: z.number().int().min(0).max(400).default(20),
          y: z.number().int().min(0).max(400).default(20),
        })
        .prefault({}),
      shape: z.enum(LAUNCHER_SHAPES).default("round"),
      label: z.string().trim().max(40).nullable().default("Feedback"),
      icon: z.enum(LAUNCHER_ICONS).default("pin"),
      accent: hexColor.default("#5b5bd6"),
      tooltip: z.string().trim().max(80).nullable().default("Give feedback"),
      hidden: z.boolean().default(false),
    })
    .prefault({}),
  modes: z.object({ comment: z.boolean().default(true), bug: z.boolean().default(true) }).prefault({}),
  shortcuts: z.boolean().default(true),
  rightClickComment: z.boolean().default(false),
  readOnly: z.boolean().default(false),
  visitorsCanResolve: z.boolean().default(true),
  consent: z
    .object({
      enabled: z.boolean().default(false),
      text: z.string().trim().max(1000).nullable().default(null),
      privacyUrl: z
        .url({ protocol: /^https?$/ })
        .max(2000)
        .nullable()
        .default(null),
    })
    .prefault({}),
});
export type WidgetConfig = z.infer<typeof widgetConfig>;
/** What the dashboard may send: any subset, merged into the stored config. */
export type WidgetConfigInput = z.input<typeof widgetConfig>;

export const captureConfig = z.object({
  console: z.enum(CONSOLE_CAPTURE_LEVELS).default("warnings"),
  network: z.enum(NETWORK_CAPTURE_MODES).default("failures"),
  screenshotOnComment: z.boolean().default(false),
  maskSelectors: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
});
export type CaptureConfig = z.infer<typeof captureConfig>;
export type CaptureConfigInput = z.input<typeof captureConfig>;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Deep-merge `patch` onto `base`: objects merge key by key, everything else (arrays, null,
 * primitives) replaces. Used to apply a partial dashboard update to the stored config.
 */
export function mergeConfig(base: unknown, patch: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = isPlainObject(base) ? { ...base } : {};
  if (!isPlainObject(patch)) return out;
  for (const [k, v] of Object.entries(patch)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? mergeConfig(out[k], v) : v;
  }
  return out;
}

/**
 * Parse a stored config leniently: valid fields are kept, anything invalid or unknown falls back to
 * its default. Stored JSON predates schema changes, and a bad value must never break the widget.
 */
function lenientParse<S extends z.ZodObject>(schema: S, stored: unknown): z.infer<S> {
  const full = schema.safeParse(isPlainObject(stored) ? stored : {});
  if (full.success) return full.data;
  const kept: Record<string, unknown> = {};
  const shape = schema.shape as Record<string, z.ZodType>;
  for (const [key, field] of Object.entries(shape)) {
    const value = isPlainObject(stored) ? stored[key] : undefined;
    if (value === undefined) continue;
    if (field.safeParse(value).success) {
      kept[key] = value;
      continue;
    }
    // One level down: keep the valid leaves of a partly-broken nested object.
    const inner = unwrapObject(field);
    if (inner && isPlainObject(value)) kept[key] = lenientParse(inner, value);
  }
  return schema.parse(kept);
}

function unwrapObject(t: z.ZodType): z.ZodObject | null {
  let cur: unknown = t;
  for (let i = 0; i < 4 && cur; i++) {
    if (cur instanceof z.ZodObject) return cur;
    const def = (cur as { def?: { innerType?: unknown } }).def;
    cur = def?.innerType;
  }
  return null;
}

/** The project's stored widget JSON → a complete config with defaults filled in. Never throws. */
export function parseWidgetConfig(stored: unknown): WidgetConfig {
  return lenientParse(widgetConfig, stored);
}

/** The project's stored capture JSON → a complete config with defaults filled in. Never throws. */
export function parseCaptureConfig(stored: unknown): CaptureConfig {
  return lenientParse(captureConfig, stored);
}
