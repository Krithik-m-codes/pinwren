import type { EmailDeliveryStatus } from "@pinwren/core";
import { emailDelivery, getDb, withOrg } from "@pinwren/db";
import { identityDatabase } from "@pinwren/db/identity";
import { and, count, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { enqueue, QUEUES } from "../jobs/boss";
import { resolveSmtp } from "./config";
import { type EmailMessage, sendEmail } from "./send";

// The delivery log (wave-5 contract §3.2): every email the `notify.email` worker handles leaves one
// `email_delivery` row — sent, skipped (SMTP not set up, unsubscribed) or failed after its last retry — so
// an admin can see what went out and resend what didn't. Rows keep the whole message for the resend and
// are pruned after DELIVERY_RETENTION_DAYS by the daily retention job.

/** The `notify.email` queue's `retryLimit` (jobs/boss.ts): the attempt after this many retries is the last. */
export const EMAIL_RETRY_LIMIT = 4;
export const DELIVERY_RETENTION_DAYS = 30;
export const SKIPPED_NOT_CONFIGURED = "SMTP is not configured";
/** Set while a bulk resend waits in the queue, so a second click doesn't queue the same email twice. */
const QUEUED_FOR_RESEND = "Queued to send again";
const MAX_BULK_RESEND = 500;

export type DeliveryRow = {
  id: string;
  to: string;
  templateKey: string;
  subject: string;
  status: EmailDeliveryStatus;
  error: string | null;
  attempts: number;
  createdAt: string;
  sentAt: string | null;
};

/**
 * A short, stable category for an SMTP failure, then the server's own words: admins scan the category,
 * the detail says what to fix. Never includes credentials (nodemailer errors don't carry them).
 */
export function describeEmailError(err: unknown): string {
  const e = (err ?? {}) as { code?: unknown; responseCode?: unknown; message?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  const status = typeof e.responseCode === "number" ? e.responseCode : 0;
  const message = typeof e.message === "string" ? e.message : "Send failed";
  let category = "Send failed";
  if (code === "EAUTH" || status === 535 || status === 534) category = "Authentication failed";
  else if (/certificate|self[- ]signed|SSL|TLS/i.test(message) || code === "ETLS") category = "TLS problem";
  else if (code === "EDNS" || /ENOTFOUND|EAI_AGAIN/.test(message)) category = "Host not found";
  else if (["ECONNECTION", "ECONNREFUSED", "ETIMEDOUT", "ESOCKET", "ECONNRESET"].includes(code))
    category = "Connection failed";
  else if (code === "EENVELOPE" || (status >= 500 && status < 600)) category = "Rejected by the server";
  else if (status >= 400 && status < 500) category = "Temporarily refused";
  const detail = message.replace(/\s+/g, " ").trim().slice(0, 300);
  return detail && detail !== category ? `${category}: ${detail}` : category;
}

const payloadOf = (m: EmailMessage) => ({
  to: m.to,
  subject: m.subject,
  html: m.html,
  text: m.text,
  ...(m.headers ? { headers: m.headers } : {}),
  ...(m.suppressionOrgId ? { suppressionOrgId: m.suppressionOrgId } : {}),
});

async function record(
  m: EmailMessage,
  status: EmailDeliveryStatus,
  error: string | null,
  attempts: number,
): Promise<void> {
  const sentAt = status === "sent" ? new Date() : null;
  try {
    const persist = async (db: ReturnType<typeof getDb>) => {
      if (m.deliveryId) {
        await db
          .update(emailDelivery)
          .set({ status, error, sentAt, attempts: sql`${emailDelivery.attempts} + ${attempts}` })
          .where(eq(emailDelivery.id, m.deliveryId));
        return;
      }
      await db.insert(emailDelivery).values({
        orgId: m.orgId ?? m.suppressionOrgId ?? null,
        toAddress: m.to,
        templateKey: m.templateKey ?? "unknown",
        subject: m.subject,
        status,
        error,
        attempts,
        payload: payloadOf(m),
        sentAt,
      });
    };
    const orgId = m.orgId ?? m.suppressionOrgId;
    if (orgId) await withOrg(orgId, persist);
    else await persist(identityDatabase());
  } catch (err) {
    // The log is for people; a write failure must not resend (or lose) the email itself.
    console.warn("[pinwren] could not record an email delivery", err);
  }
}

/**
 * `notify.email` handler: send, then log the outcome. A failure is logged only on the last attempt
 * (`retryCount` = retries so far) and rethrown so pg-boss retries the earlier ones.
 */
export async function deliverEmail(m: EmailMessage, retryCount = 0): Promise<void> {
  let result: Awaited<ReturnType<typeof sendEmail>>;
  try {
    result = await sendEmail(m);
  } catch (err) {
    if (retryCount >= EMAIL_RETRY_LIMIT) await record(m, "failed", describeEmailError(err), retryCount + 1);
    throw err;
  }
  await record(m, result.sent ? "sent" : "skipped", result.sent ? null : result.reason, retryCount + 1);
}

const toRow = (r: typeof emailDelivery.$inferSelect): DeliveryRow => ({
  id: r.id,
  to: r.toAddress,
  templateKey: r.templateKey,
  subject: r.subject,
  status: r.status,
  error: r.error,
  attempts: r.attempts,
  createdAt: r.createdAt.toISOString(),
  sentAt: r.sentAt?.toISOString() ?? null,
});

const resendable = and(
  eq(emailDelivery.status, "skipped"),
  eq(emailDelivery.error, SKIPPED_NOT_CONFIGURED),
  gte(emailDelivery.createdAt, sql`now() - make_interval(days => ${DELIVERY_RETENTION_DAYS})`),
);

/** Newest first, without bodies. `skippedNotConfigured`: how many "Resend skipped" would queue. */
export async function listDeliveries(
  limit: number,
  status?: EmailDeliveryStatus,
): Promise<{ items: DeliveryRow[]; skippedNotConfigured: number }> {
  const db = getDb();
  const [rows, [skipped]] = await Promise.all([
    db
      .select()
      .from(emailDelivery)
      .where(status ? eq(emailDelivery.status, status) : undefined)
      .orderBy(desc(emailDelivery.createdAt))
      .limit(limit),
    db.select({ n: count() }).from(emailDelivery).where(resendable),
  ]);
  return { items: rows.map(toRow), skippedNotConfigured: skipped?.n ?? 0 };
}

export type ResendOutcome =
  | { ok: true; delivery: DeliveryRow }
  | { ok: false; code: "NOT_FOUND" | "UNSUBSCRIBED" | "EMAIL_NOT_CONFIGURED" };

/**
 * Send one logged email again, now, with the saved settings: the admin sees the outcome at once. An
 * address that unsubscribed stays unsubscribed (the suppression check runs again in `sendEmail`).
 */
export async function resendDelivery(id: string): Promise<ResendOutcome> {
  const db = getDb();
  const [row] = await db.select().from(emailDelivery).where(eq(emailDelivery.id, id));
  if (!row) return { ok: false, code: "NOT_FOUND" };
  if (row.status === "skipped" && row.error === "unsubscribed") return { ok: false, code: "UNSUBSCRIBED" };
  if (!(await resolveSmtp())) return { ok: false, code: "EMAIL_NOT_CONFIGURED" };
  const m: EmailMessage = { ...row.payload, deliveryId: row.id };
  let status: EmailDeliveryStatus = "sent";
  let error: string | null = null;
  try {
    const result = await sendEmail(m);
    if (!result.sent) {
      status = "skipped";
      error = result.reason;
    }
  } catch (err) {
    status = "failed";
    error = describeEmailError(err);
  }
  await record(m, status, error, 1);
  const [updated] = await db.select().from(emailDelivery).where(eq(emailDelivery.id, id));
  return updated ? { ok: true, delivery: toRow(updated) } : { ok: false, code: "NOT_FOUND" };
}

/** Queue every email skipped because SMTP wasn't set up (last 30 days, at most 500). */
export async function resendSkipped(): Promise<{ queued: number } | null> {
  if (!(await resolveSmtp())) return null;
  const rows = await getDb()
    .select({ id: emailDelivery.id, payload: emailDelivery.payload })
    .from(emailDelivery)
    .where(resendable)
    .orderBy(emailDelivery.createdAt)
    .limit(MAX_BULK_RESEND);
  if (!rows.length) return { queued: 0 };
  await getDb()
    .update(emailDelivery)
    .set({ error: QUEUED_FOR_RESEND })
    .where(
      inArray(
        emailDelivery.id,
        rows.map((r) => r.id),
      ),
    );
  for (const r of rows) await enqueue(QUEUES.email, { ...r.payload, deliveryId: r.id });
  return { queued: rows.length };
}

/** Daily retention: the log is for troubleshooting, not an archive. */
export async function pruneDeliveries(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - DELIVERY_RETENTION_DAYS * 86_400_000);
  const gone = await getDb()
    .delete(emailDelivery)
    .where(lt(emailDelivery.createdAt, cutoff))
    .returning({ id: emailDelivery.id });
  return gone.length;
}
