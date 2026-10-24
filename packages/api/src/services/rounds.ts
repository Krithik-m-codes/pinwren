import {
  CLOSED_STATUSES,
  type ReviewRoundCreate,
  type ReviewRoundUpdate,
  type FeedbackStatus,
} from "@pinwren/core";
import { feedback, getDb, page, project, reviewRound } from "@pinwren/db";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { feedbackLink } from "./feedback-payload";
import { ApiError, notFound } from "../errors";
import { toCsv } from "../export/csv";
import { renderPdf } from "../export/pdf";

// Review rounds (F-055): CRUD, counts and exports. Shared by the dashboard routes and /api/v1.

const closedList = sql.raw(CLOSED_STATUSES.map((s) => `'${s}'`).join(","));
const activeList = sql.raw("'open','in_progress','in_review'");

// Qualified by hand: Drizzle leaves column names unqualified in single-table selects, and inside these
// subqueries a bare "id" would mean the feedback row's id.
const roundId = sql.raw(`"review_round"."id"`);

const roundColumns = {
  id: reviewRound.id,
  projectId: reviewRound.projectId,
  name: reviewRound.name,
  dueAt: reviewRound.dueAt,
  status: reviewRound.status,
  closedAt: reviewRound.closedAt,
  createdBy: reviewRound.createdBy,
  createdAt: reviewRound.createdAt,
  updatedAt: reviewRound.updatedAt,
  total: sql<number>`(select count(*)::int from ${feedback} f where f.round_id = ${roundId} and f.deleted_at is null)`,
  open: sql<number>`(select count(*)::int from ${feedback} f where f.round_id = ${roundId} and f.deleted_at is null and f.status in (${activeList}))`,
  closed: sql<number>`(select count(*)::int from ${feedback} f where f.round_id = ${roundId} and f.deleted_at is null and f.status in (${closedList}))`,
};

type RoundRow = { total: number; open: number; closed: number } & Omit<
  typeof reviewRound.$inferSelect,
  "orgId"
>;

const roundOut = ({ total, open, closed, ...r }: RoundRow) => ({ ...r, counts: { total, open, closed } });
export type RoundOut = ReturnType<typeof roundOut>;

async function projectOf(orgId: string, projectId: string) {
  const [p] = await getDb()
    .select({ id: project.id, name: project.name })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.orgId, orgId)));
  if (!p) throw notFound("Project");
  return p;
}

export async function listRounds(orgId: string, projectId: string): Promise<RoundOut[]> {
  await projectOf(orgId, projectId);
  const rows = await getDb()
    .select(roundColumns)
    .from(reviewRound)
    .where(and(eq(reviewRound.orgId, orgId), eq(reviewRound.projectId, projectId)))
    // Active rounds first, then the most recent.
    .orderBy(asc(reviewRound.status), desc(reviewRound.createdAt));
  return rows.map(roundOut);
}

export async function getRound(orgId: string, id: string): Promise<RoundOut> {
  const [row] = await getDb()
    .select(roundColumns)
    .from(reviewRound)
    .where(and(eq(reviewRound.id, id), eq(reviewRound.orgId, orgId)));
  if (!row) throw notFound("Round");
  return roundOut(row);
}

export async function createRound(
  orgId: string,
  projectId: string,
  userId: string,
  body: ReviewRoundCreate,
): Promise<RoundOut> {
  await projectOf(orgId, projectId);
  const [r] = await getDb()
    .insert(reviewRound)
    .values({
      orgId,
      projectId,
      name: body.name,
      dueAt: body.dueAt ? new Date(body.dueAt) : null,
      createdBy: userId,
    })
    .returning({ id: reviewRound.id });
  if (!r) throw new Error("round insert failed");
  return getRound(orgId, r.id);
}

export async function updateRound(orgId: string, id: string, patch: ReviewRoundUpdate): Promise<RoundOut> {
  const current = await getRound(orgId, id);
  const set: Partial<typeof reviewRound.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.dueAt !== undefined) set.dueAt = patch.dueAt ? new Date(patch.dueAt) : null;
  if (patch.status !== undefined && patch.status !== current.status) {
    set.status = patch.status;
    set.closedAt = patch.status === "closed" ? new Date() : null;
  }
  if (Object.keys(set).length) {
    await getDb()
      .update(reviewRound)
      .set(set)
      .where(and(eq(reviewRound.id, id), eq(reviewRound.orgId, orgId)));
  }
  return getRound(orgId, id);
}

/** Deleting a round keeps its feedback (their `roundId` becomes null). */
export async function deleteRound(orgId: string, id: string): Promise<void> {
  const rows = await getDb()
    .delete(reviewRound)
    .where(and(eq(reviewRound.id, id), eq(reviewRound.orgId, orgId)))
    .returning({ id: reviewRound.id });
  if (!rows.length) throw notFound("Round");
}

/** The round a feedback item may move into: same organisation and project. */
export async function assertRoundFor(orgId: string, projectId: string, roundId: string): Promise<void> {
  const [r] = await getDb()
    .select({ id: reviewRound.id })
    .from(reviewRound)
    .where(
      and(eq(reviewRound.id, roundId), eq(reviewRound.orgId, orgId), eq(reviewRound.projectId, projectId)),
    );
  if (!r) throw new ApiError(400, "INVALID_ROUND", "That review round belongs to another project");
}

async function roundItems(orgId: string, roundId: string) {
  return getDb()
    .select({
      id: feedback.id,
      number: feedback.number,
      kind: feedback.kind,
      status: feedback.status,
      priority: feedback.priority,
      title: feedback.title,
      body: feedback.body,
      reporterGuest: feedback.reporterGuest,
      pageUrl: page.url,
      createdAt: feedback.createdAt,
      resolvedAt: feedback.resolvedAt,
    })
    .from(feedback)
    .leftJoin(page, eq(page.id, feedback.pageId))
    .where(and(eq(feedback.orgId, orgId), eq(feedback.roundId, roundId), isNull(feedback.deletedAt)))
    .orderBy(asc(feedback.number));
}

const STATUS_TEXT: Record<FeedbackStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  in_review: "In review",
  resolved: "Resolved",
  wont_fix: "Won't fix",
  duplicate: "Duplicate",
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Safe for a Content-Disposition filename: letters, digits, dot, dash, underscore. */
const fileSlug = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "round";

export async function exportRound(
  orgId: string,
  id: string,
  format: "csv" | "pdf",
): Promise<{ body: Uint8Array<ArrayBuffer> | string; contentType: string; filename: string }> {
  const round = await getRound(orgId, id);
  const p = await projectOf(orgId, round.projectId);
  const items = await roundItems(orgId, id);
  const filename = `${fileSlug(p.name)}-${fileSlug(round.name)}.${format}`;
  if (format === "csv") {
    return {
      contentType: "text/csv; charset=utf-8",
      filename,
      body: toCsv(
        [
          "number",
          "kind",
          "status",
          "priority",
          "title",
          "body",
          "reporter",
          "page",
          "created",
          "resolved",
          "link",
        ],
        items.map((f) => [
          f.number,
          f.kind,
          f.status,
          f.priority,
          f.title,
          f.body,
          f.reporterGuest?.name ?? null,
          f.pageUrl,
          f.createdAt,
          f.resolvedAt,
          feedbackLink(orgId, f.id),
        ]),
      ),
    };
  }
  const due = round.dueAt ? ` · due ${round.dueAt.toISOString().slice(0, 10)}` : "";
  return {
    contentType: "application/pdf",
    filename,
    body: renderPdf({
      title: `${p.name} — ${round.name}`,
      subtitle: `Review round, ${round.status}${due} · ${round.counts.total} items (${round.counts.open} open, ${round.counts.closed} closed) · exported ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
      items: items.map((f) => ({
        heading: `#${f.number} ${f.title?.trim() || f.body.slice(0, 80)}`,
        meta: [
          cap(f.kind),
          STATUS_TEXT[f.status],
          f.priority === "none" ? null : `${cap(f.priority)} priority`,
          f.reporterGuest?.name ? `from ${f.reporterGuest.name}` : null,
          f.createdAt.toISOString().slice(0, 10),
          f.pageUrl,
        ]
          .filter(Boolean)
          .join(" · "),
        body: f.body,
      })),
    }),
  };
}
