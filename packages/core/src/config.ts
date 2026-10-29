import { z } from "zod";

// Per-project widget and capture configuration (wave-1 contract §1). Every field has a default, so
// `widgetConfig.parse({})` is the complete default config and the stored JSON only holds what an
// admin changed. `.prefault({})` (not `.default`) runs the inner defaults for a missing object.

const hexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a hex colour like #d63a1c");

export const LAUNCHER_POSITIONS = ["bottom-right", "bottom-left", "top-right", "top-left"] as const;
export const LAUNCHER_SHAPES = ["round", "pill"] as const;
export const LAUNCHER_ICONS = ["pin", "comment", "bug"] as const;
export const CONSOLE_CAPTURE_LEVELS = ["off", "errors", "warnings", "all"] as const;
export const NETWORK_CAPTURE_MODES = ["off", "failures"] as const;
export const VISIBILITY_ENVIRONMENTS = ["all", "non-production"] as const;
export const VISIBILITY_MODES = ["always", "identified", "queryParam", "urlPatterns", "manual"] as const;
export type VisibilityMode = (typeof VISIBILITY_MODES)[number];
export const MIN_REPLAY_SECONDS = 30;
export const MAX_REPLAY_SECONDS = 120;

// --- Panel actions (F-016, wave-3 contract §1) -----------------------------------------------------

export const PANEL_ACTION_KINDS = ["link", "webhook"] as const;
export const PANEL_ACTION_ICONS = ["link", "ticket", "bot", "external"] as const;
export const PANEL_ACTION_VISIBILITY = ["everyone", "team"] as const;
export const PANEL_ACTION_PLACEHOLDERS = ["id", "number", "url", "projectSlug"] as const;
export const MAX_PANEL_ACTIONS = 5;
export type PanelActionPlaceholder = (typeof PANEL_ACTION_PLACEHOLDERS)[number];

const PLACEHOLDER = /\{([A-Za-z]+)\}/g;

/**
 * Action URLs: http(s) only, checked with the placeholders filled in. The scheme is fixed text in
 * the template, so no substituted value can turn a link into `javascript:`.
 */
const actionUrl = z
  .string()
  .trim()
  .max(2000)
  .superRefine((raw, ctx) => {
    if (!/^https?:\/\//i.test(raw)) {
      ctx.addIssue({ code: "custom", message: "Use an https:// or http:// URL" });
      return;
    }
    for (const m of raw.matchAll(PLACEHOLDER)) {
      if (!(PANEL_ACTION_PLACEHOLDERS as readonly string[]).includes(m[1] ?? "")) {
        ctx.addIssue({
          code: "custom",
          message: `Unknown placeholder {${m[1] ?? ""}} — use {id}, {number}, {url} or {projectSlug}`,
        });
        return;
      }
    }
    try {
      const u = new URL(raw.replace(PLACEHOLDER, "x"));
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("scheme");
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a full URL, like https://example.com/path" });
    }
  });

export const panelAction = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,32}$/, "Use 1–32 lowercase letters, digits or dashes"),
    label: z.string().trim().min(1, "Give the action a label").max(40),
    kind: z.enum(PANEL_ACTION_KINDS),
    url: actionUrl,
    icon: z.enum(PANEL_ACTION_ICONS).nullable().default(null),
    visibleTo: z.enum(PANEL_ACTION_VISIBILITY).default("everyone"),
  })
  .superRefine((a, ctx) => {
    if (a.kind === "webhook" && /\{[A-Za-z]+\}/.test(a.url)) {
      ctx.addIssue({ code: "custom", path: ["url"], message: "Webhook URLs are fixed — no placeholders" });
    }
  })
  // Webhooks run from the dashboard only in this wave: never offered to visitors.
  .transform((a) => (a.kind === "webhook" ? { ...a, visibleTo: "team" as const } : a));
export type PanelAction = z.infer<typeof panelAction>;

/**
 * Panel actions as one dashboard reader may see them (ADR 0021). A webhook action's URL is only for
 * org admins (who configure it): everyone else gets the action without its URL — running it needs only
 * the id. Viewers (read-only) don't see team-only actions at all, or webhook actions they can't run.
 */
export function panelActionsFor(
  actions: readonly PanelAction[],
  audience: "admin" | "member" | "viewer",
  where: "settings" | "detail",
): PanelAction[] {
  return actions
    .filter((a) => !(where === "detail" && audience === "viewer" && a.visibleTo === "team"))
    .map((a) => {
      if (a.kind === "webhook" && (audience !== "admin" || where === "detail")) return { ...a, url: "" };
      if (audience === "viewer" && a.visibleTo === "team") return { ...a, url: "" };
      return a;
    });
}

/**
 * Fill `{id}`, `{number}`, `{url}`, `{projectSlug}` in a link action, each value URL-encoded so it
 * can't break out of the query or path segment it sits in.
 */
export function substituteActionUrl(
  template: string,
  values: Partial<Record<PanelActionPlaceholder, string | number | null | undefined>>,
): string {
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    if (!(PANEL_ACTION_PLACEHOLDERS as readonly string[]).includes(name)) return whole;
    const v = values[name as PanelActionPlaceholder];
    return encodeURIComponent(v === null || v === undefined ? "" : String(v));
  });
}

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
      accent: hexColor.default("#d63a1c"),
      lightAccent: hexColor.nullable().default(null),
      darkAccent: hexColor.nullable().default(null),
      hoverEffect: z.boolean().default(true),
      tooltip: z.string().trim().max(80).nullable().default("Give feedback"),
      hidden: z.boolean().default(false),
    })
    .prefault({}),
  modes: z.object({ comment: z.boolean().default(true), bug: z.boolean().default(true) }).prefault({}),
  shortcuts: z.boolean().default(true),
  rightClickComment: z.boolean().default(false),
  readOnly: z.boolean().default(false),
  /**
   * Any visitor (not only the reporter, who holds a token) may resolve and reopen pins on the page. Off by
   * default since wave 5; projects created earlier were migrated with it on, as they behaved before.
   */
  visitorsCanResolve: z.boolean().default(false),
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
  /** F-016: custom buttons/links on a feedback's detail (widget thread card + dashboard). */
  panelActions: z
    .array(panelAction)
    .max(MAX_PANEL_ACTIONS, `At most ${MAX_PANEL_ACTIONS} actions`)
    .default([])
    .superRefine((list, ctx) => {
      const seen = new Set<string>();
      for (const [i, a] of list.entries()) {
        if (seen.has(a.id)) ctx.addIssue({ code: "custom", path: [i, "id"], message: "Ids must be unique" });
        seen.add(a.id);
      }
    }),
  /**
   * F-021 EU privacy mode: the server forces the consent notice on, caps console capture at errors,
   * truncates stored IPs and skips outbound update checks; the widget masks every input.
   */
  privacyMode: z.boolean().default(false),
  /**
   * Query parameters that don't identify a page on this site (session ids, A/B flags…), on top of the built-in
   * trackers (`IGNORED_QUERY_PARAMS`). A trailing `*` matches a prefix. Applied by the server when it groups
   * reports into pages (`normalizePageUrl`); existing pages are re-grouped on the next start.
   */
  ignoredQueryParams: z
    .array(
      z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9_.\-[\]]{1,63}\*?$/, "Use a parameter name, optionally ending in *"),
    )
    .max(30, "At most 30 parameters")
    .default([]),
  /**
   * Where the launcher shows (SitePing parity, wave-4 contract §4) — applied by the widget only.
   * "non-production" hides it on production hosts unless `forceShow` (`data-force-show` / init option).
   * Below `minViewportWidth` px the launcher stays hidden.
   *
   * `mode` (F-012, wave-5 contract §1) decides who gets the widget at all: `always`; `identified` (after
   * `Pinwren.identify`); `queryParam` (the page URL carries `?<queryParam>`, remembered for the session);
   * `urlPatterns` (the page path matches one of `urlPatterns`, same syntax as `urlPattern`); `manual`
   * (hidden until `Pinwren.show()`). A valid review link (`?pinwren_review=<token>`) shows it in every mode.
   */
  visibility: z
    .object({
      environments: z.enum(VISIBILITY_ENVIRONMENTS).default("all"),
      minViewportWidth: z.number().int().min(0).max(10_000).default(0),
      mode: z.enum(VISIBILITY_MODES).default("always"),
      urlPatterns: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
      queryParam: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9_.-]{1,64}$/, "Use letters, digits, dots, dashes or underscores")
        .default("pinwren"),
    })
    .prefault({}),
});
export type WidgetConfig = z.infer<typeof widgetConfig>;
/** What the dashboard may send: any subset, merged into the stored config. */
export type WidgetConfigInput = z.input<typeof widgetConfig>;

/** How sharp the screenshots a reporter sends are: `high` keeps full detail, `low` is small and fast. */
export const CAPTURE_QUALITIES = ["high", "standard", "low"] as const;
export type CaptureQuality = (typeof CAPTURE_QUALITIES)[number];

export const captureConfig = z.object({
  quality: z.enum(CAPTURE_QUALITIES).default("standard"),
  /** Show reporters a "Reduce capture quality" switch in the report form (it forces `low` for that report). */
  allowReduceQuality: z.boolean().default(true),
  console: z.enum(CONSOLE_CAPTURE_LEVELS).default("warnings"),
  network: z.enum(NETWORK_CAPTURE_MODES).default("failures"),
  screenshotOnComment: z.boolean().default(false),
  maskSelectors: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  /** F-007 session replay: the widget keeps a rolling rrweb buffer of the last `seconds`. */
  replay: z
    .object({
      enabled: z.boolean().default(false),
      seconds: z.number().int().min(MIN_REPLAY_SECONDS).max(MAX_REPLAY_SECONDS).default(60),
    })
    .prefault({}),
});
export type CaptureConfig = z.infer<typeof captureConfig>;
export type CaptureConfigInput = z.input<typeof captureConfig>;

// --- Widget branding (F-094, wave-3 contract §2) ------------------------------------------------------

export const widgetBranding = z.object({
  hidePoweredBy: z.boolean().default(false),
  /** Primary buttons in the widget's cards and modals; null = the launcher accent. */
  dialogAccent: hexColor.nullable().default(null),
  /** Shown in the report modal header: an https URL or this instance's /api/brand-assets/… URL. */
  logoUrl: z
    .url({ protocol: /^https?$/ })
    .max(2000)
    .nullable()
    .default(null),
});
export type WidgetBranding = z.infer<typeof widgetBranding>;
export type WidgetBrandingInput = z.input<typeof widgetBranding>;

const CONSOLE_RANK = { off: 0, errors: 1, warnings: 2, all: 3 } as const;

/**
 * What `/w/config` hands the widget: privacy mode forces consent on and caps console capture at
 * errors, and dashboard-only ("team") actions never leave the server — webhook URLs stay private.
 */
export function publicWidgetConfig(
  widget: WidgetConfig,
  capture: CaptureConfig,
): { widget: WidgetConfig; capture: CaptureConfig } {
  const w: WidgetConfig = {
    ...widget,
    panelActions: widget.panelActions.filter((a) => a.visibleTo === "everyone" && a.kind === "link"),
  };
  const c: CaptureConfig = { ...capture };
  if (widget.privacyMode) {
    w.consent = { ...w.consent, enabled: true };
    if (CONSOLE_RANK[c.console] > CONSOLE_RANK.errors) c.console = "errors";
  }
  return { widget: w, capture: c };
}

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

/** The project's stored widget branding JSON → complete, with defaults. Never throws. */
export function parseWidgetBranding(stored: unknown): WidgetBranding {
  return lenientParse(widgetBranding, stored);
}

/** The project's stored capture JSON → a complete config with defaults filled in. Never throws. */
export function parseCaptureConfig(stored: unknown): CaptureConfig {
  return lenientParse(captureConfig, stored);
}
