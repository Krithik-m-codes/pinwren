import { z } from "zod";
import { feedbackKind, feedbackStatus, priority } from "./schemas";

// Share links: a login-free, expiring, revocable, read-only view of one report or of a review round, and the
// client sign-off that can be left on a round. The token travels in a header (it lives in the URL fragment),
// never in a path or query, so it stays out of request logs and Referer headers.

export const SHARE_TOKEN_HEADER = "x-pinwren-share-token";
/** Proof that the password was entered (signed, short-lived), sent in place of the password itself. */
export const SHARE_UNLOCK_HEADER = "x-pinwren-share-unlock";
export const SHARE_TOKEN_RE = /^pws_[A-Za-z0-9_-]{20,64}$/;
export const SHARE_MAX_DAYS = 90;
export const SHARE_DEFAULT_DAYS = 7;

export const SIGNOFF_DECISIONS = ["approved", "changes_requested"] as const;
export const signoffDecision = z.enum(SIGNOFF_DECISIONS);
export type SignoffDecision = z.infer<typeof signoffDecision>;

/** Exactly one of `feedbackId` / `roundId`. */
export const shareLinkCreate = z
  .object({
    feedbackId: z.uuid().optional(),
    roundId: z.uuid().optional(),
    label: z.string().trim().max(120).default(""),
    expiresInDays: z.number().int().min(1).max(SHARE_MAX_DAYS).default(SHARE_DEFAULT_DAYS),
    /** Viewers may post public comments (only while the project accepts guest replies). */
    allowComments: z.boolean().default(false),
    password: z.string().min(4).max(128).optional(),
  })
  .strict()
  .refine((v) => (v.feedbackId === undefined) !== (v.roundId === undefined), {
    message: "Share either a report or a round",
    path: ["feedbackId"],
  });
export type ShareLinkCreate = z.infer<typeof shareLinkCreate>;

export const shareLinkOut = z.object({
  id: z.uuid(),
  kind: z.enum(["report", "round"]),
  feedbackId: z.string().nullable(),
  roundId: z.string().nullable(),
  label: z.string(),
  allowComments: z.boolean(),
  hasPassword: z.boolean(),
  expiresAt: z.string(),
  createdAt: z.string(),
  lastViewedAt: z.string().nullable(),
  viewCount: z.number().int().nonnegative(),
  revokedAt: z.string().nullable(),
  status: z.enum(["active", "expired", "revoked"]),
});
export type ShareLinkOut = z.infer<typeof shareLinkOut>;

export const shareLinkList = z.object({ links: z.array(shareLinkOut) });
export const shareLinkCreated = z.object({ link: shareLinkOut, url: z.string() });
export type ShareLinkCreated = z.infer<typeof shareLinkCreated>;

export const shareUnlock = z.object({ password: z.string().min(1).max(128) }).strict();
export const shareUnlocked = z.object({ unlock: z.string() });

export const shareComment = z.object({
  id: z.uuid(),
  body: z.string(),
  createdAt: z.string(),
  authorName: z.string().nullable(),
  team: z.boolean(),
});
export type ShareComment = z.infer<typeof shareComment>;

export const shareCommentCreate = z
  .object({
    body: z.string().trim().min(1).max(10_000),
    name: z.string().trim().min(1).max(80),
  })
  .strict();
export type ShareCommentCreate = z.infer<typeof shareCommentCreate>;

export const signoffCreate = z
  .object({
    decision: signoffDecision,
    name: z.string().trim().min(1).max(120),
    email: z.email().max(254),
    note: z.string().trim().max(5000).default(""),
  })
  .strict()
  .refine((v) => v.decision === "approved" || v.note.length > 0, {
    message: "Say what needs to change",
    path: ["note"],
  });
export type SignoffCreate = z.infer<typeof signoffCreate>;

/** Sign-off as the dashboard lists it. */
export const signoffOut = z.object({
  id: z.uuid(),
  decision: signoffDecision,
  name: z.string(),
  email: z.string(),
  note: z.string(),
  createdAt: z.string(),
});
export type SignoffOut = z.infer<typeof signoffOut>;

/** A round's sign-off state: the newest answer decides. */
export const SIGNOFF_STATES = ["none", "approved", "changes_requested"] as const;
export type SignoffState = (typeof SIGNOFF_STATES)[number];

export function signoffState(latest: { decision: SignoffDecision } | null | undefined): SignoffState {
  return latest ? latest.decision : "none";
}

export const roundSignoffs = z.object({
  state: z.enum(SIGNOFF_STATES),
  requireSignoff: z.boolean(),
  signoffs: z.array(signoffOut),
});
export type RoundSignoffs = z.infer<typeof roundSignoffs>;

const diagnosticsSummary = z.object({
  console: z.object({
    errors: z.number().int(),
    warnings: z.number().int(),
    total: z.number().int(),
    entries: z.array(z.object({ level: z.string(), message: z.string() })),
  }),
  network: z.object({
    total: z.number().int(),
    failed: z.number().int(),
    entries: z.array(
      z.object({
        method: z.string(),
        url: z.string(),
        status: z.number().int(),
        durationMs: z.number(),
      }),
    ),
  }),
});
export type DiagnosticsSummary = z.infer<typeof diagnosticsSummary>;

const shareHead = {
  project: z.object({ name: z.string(), key: z.string() }),
  branding: z.object({
    productName: z.string(),
    logoUrl: z.string().nullable(),
    accent: z.string().nullable(),
    hidePoweredBy: z.boolean(),
  }),
  link: z.object({
    label: z.string(),
    expiresAt: z.string(),
    /** Whether commenting is on for this link and the project accepts guest replies. */
    canComment: z.boolean(),
  }),
};

const shareAsset = z.object({ id: z.uuid(), kind: z.string(), contentType: z.string() });

export const shareReportResponse = z.object({
  kind: z.literal("report"),
  ...shareHead,
  report: z.object({
    id: z.uuid(),
    number: z.number().int(),
    kind: feedbackKind,
    status: feedbackStatus,
    priority,
    title: z.string().nullable(),
    body: z.string(),
    pageUrl: z.string().nullable(),
    browser: z.string().nullable(),
    os: z.string().nullable(),
    createdAt: z.string(),
    fixedInVersion: z.string().nullable().default(null),
    fixedInNextRelease: z.boolean().default(false),
    screenshot: shareAsset.nullable(),
    replay: shareAsset.nullable(),
    diagnostics: diagnosticsSummary,
  }),
  comments: z.array(shareComment),
});
export type ShareReportResponse = z.infer<typeof shareReportResponse>;

export const shareRoundResponse = z.object({
  kind: z.literal("round"),
  ...shareHead,
  round: z.object({
    id: z.uuid(),
    name: z.string(),
    status: z.enum(["active", "closed"]),
    dueAt: z.string().nullable(),
    counts: z.object({ total: z.number().int(), open: z.number().int(), closed: z.number().int() }),
    requireSignoff: z.boolean(),
  }),
  items: z.array(
    z.object({
      id: z.uuid(),
      number: z.number().int(),
      kind: feedbackKind,
      status: feedbackStatus,
      priority,
      title: z.string().nullable(),
      body: z.string(),
      pageUrl: z.string().nullable(),
      fixedInVersion: z.string().nullable().default(null),
      fixedInNextRelease: z.boolean().default(false),
    }),
  ),
  /** Newest first; the reviewers' addresses stay in the dashboard. */
  signoffs: z.array(signoffOut.omit({ email: true })),
  state: z.enum(SIGNOFF_STATES),
});
export type ShareRoundResponse = z.infer<typeof shareRoundResponse>;

export type ShareResponse = ShareReportResponse | ShareRoundResponse;

// --- PII masking -------------------------------------------------------------------------------------------

const MASKS: [RegExp, string][] = [
  [/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, "[email]"],
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g, "[token]"],
  [/\b(?:bearer|basic)\s+[\w.~+/=-]{8,}/gi, "[token]"],
  [/\b(?:\d[ -]?){13,19}\b/g, "[number]"],
  [/\+?\d[\d\s().-]{7,}\d/g, "[phone]"],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]"],
  [/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]"],
];

/**
 * Hide what a stranger holding a share link must not see in captured console output: addresses, tokens,
 * long opaque strings, phone and card-like numbers, IPv4 addresses. Over-masking is fine here.
 */
export function maskPii(text: string, max = 300): string {
  let out = text.length > max * 4 ? text.slice(0, max * 4) : text;
  for (const [re, to] of MASKS) out = out.replace(re, to);
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

/** A request URL without credentials, query string or fragment, and with opaque path segments masked. */
export function maskUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const path = u.pathname
      .split("/")
      .map((seg) => (/^[0-9a-f-]{24,}$/i.test(seg) || /^\d{6,}$/.test(seg) ? ":id" : seg))
      .join("/");
    return `${u.origin}${path}${u.search ? "?…" : ""}`;
  } catch {
    return maskPii(raw.split(/[?#]/)[0] ?? "", 200);
  }
}

const MAX_SHARED_ENTRIES = 20;

/**
 * The console / network section of a shared report: counts, plus the errors, warnings and failed requests
 * (capped), every string masked. Full captures stay in the dashboard.
 */
export function summarizeDiagnostics(
  d: { console?: unknown; network?: unknown } | null | undefined,
): DiagnosticsSummary {
  const list = (v: unknown) =>
    (Array.isArray(v) ? (v as unknown[]) : []).filter(
      (e): e is Record<string, unknown> => typeof e === "object" && e !== null,
    );
  const con = list(d?.console);
  const net = list(d?.network);
  const failed = net.filter((e) => typeof e.status === "number" && (e.status === 0 || e.status >= 400));
  return {
    console: {
      errors: con.filter((e) => e.level === "error").length,
      warnings: con.filter((e) => e.level === "warn").length,
      total: con.length,
      entries: con
        .filter((e) => e.level === "error" || e.level === "warn")
        .slice(0, MAX_SHARED_ENTRIES)
        .map((e) => ({
          level: String(e.level),
          message: maskPii(typeof e.message === "string" ? e.message : ""),
        })),
    },
    network: {
      total: net.length,
      failed: failed.length,
      entries: failed.slice(0, MAX_SHARED_ENTRIES).map((e) => ({
        method: typeof e.method === "string" ? e.method.slice(0, 10) : "GET",
        url: maskUrl(typeof e.url === "string" ? e.url : ""),
        status: Number(e.status),
        durationMs: typeof e.durationMs === "number" ? Math.round(e.durationMs) : 0,
      })),
    },
  };
}
