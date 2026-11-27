import { z } from "zod";

// Audit log (F-092, ADR 0044): an append-only record of who changed the workspace's configuration and
// access. Wire types for `GET /api/audit` and its export live here so the API and the dashboard agree.

/** Every action the server records, `<area>.<verb>`. The filter bar offers these; unknown ones still list. */
export const AUDIT_ACTIONS = [
  "member.invited",
  "member.created",
  "member.role_changed",
  "member.removed",
  "workspace.ownership_transferred",
  "api_token.created",
  "api_token.revoked",
  "integration.connected",
  "integration.updated",
  "integration.removed",
  "slack.connected",
  "slack.disconnected",
  "webhook.created",
  "webhook.updated",
  "webhook.removed",
  "project.created",
  "project.updated",
  "project.key_rotated",
  "project.exported",
  "license.installed",
  "license.removed",
  "branding.updated",
  "billing.checkout_started",
  "settings.sign_in_updated",
  "settings.email_updated",
  "settings.security_updated",
  "share_link.created",
  "share_link.revoked",
  "review_link.created",
  "review_link.revoked",
  "data.erased",
  "audit.exported",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Business keeps 30 days of history in Cloud; self-hosted Enterprise keeps everything (ADR 0044). */
export const AUDIT_CLOUD_RETENTION_DAYS = 30;
export const AUDIT_PAGE_SIZE = 50;
export const AUDIT_MAX_PAGE_SIZE = 200;
/** One export is bounded; narrow the date range for more. */
export const AUDIT_EXPORT_MAX_ROWS = 10_000;
export const AUDIT_EXPORT_FORMATS = ["csv", "jsonl"] as const;

const auditFilters = {
  /** Actor user id, or part of the actor's name/email snapshot. */
  actor: z.string().trim().min(1).max(200).optional(),
  /** Exact action, or an area prefix such as `member` / `member.`. */
  action: z
    .string()
    .trim()
    .max(64)
    .regex(/^[a-z_]+(\.[a-z_]*)?$/, "Use an action like member.removed, or just the area (member)")
    .optional(),
  targetType: z
    .string()
    .trim()
    .max(40)
    .regex(/^[a-z_]+$/)
    .optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
};

export const auditListQuery = z.object({
  ...auditFilters,
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(AUDIT_MAX_PAGE_SIZE).default(AUDIT_PAGE_SIZE),
});
export type AuditListQuery = z.infer<typeof auditListQuery>;

export const auditExportQuery = z.object({
  ...auditFilters,
  format: z.enum(AUDIT_EXPORT_FORMATS).default("csv"),
});
export type AuditExportQuery = z.infer<typeof auditExportQuery>;

export const auditEntry = z.object({
  id: z.uuid(),
  actorId: z.string().nullable(),
  actorLabel: z.string(),
  actorIp: z.string().nullable(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type AuditEntry = z.infer<typeof auditEntry>;

export const auditListResponse = z.object({
  items: z.array(auditEntry),
  nextCursor: z.string().nullable(),
});
export type AuditListResponse = z.infer<typeof auditListResponse>;

/** Keys whose values are never stored in `data`, whatever the caller passes (matched case-insensitively). */
export const AUDIT_SECRET_KEY =
  /pass(word|wd)?|secret|token|api[-_]?key|cookie|authorization|credential|private[-_]?key|signature|hash|otp|bearer/i;
export const AUDIT_REDACTED = "[redacted]";
const MAX_DEPTH = 4;
const MAX_STRING = 500;
const MAX_KEYS = 40;
const MAX_ITEMS = 40;

/**
 * Make `data` safe to store: secret-looking keys are replaced, long strings cut, depth and width capped.
 * Pure and total: it never throws (cycles stop at the depth cap).
 */
export function redactAuditData(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((v) => redactAuditData(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value).slice(0, MAX_KEYS)) {
      out[k] = AUDIT_SECRET_KEY.test(k) ? AUDIT_REDACTED : redactAuditData(v, depth + 1);
    }
    return out;
  }
  return undefined;
}
