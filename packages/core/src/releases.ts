import { z } from "zod";

// Releases and regressions (ADR 0036). A project records the versions it ships; a resolved item can say which
// release fixed it; a new report that looks like a resolved one is flagged as a possible regression. Everything
// here is pure so the API, the dashboard and the tests share one definition of "looks like".

// --- Releases ----------------------------------------------------------------------------------------------

export const MAX_RELEASE_VERSION = 100;
export const MAX_RELEASE_NOTES = 5000;
export const MAX_RELEASES_PER_PROJECT = 1000;

/**
 * A release label as CI tools write them: `1.4.0`, `v1.4.0-rc.1`, `2026.11.10`, a git SHA, `web@3.2.1`.
 * No spaces or control characters, so it can sit in a URL, an email subject and a chat message unescaped.
 */
export const releaseVersion = z
  .string()
  .trim()
  .min(1, "Enter a version")
  .max(MAX_RELEASE_VERSION)
  .regex(/^[\w][\w.+\-/@~]*$/, "Use letters, digits and . - _ + / @ ~ (no spaces)");

export const releaseCommit = z
  .string()
  .trim()
  .max(64)
  .regex(/^[A-Za-z0-9._/-]+$/, "Use the commit SHA or ref");

export const releaseCreate = z.object({
  version: releaseVersion,
  /** The commit (or ref) the release was built from. */
  commit: releaseCommit.nullable().optional(),
  /** When it went live; omitted = now. */
  deployedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  notes: z.string().trim().max(MAX_RELEASE_NOTES).nullable().optional(),
});
export type ReleaseCreate = z.infer<typeof releaseCreate>;

/** The version is the release's identity; everything else can be corrected. */
export const releaseUpdate = z.object({
  commit: releaseCommit.nullable().optional(),
  deployedAt: z.iso.datetime({ offset: true }).optional(),
  notes: z.string().trim().max(MAX_RELEASE_NOTES).nullable().optional(),
});
export type ReleaseUpdate = z.infer<typeof releaseUpdate>;

export const apiRelease = z
  .object({
    id: z.string(),
    projectId: z.string(),
    version: z.string(),
    commit: z.string().nullable(),
    notes: z.string().nullable(),
    deployedAt: z.string(),
    createdAt: z.string(),
    /** Items marked fixed in this release. */
    fixedCount: z.number().int(),
    /** Reports from this release flagged as regressions. */
    regressionCount: z.number().int(),
  })
  .loose();
export type ApiRelease = z.infer<typeof apiRelease>;

/** A project's regression switches (columns on the project). */
export const regressionSettings = z.object({
  /** Flag a new report that looks like a resolved one. On by default: it only adds a badge and a timeline row. */
  detectRegressions: z.boolean(),
  /** Reopen the resolved original when a regression is flagged. Off by default. */
  autoReopenRegressions: z.boolean(),
});
export type RegressionSettings = z.infer<typeof regressionSettings>;

/** The compact reference to a release shown on an item. */
export const releaseRef = z.object({ id: z.string(), version: z.string() });
export type ReleaseRef = z.infer<typeof releaseRef>;

// --- Version ordering --------------------------------------------------------------------------------------

type Parsed = { nums: number[]; pre: string[] };

/** `v1.4.0-rc.1+build5` → `{ nums: [1,4,0], pre: ["rc","1"] }`; null for anything that is not a dotted number. */
export function parseVersion(raw: string): Parsed | null {
  const m = /^[vV]?(\d{1,9}(?:\.\d{1,9}){0,3})(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(raw.trim());
  if (!m?.[1]) return null;
  return { nums: m[1].split(".").map(Number), pre: m[2] ? m[2].split(".") : [] };
}

function comparePre(a: string[], b: string[]): -1 | 0 | 1 {
  // No pre-release tag outranks any tag: 1.4.0 > 1.4.0-rc.1.
  if (!a.length || !b.length) return a.length === b.length ? 0 : a.length ? -1 : 1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1;
    } else if (xn !== yn) return xn ? -1 : 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Order two dotted versions; null when either is not one (a git SHA, a build name). */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const p = x.nums[i] ?? 0;
    const q = y.nums[i] ?? 0;
    if (p !== q) return p < q ? -1 : 1;
  }
  return comparePre(x.pre, y.pre);
}

/** A release as the comparison needs it: its label and, when it was recorded, when it went live. */
export type ReleasePoint = { version: string; at?: string | null | undefined };

/**
 * Whether release `a` is older (-1), the same as (0) or newer (1) than `b`. Dotted versions are compared
 * as numbers; any other label falls back to the time it was deployed; null when neither can say.
 */
export function compareReleases(a: ReleasePoint, b: ReleasePoint): -1 | 0 | 1 | null {
  if (a.version.toLowerCase() === b.version.toLowerCase()) return 0;
  const byVersion = compareVersions(a.version, b.version);
  if (byVersion !== null) return byVersion;
  if (a.at && b.at) {
    const x = Date.parse(a.at);
    const y = Date.parse(b.at);
    if (Number.isFinite(x) && Number.isFinite(y)) return x === y ? 0 : x < y ? -1 : 1;
  }
  return null;
}

/** The release label a report carries (`metadata.release`, set by `data-release` or `setMetadata`), cleaned. */
export function reportedRelease(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const v = (metadata as Record<string, unknown>).release;
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && releaseVersion.safeParse(t).success ? t : null;
}

// --- Regression signals ------------------------------------------------------------------------------------

/** 53-bit string hash (cyrb53): enough to compare messages, no crypto needed in the browser build. */
function hash53(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/** Console noise that says nothing about which bug it is. */
const NOISE = [
  /^script error\.?$/,
  /^resizeobserver loop/,
  /^failed to load resource/,
  /^(?:error|undefined|null|\[object object\])$/,
  /^non-error promise rejection/,
];

/**
 * The stable part of an error message: first line, with URLs, file positions, ids and numbers replaced, so the
 * same bug in two builds or two sessions produces the same text. Null for noise or something too short to mean
 * anything.
 */
export function normalizeErrorMessage(message: string): string | null {
  const first = message.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const text = first
    .replace(/^uncaught\s+(?:\(in promise\)\s*)?/i, "")
    .replace(/https?:\/\/\S+/gi, "<url>")
    .replace(/\S+\.(?:m?[jt]sx?|vue|svelte):\d+(?::\d+)?/gi, "<loc>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>")
    .replace(/\b[0-9a-f]{7,}\b/gi, "<hex>")
    .replace(/\d{3,}/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 200);
  if (text.length < 12 || NOISE.some((re) => re.test(text))) return null;
  return text;
}

/** The hash of a normalised error message, or null when it is noise. */
export function errorHash(message: string): string | null {
  const n = normalizeErrorMessage(message);
  return n ? hash53(n) : null;
}

export const MAX_ERROR_SIGNATURES = 6;

/**
 * Up to six distinct error hashes of a report: the error that opened it (`metadata.error`, from the widget's
 * error prompt) and the console errors it captured, newest first.
 */
export function errorHashesOf(consoleEntries: unknown, metadata: unknown): string[] {
  const out: string[] = [];
  const add = (message: unknown) => {
    if (typeof message !== "string") return;
    const h = errorHash(message);
    if (h && !out.includes(h)) out.push(h);
  };
  const meta = typeof metadata === "object" && metadata !== null ? (metadata as Record<string, unknown>) : {};
  const err = meta.error;
  if (typeof err === "object" && err !== null) add((err as Record<string, unknown>).message);
  const rows = Array.isArray(consoleEntries) ? (consoleEntries as unknown[]) : [];
  for (const row of rows.slice().reverse()) {
    if (typeof row === "object" && row !== null && (row as Record<string, unknown>).level === "error") {
      add((row as Record<string, unknown>).message);
    }
    if (out.length >= MAX_ERROR_SIGNATURES) break;
  }
  return out.slice(0, MAX_ERROR_SIGNATURES);
}

/** The path of a page URL, without query, fragment or a trailing slash, so `/pricing/` and `/pricing?x=1` agree. */
export function pagePathOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "") || "/";
    return path.slice(0, 300);
  } catch {
    return null;
  }
}

/**
 * What identifies the element a report is about: the host's own anchor attribute, then test id, then element id,
 * then the CSS selector. Null for a report without an anchor.
 */
export function anchorKeyOf(anchor: unknown): string | null {
  if (typeof anchor !== "object" || anchor === null) return null;
  const a = anchor as { attrs?: Record<string, unknown>; css?: unknown };
  const attrs = a.attrs ?? {};
  const pick = (k: string, tag: string) => {
    const v = attrs[k];
    return typeof v === "string" && v ? `${tag}:${v}` : null;
  };
  const key =
    pick("pinwrenAnchor", "pw") ??
    pick("testId", "tid") ??
    pick("id", "id") ??
    (typeof a.css === "string" && a.css ? `css:${a.css}` : null);
  return key ? key.slice(0, 300) : null;
}

/** What a report is compared on. Stored on the item (`sig_*` columns) when it is first looked at. */
export type RegressionSignature = {
  path: string | null;
  anchor: string | null;
  errors: string[];
};

export const REGRESSION_SIGNALS = ["error", "element", "release"] as const;
export type RegressionSignal = (typeof REGRESSION_SIGNALS)[number];

export const REGRESSION_CONFIDENCES = ["possible", "likely"] as const;
export type RegressionConfidence = (typeof REGRESSION_CONFIDENCES)[number];

/** Scores: an error seen before is the strongest sign; the same element on the same page is a close second. */
export const REGRESSION_SCORE = {
  error: 50,
  element: 40,
  both: 10,
  afterFix: 20,
  beforeFix: -40,
  flag: 40,
  likely: 70,
} as const;

export type RegressionMatch = {
  score: number;
  confidence: RegressionConfidence;
  signals: RegressionSignal[];
  /** Whether the report's release is at or after the release that fixed the original; null when unknown. */
  afterFix: boolean | null;
};

/**
 * How likely `fresh` is a regression of `old`, a resolved item. Needs a shared error, or the same element on
 * the same page, to flag anything; the release only moves the confidence: a report from the fixed release or
 * later is more likely a real regression, one from an earlier release is probably just a visitor on old code.
 * Returns null when nothing links them.
 */
export function scoreRegression(
  fresh: RegressionSignature,
  old: RegressionSignature,
  releases?: { reported: ReleasePoint | null; fixedIn: ReleasePoint | null },
): RegressionMatch | null {
  const error = fresh.errors.some((h) => old.errors.includes(h));
  const element = !!fresh.path && fresh.path === old.path && !!fresh.anchor && fresh.anchor === old.anchor;
  if (!error && !element) return null;
  let score = (error ? REGRESSION_SCORE.error : 0) + (element ? REGRESSION_SCORE.element : 0);
  if (error && element) score += REGRESSION_SCORE.both;
  const signals: RegressionSignal[] = [
    ...(error ? (["error"] as const) : []),
    ...(element ? (["element"] as const) : []),
  ];
  let afterFix: boolean | null = null;
  if (releases?.reported && releases.fixedIn) {
    const order = compareReleases(releases.reported, releases.fixedIn);
    if (order !== null) {
      afterFix = order >= 0;
      score += afterFix ? REGRESSION_SCORE.afterFix : REGRESSION_SCORE.beforeFix;
      if (afterFix) signals.push("release");
    }
  }
  score = Math.max(0, Math.min(100, score));
  if (score < REGRESSION_SCORE.flag) return null;
  return {
    score,
    confidence: score >= REGRESSION_SCORE.likely ? "likely" : "possible",
    signals,
    afterFix,
  };
}

/** What `feedback.regression_signals` holds. */
export const regressionSignalsData = z.object({
  signals: z.array(z.enum(REGRESSION_SIGNALS)),
  reportedRelease: z.string().nullable(),
  fixedInVersion: z.string().nullable(),
  afterFix: z.boolean().nullable(),
  score: z.number().int().min(0).max(100),
  /** `detector` for the report's own signals, `ai` when the AI duplicate check found the original. */
  source: z.enum(["detector", "ai"]).default("detector"),
});
export type RegressionSignalsData = z.infer<typeof regressionSignalsData>;
