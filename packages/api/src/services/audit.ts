import {
  AUDIT_EXPORT_MAX_ROWS,
  type AuditAction,
  type AuditEntry,
  type AuditExportQuery,
  type AuditListQuery,
  type AuditListResponse,
  redactAuditData,
} from "@pinwren/core";
import { auditLog, getDb, user, withOrg } from "@pinwren/db";
import { and, desc, eq, getTableColumns, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { env } from "../env";
import { ApiError } from "../errors";
import { csvCell } from "../export/csv";
import { hasFeature } from "../license";
import { resolveClientIp } from "../net";

// Audit log (F-092, ADR 0044). `recordAudit` is called from the admin/security routes with one line each.
// It never throws into the caller (a log failure must not undo or block the change it describes), runs
// in the caller's organisation transaction (so a refused or failed request leaves no entry) and records
// only while the workspace is entitled: a downgrade doesn't retroactively expose history, and an
// upgrade doesn't invent any.

export type AuditInput = {
  orgId: string;
  actorId?: string | null;
  /** Shown when the actor can't be resolved (a system job); otherwise the name/email snapshot is taken. */
  actorLabel?: string;
  actorIp?: string | null;
  action: AuditAction;
  target?: { type: string; id?: string | null | undefined } | undefined;
  /** What changed, never a secret: keys that look like one are redacted before storing. */
  data?: Record<string, unknown> | undefined;
};

/** The slice of a Hono context the routes hand over (kept structural so any route's context fits). */
export type AuditContext = {
  var: { userId: string; orgId: string };
  req: { raw: Request };
};

async function actorSnapshot(actorId: string | null | undefined, fallback: string): Promise<string> {
  if (!actorId) return fallback;
  try {
    const [row] = await getDb()
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, actorId));
    return row ? `${row.name} <${row.email}>`.slice(0, 300) : actorId;
  } catch {
    return actorId;
  }
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await withOrg(input.orgId, async (db) => {
      if (!(await hasFeature("audit_log"))) return;
      const actorLabel = await actorSnapshot(input.actorId, input.actorLabel ?? "system");
      // A savepoint: a failing insert must not poison the surrounding request transaction.
      await db.transaction(async (tx) => {
        await tx.insert(auditLog).values({
          orgId: input.orgId,
          actorId: input.actorId ?? null,
          actorLabel,
          actorIp: input.actorIp ?? null,
          action: input.action,
          targetType: input.target?.type ?? null,
          targetId: input.target?.id ?? null,
          data: (redactAuditData(input.data ?? {}) ?? {}) as Record<string, unknown>,
          // clock_timestamp(): now() is the transaction's start, which would tie a whole request together.
          createdAt: sql`clock_timestamp()`,
        });
      });
    });
  } catch (err) {
    console.warn(`[pinwren] audit entry ${input.action} was not recorded`, err);
  }
}

/** `await audit(c, "member.removed", { type: "member", id }, { role })`: the signed-in admin did this. */
export function audit(
  c: AuditContext,
  action: AuditAction,
  target?: AuditInput["target"],
  data?: AuditInput["data"],
): Promise<void> {
  const ip = resolveClientIp(c.req.raw.headers, env().PINWREN_TRUST_PROXY);
  return recordAudit({
    orgId: c.var.orgId,
    actorId: c.var.userId,
    actorIp: ip === "unknown" ? null : ip,
    action,
    target,
    data,
  });
}

/** Both the list and the export refuse the same way when the plan or licence lacks the feature. */
export async function assertAuditEntitled(): Promise<void> {
  if (await hasFeature("audit_log")) return;
  throw new ApiError(
    403,
    "LICENSE_REQUIRED",
    "The audit log needs the Business plan (Cloud) or an Enterprise licence with the audit log feature",
  );
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
const CURSOR = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z)\|([0-9a-f-]{36})$/;
const US_ISO = sql<string>`to_char(${auditLog.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

function filters(orgId: string, q: Omit<AuditExportQuery, "format">): (SQL | undefined)[] {
  const where: (SQL | undefined)[] = [eq(auditLog.orgId, orgId)];
  if (q.actor) {
    const like = `%${likeEscape(q.actor)}%`;
    where.push(or(eq(auditLog.actorId, q.actor), ilike(auditLog.actorLabel, like)));
  }
  if (q.action) {
    if (q.action.endsWith(".")) where.push(sql`${auditLog.action} like ${`${likeEscape(q.action)}%`}`);
    else if (q.action.includes(".")) where.push(eq(auditLog.action, q.action));
    else
      where.push(
        or(eq(auditLog.action, q.action), sql`${auditLog.action} like ${`${likeEscape(q.action)}.%`}`),
      );
  }
  if (q.targetType) where.push(eq(auditLog.targetType, q.targetType));
  if (q.from) where.push(gte(auditLog.createdAt, new Date(q.from)));
  if (q.to) where.push(lte(auditLog.createdAt, new Date(q.to)));
  return where;
}

type Row = typeof auditLog.$inferSelect & { cursorTs: string };

const entry = ({ cursorTs: _c, ...r }: Row): AuditEntry => ({
  id: r.id,
  actorId: r.actorId,
  actorLabel: r.actorLabel,
  actorIp: r.actorIp,
  action: r.action,
  targetType: r.targetType,
  targetId: r.targetId,
  data: r.data,
  createdAt: r.createdAt.toISOString(),
});

async function page(
  orgId: string,
  q: Omit<AuditExportQuery, "format">,
  limit: number,
  cursor?: string,
): Promise<{ rows: Row[]; hasMore: boolean }> {
  const where = filters(orgId, q);
  if (cursor) {
    const m = CURSOR.exec(cursor);
    if (!m) throw new ApiError(400, "VALIDATION_ERROR", "Invalid cursor");
    where.push(sql`(${auditLog.createdAt}, ${auditLog.id}) < (${m[1]}::timestamptz, ${m[2]}::uuid)`);
  }
  const rows = (await getDb()
    .select({ ...getTableColumns(auditLog), cursorTs: US_ISO })
    .from(auditLog)
    .where(and(...where))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(limit + 1)) as Row[];
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
}

export async function listAudit(orgId: string, q: AuditListQuery): Promise<AuditListResponse> {
  await assertAuditEntitled();
  const { rows, hasMore } = await page(orgId, q, q.limit, q.cursor);
  const last = rows.at(-1);
  return { items: rows.map(entry), nextCursor: hasMore && last ? `${last.cursorTs}|${last.id}` : null };
}

const CSV_HEADER = ["time", "actor", "actor_id", "ip", "action", "target_type", "target_id", "data"];

/** Pure so the escaping (formula neutralising, quotes, newlines) is unit-tested without a database. */
export function auditCsv(items: readonly AuditEntry[]): string {
  const lines = [
    CSV_HEADER,
    ...items.map((e) => [
      e.createdAt,
      e.actorLabel,
      e.actorId,
      e.actorIp,
      e.action,
      e.targetType,
      e.targetId,
      JSON.stringify(e.data),
    ]),
  ];
  // BOM so Excel opens UTF-8 correctly; CRLF line ends per RFC 4180.
  return `\uFEFF${lines.map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export const auditJsonl = (items: readonly AuditEntry[]): string =>
  items.map((e) => JSON.stringify(e)).join("\n") + (items.length ? "\n" : "");

/** Newest first, at most AUDIT_EXPORT_MAX_ROWS (narrow the date range for more). */
export async function exportAudit(orgId: string, q: AuditExportQuery): Promise<Response> {
  await assertAuditEntitled();
  const items: AuditEntry[] = [];
  let cursor: string | undefined;
  while (items.length < AUDIT_EXPORT_MAX_ROWS) {
    const { rows, hasMore } = await page(
      orgId,
      q,
      Math.min(1000, AUDIT_EXPORT_MAX_ROWS - items.length),
      cursor,
    );
    items.push(...rows.map(entry));
    const last = rows.at(-1);
    if (!hasMore || !last) break;
    cursor = `${last.cursorTs}|${last.id}`;
  }
  const day = new Date().toISOString().slice(0, 10);
  return new Response(q.format === "csv" ? auditCsv(items) : auditJsonl(items), {
    headers: {
      "content-type": q.format === "csv" ? "text/csv; charset=utf-8" : "application/x-ndjson; charset=utf-8",
      "content-disposition": `attachment; filename="pinwren-audit-${day}.${q.format}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

/** Cloud keeps 30 days (ADR 0044); self-host never prunes. Called per organisation from the daily retention job. */
export async function pruneAudit(orgId: string, days: number, limit: number): Promise<number> {
  const db = getDb();
  const expired = and(
    eq(auditLog.orgId, orgId),
    sql`${auditLog.createdAt} < now() - make_interval(days => ${days})`,
  );
  const ids = db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(expired)
    .orderBy(auditLog.createdAt, auditLog.id)
    .limit(limit);
  return (
    await db
      .delete(auditLog)
      .where(and(eq(auditLog.orgId, orgId), sql`${auditLog.id} in (${ids})`))
      .returning({ id: auditLog.id })
  ).length;
}
