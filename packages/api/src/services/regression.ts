import {
  anchorKeyOf,
  errorHashesOf,
  pagePathOf,
  type RegressionConfidence,
  type RegressionMatch,
  type RegressionSignature,
  type RegressionSignalsData,
  reportedRelease,
  scoreRegression,
} from "@pinwren/core";
import { activity, diagnostics, feedback, getDb, page, project, projectRelease } from "@pinwren/db";
import { and, desc, eq, isNull, ne, or, type SQL, sql } from "drizzle-orm";
import { emit, updateEvents } from "../events";

// Regression detection (ADR 0029). A new bug report is compared with the project's resolved bugs on the signals
// the dashboard already captures: the same element on the same page, or the same console error. A match is only
// a flag (badge, timeline rows, notification, automation event); reopening the original is a per-project
// opt-in. Nothing here runs in the request that filed the report: the dispatcher calls it after commit.

/** How many resolved candidates are scored; the best match wins. */
const MAX_CANDIDATES = 10;
/** Resolved bugs that predate the signature columns are filled in this many at a time, on demand. */
const BACKFILL_BATCH = 100;

type FeedbackRow = typeof feedback.$inferSelect;

/** The actor regression detection acts as in timelines and events. */
export const REGRESSION_ACTOR_ID = "regression";

export function signatureOf(
  pageUrl: string | null,
  anchor: unknown,
  consoleEntries: unknown,
  metadata: unknown,
): RegressionSignature {
  return {
    path: pagePathOf(pageUrl),
    anchor: anchorKeyOf(anchor),
    errors: errorHashesOf(consoleEntries, metadata),
  };
}

/** Compute and store the signature of up to BACKFILL_BATCH resolved bugs that never had one. */
async function backfillSignatures(orgId: string, projectId: string): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({
      id: feedback.id,
      anchor: feedback.anchor,
      metadata: feedback.metadata,
      pageUrl: page.url,
      console: diagnostics.console,
    })
    .from(feedback)
    .leftJoin(page, and(eq(page.id, feedback.pageId), eq(page.orgId, feedback.orgId)))
    .leftJoin(diagnostics, eq(diagnostics.feedbackId, feedback.id))
    .where(
      and(
        eq(feedback.orgId, orgId),
        eq(feedback.projectId, projectId),
        eq(feedback.kind, "bug"),
        eq(feedback.status, "resolved"),
        isNull(feedback.deletedAt),
        isNull(feedback.sigErrors),
      ),
    )
    .orderBy(desc(feedback.resolvedAt))
    .limit(BACKFILL_BATCH);
  for (const r of rows) {
    const sig = signatureOf(r.pageUrl, r.anchor, r.console, r.metadata);
    await db
      .update(feedback)
      .set({ sigPath: sig.path, sigAnchor: sig.anchor, sigErrors: sig.errors })
      .where(eq(feedback.id, r.id));
  }
}

/** A recorded release as the comparison needs it: its label and when it went live. */
async function releasePoint(orgId: string, projectId: string, version: string | null) {
  if (!version) return null;
  const [r] = await getDb()
    .select({ version: projectRelease.version, at: projectRelease.deployedAt })
    .from(projectRelease)
    .where(
      and(
        eq(projectRelease.orgId, orgId),
        eq(projectRelease.projectId, projectId),
        sql`lower(${projectRelease.version}) = lower(${version})`,
      ),
    );
  return r ? { version: r.version, at: r.at.toISOString() } : { version };
}

export type RegressionOutcome = {
  of: { id: string; number: number };
  match: RegressionMatch;
  reopened: boolean;
} | null;

/**
 * Look at a freshly filed report and flag it when it looks like a resolved bug coming back. Safe to call twice:
 * an item already flagged is left alone. Always stores the report's own signature first, so the report can be
 * matched against later, even when detection is off for the project today.
 */
export async function detectRegression(orgId: string, feedbackId: string): Promise<RegressionOutcome> {
  const db = getDb();
  const [row] = await db
    .select({
      f: feedback,
      pageUrl: page.url,
      detect: project.detectRegressions,
      autoReopen: project.autoReopenRegressions,
      console: diagnostics.console,
    })
    .from(feedback)
    .innerJoin(project, and(eq(project.id, feedback.projectId), eq(project.orgId, feedback.orgId)))
    .leftJoin(page, and(eq(page.id, feedback.pageId), eq(page.orgId, feedback.orgId)))
    .leftJoin(diagnostics, eq(diagnostics.feedbackId, feedback.id))
    .where(and(eq(feedback.id, feedbackId), eq(feedback.orgId, orgId)));
  if (!row || row.f.deletedAt || row.f.kind !== "bug") return null;
  const sig = signatureOf(row.pageUrl, row.f.anchor, row.console, row.f.metadata);
  if (row.f.sigErrors === null) {
    await db
      .update(feedback)
      .set({ sigPath: sig.path, sigAnchor: sig.anchor, sigErrors: sig.errors })
      .where(eq(feedback.id, feedbackId));
  }
  if (!row.detect || row.f.regressionOfId) return null;
  if (!sig.errors.length && !(sig.path && sig.anchor)) return null;

  await backfillSignatures(orgId, row.f.projectId);

  const links: SQL[] = [];
  if (sig.errors.length) links.push(sql`${feedback.sigErrors} && ${textArray(sig.errors)}`);
  if (sig.path && sig.anchor) {
    links.push(sql`(${feedback.sigPath} = ${sig.path} and ${feedback.sigAnchor} = ${sig.anchor})`);
  }
  const candidates = await db
    .select({
      id: feedback.id,
      number: feedback.number,
      resolvedAt: feedback.resolvedAt,
      fixedInReleaseId: feedback.fixedInReleaseId,
      sigPath: feedback.sigPath,
      sigAnchor: feedback.sigAnchor,
      sigErrors: feedback.sigErrors,
      fixedInVersion: projectRelease.version,
      fixedInAt: projectRelease.deployedAt,
    })
    .from(feedback)
    .leftJoin(
      projectRelease,
      and(eq(projectRelease.id, feedback.fixedInReleaseId), eq(projectRelease.orgId, feedback.orgId)),
    )
    .where(
      and(
        eq(feedback.orgId, orgId),
        eq(feedback.projectId, row.f.projectId),
        ne(feedback.id, feedbackId),
        eq(feedback.kind, "bug"),
        eq(feedback.status, "resolved"),
        isNull(feedback.deletedAt),
        or(...links),
      ),
    )
    .orderBy(desc(feedback.resolvedAt))
    .limit(MAX_CANDIDATES);
  if (!candidates.length) return null;

  const reported = reportedRelease(row.f.metadata);
  const reportedPoint = await releasePoint(orgId, row.f.projectId, reported);
  let best: { c: (typeof candidates)[number]; match: RegressionMatch } | null = null;
  for (const c of candidates) {
    const match = scoreRegression(
      sig,
      { path: c.sigPath, anchor: c.sigAnchor, errors: c.sigErrors ?? [] },
      {
        reported: reportedPoint,
        fixedIn: c.fixedInVersion
          ? { version: c.fixedInVersion, at: c.fixedInAt?.toISOString() ?? null }
          : null,
      },
    );
    // Candidates arrive newest-resolved first, so an equal score keeps the most recent original.
    if (match && (!best || match.score > best.match.score)) best = { c, match };
  }
  if (!best) return null;
  return flagRegression(orgId, row.f, best.c.id, best.match, {
    reportedRelease: reported,
    fixedInVersion: best.c.fixedInVersion,
    source: "detector",
    autoReopen: row.autoReopen,
  });
}

/** A `text[]` value from bound parameters, for `&&`. */
function textArray(values: string[]) {
  return sql`ARRAY[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::text[]`;
}

/**
 * Record that `fresh` may be a regression of the resolved `originalId`: the flag on the item, a timeline row on
 * both, the optional reopen of the original, and the `feedback.regression_detected` event (notifications,
 * webhooks, automation). Does nothing when `fresh` is already flagged or the original is no longer resolved
 * and live.
 */
export async function flagRegression(
  orgId: string,
  fresh: Pick<FeedbackRow, "id" | "projectId" | "number" | "regressionOfId">,
  originalId: string,
  match: RegressionMatch,
  opts: {
    reportedRelease: string | null;
    fixedInVersion: string | null;
    source: RegressionSignalsData["source"];
    autoReopen: boolean;
  },
): Promise<RegressionOutcome> {
  const db = getDb();
  const done = await db.transaction(async (tx) => {
    const [original] = await tx
      .select()
      .from(feedback)
      .where(
        and(
          eq(feedback.id, originalId),
          eq(feedback.orgId, orgId),
          eq(feedback.projectId, fresh.projectId),
          isNull(feedback.deletedAt),
        ),
      )
      .for("update");
    if (original?.status !== "resolved") return null;
    const signals: RegressionSignalsData = {
      signals: match.signals,
      reportedRelease: opts.reportedRelease,
      fixedInVersion: opts.fixedInVersion,
      afterFix: match.afterFix,
      score: match.score,
      source: opts.source,
    };
    const [flagged] = await tx
      .update(feedback)
      .set({
        regressionOfId: originalId,
        regressionConfidence: match.confidence,
        regressionSignals: signals,
      })
      .where(and(eq(feedback.id, fresh.id), isNull(feedback.regressionOfId)))
      .returning({ id: feedback.id });
    if (!flagged) return null;

    const timeline: (typeof activity.$inferInsert)[] = [
      {
        orgId,
        feedbackId: fresh.id,
        actorId: null,
        actorKind: "system",
        type: "regression_detected",
        data: {
          of: { id: original.id, number: original.number },
          confidence: match.confidence,
          score: match.score,
          signals: match.signals,
          reportedRelease: opts.reportedRelease,
          fixedInVersion: opts.fixedInVersion,
          source: opts.source,
        },
      },
      {
        orgId,
        feedbackId: original.id,
        actorId: null,
        actorKind: "system",
        type: "regression_reported",
        data: {
          by: { id: fresh.id, number: fresh.number },
          confidence: match.confidence,
          signals: match.signals,
        },
      },
    ];
    let reopened = false;
    if (opts.autoReopen) {
      await tx
        .update(feedback)
        .set({ status: "open", resolvedAt: null, fixedInReleaseId: null, fixedInNextRelease: false })
        .where(eq(feedback.id, original.id));
      timeline.push({
        orgId,
        feedbackId: original.id,
        actorId: null,
        actorKind: "system",
        type: "status_changed",
        data: {
          from: "resolved",
          to: "open",
          via: "regression",
          by: { id: fresh.id, number: fresh.number },
        },
      });
      reopened = true;
    }
    await tx.insert(activity).values(timeline);
    return { original, reopened };
  });
  if (!done) return null;

  const actor = { kind: "integration" as const, id: REGRESSION_ACTOR_ID };
  emit({
    type: "feedback.regression_detected",
    orgId,
    feedbackId: fresh.id,
    actor,
    changes: {
      regressionOf: {
        from: null,
        to: { id: done.original.id, number: done.original.number, confidence: match.confidence },
      },
    },
  });
  if (done.reopened) {
    emit(
      ...updateEvents(
        { orgId, feedbackId: done.original.id, actor },
        { status: "resolved" },
        { status: "open" },
        ["status"],
      ),
    );
  }
  return { of: { id: done.original.id, number: done.original.number }, match, reopened: done.reopened };
}

/**
 * The AI duplicate check pointed at a resolved bug: that is a regression signal the detector may not have, so
 * flag it at the AI's confidence (50-100 maps to possible / likely). A no-op unless the project detects
 * regressions and the item is not flagged already.
 */
export async function flagFromDuplicateCandidate(
  orgId: string,
  feedbackId: string,
  candidateId: string,
  confidence: number | null | undefined,
): Promise<RegressionOutcome> {
  const db = getDb();
  const [row] = await db
    .select({
      f: feedback,
      detect: project.detectRegressions,
      autoReopen: project.autoReopenRegressions,
      candidateStatus: sql<
        string | null
      >`(select c.status::text from feedback c where c.id = ${candidateId} and c.org_id = ${orgId})`,
      candidateKind: sql<
        string | null
      >`(select c.kind::text from feedback c where c.id = ${candidateId} and c.org_id = ${orgId})`,
      fixedInVersion: sql<
        string | null
      >`(select r.version from project_release r join feedback c on c.fixed_in_release_id = r.id where c.id = ${candidateId} and c.org_id = ${orgId})`,
    })
    .from(feedback)
    .innerJoin(project, and(eq(project.id, feedback.projectId), eq(project.orgId, feedback.orgId)))
    .where(and(eq(feedback.id, feedbackId), eq(feedback.orgId, orgId)));
  if (!row?.detect || row.f.deletedAt || row.f.kind !== "bug" || row.f.regressionOfId) return null;
  if (row.candidateStatus !== "resolved" || row.candidateKind !== "bug") return null;
  const score = Math.max(0, Math.min(100, Math.round(confidence ?? 50)));
  const level: RegressionConfidence = score >= 85 ? "likely" : "possible";
  return flagRegression(
    orgId,
    row.f,
    candidateId,
    { score, confidence: level, signals: [], afterFix: null },
    {
      reportedRelease: reportedRelease(row.f.metadata),
      fixedInVersion: row.fixedInVersion,
      source: "ai",
      autoReopen: row.autoReopen,
    },
  );
}
