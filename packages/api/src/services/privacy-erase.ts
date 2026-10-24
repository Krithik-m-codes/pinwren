import { activity, comment, emailDelivery, feedback, getDb, orgSetting } from "@pinwren/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { sha256Hex } from "../crypto";
import { purgeFeedback } from "../jobs/maintenance";

// "Erase everything from a reporter" (F-095 GDPR delete, wave-5 contract §3.5). An org Admin enters the
// address a reporter used in the widget; every report they filed is hard-deleted with its files, every
// reply they wrote on other reports is removed, and the email log forgets them. The erasure itself is
// recorded without the address (only its SHA-256), so the record doesn't undo what it describes.

export const privacyErase = z.object({
  email: z.email("Enter the reporter's email address").max(254),
  /** Count what would go without deleting anything (the confirm dialog shows it). */
  dryRun: z.boolean().optional(),
});
export type PrivacyErase = z.infer<typeof privacyErase>;

export type EraseResult = { feedback: number; comments: number; emails: number; dryRun: boolean };

export type ErasureRecord = {
  at: string;
  by: string;
  emailSha256: string;
  feedback: number;
  comments: number;
  emails: number;
};

const LOG_KEY = "privacy.erasures";
const MAX_LOG = 200;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** Keep the newest records first, at most MAX_LOG. */
export function appendErasure(log: readonly ErasureRecord[], entry: ErasureRecord): ErasureRecord[] {
  return [entry, ...log].slice(0, MAX_LOG);
}

export async function eraseReporter(
  orgId: string,
  userId: string,
  input: PrivacyErase,
): Promise<EraseResult> {
  const email = normalizeEmail(input.email);
  const db = getDb();
  const guestEmail = (col: typeof feedback.reporterGuest | typeof comment.authorGuest) =>
    sql`lower(${col}->>'email') = ${email}`;

  // Trashed items too: "everything" includes what sits in the trash.
  const items = await db
    .select({ id: feedback.id })
    .from(feedback)
    .where(and(eq(feedback.orgId, orgId), guestEmail(feedback.reporterGuest)));
  const itemIds = items.map((i) => i.id);
  const replies = await db
    .select({ id: comment.id, feedbackId: comment.feedbackId })
    .from(comment)
    .where(and(eq(comment.orgId, orgId), guestEmail(comment.authorGuest)));
  const elsewhere = replies.filter((r) => !itemIds.includes(r.feedbackId));
  const [{ n: emails } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(emailDelivery)
    .where(and(eq(emailDelivery.orgId, orgId), sql`lower(${emailDelivery.toAddress}) = ${email}`));

  const result: EraseResult = {
    feedback: itemIds.length,
    comments: elsewhere.length,
    emails,
    dryRun: !!input.dryRun,
  };
  if (input.dryRun) return result;

  if (elsewhere.length) {
    await db.delete(comment).where(
      inArray(
        comment.id,
        elsewhere.map((r) => r.id),
      ),
    );
    // The reports the replies were on keep a trace that something was removed, and by whom.
    const touched = [...new Set(elsewhere.map((r) => r.feedbackId))];
    await db.insert(activity).values(
      touched.map((feedbackId) => ({
        orgId,
        feedbackId,
        actorId: userId,
        actorKind: "user",
        type: "reporter_erased",
        data: { comments: elsewhere.filter((r) => r.feedbackId === feedbackId).length },
      })),
    );
  }
  // Rows first, then their files (purgeFeedback's order).
  await purgeFeedback(itemIds);
  await db
    .delete(emailDelivery)
    .where(and(eq(emailDelivery.orgId, orgId), sql`lower(${emailDelivery.toAddress}) = ${email}`));

  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ value: orgSetting.value })
      .from(orgSetting)
      .where(and(eq(orgSetting.orgId, orgId), eq(orgSetting.key, LOG_KEY)))
      .for("update");
    const log = ((row?.value as { entries?: ErasureRecord[] } | undefined)?.entries ?? []).filter(Boolean);
    const value = {
      entries: appendErasure(log, {
        at: new Date().toISOString(),
        by: userId,
        emailSha256: sha256Hex(email),
        feedback: result.feedback,
        comments: result.comments,
        emails: result.emails,
      }),
    };
    await tx
      .insert(orgSetting)
      .values({ orgId, key: LOG_KEY, value, updatedBy: userId })
      .onConflictDoUpdate({
        target: [orgSetting.orgId, orgSetting.key],
        set: { value, updatedBy: userId, updatedAt: new Date() },
      });
  });
  return result;
}

/** The erasure log for Project › Privacy & data (newest first). */
export async function erasureLog(orgId: string, limit = 20): Promise<ErasureRecord[]> {
  const [row] = await getDb()
    .select({ value: orgSetting.value })
    .from(orgSetting)
    .where(and(eq(orgSetting.orgId, orgId), eq(orgSetting.key, LOG_KEY)));
  return ((row?.value as { entries?: ErasureRecord[] } | undefined)?.entries ?? []).slice(0, limit);
}
