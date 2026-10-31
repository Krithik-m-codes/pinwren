import {
  comment,
  diagnostics,
  feedback,
  feedbackAsset,
  getDb,
  page,
  project,
  reviewLink,
  user,
} from "@pinwren/db";
import { and, eq, inArray } from "drizzle-orm";
import { env } from "../env";
import type { CommentPayload, FeedbackPayload } from "../webhooks/format";

/**
 * The dashboard link to one item (emails, chat, trackers, exports). `org` lets the inbox switch the active
 * workspace first when the reader is in several (wave-5 contract §3).
 */
export const feedbackLink = (orgId: string, id: string) =>
  `${env().PINWREN_URL.replace(/\/$/, "")}/inbox?status=all&org=${encodeURIComponent(orgId)}&item=${encodeURIComponent(id)}`;

/** Notifications › General and › Reporter of the item's project (wave-5 contract §3.2). */
export type ProjectNotifySettings = {
  /** null = every member. */
  memberIds: string[] | null;
  emails: string[];
  reporterReceived: boolean;
  reporterStatus: boolean;
  reporterPriority: boolean;
  reporterAssigned: boolean;
};

export type FeedbackContext = {
  payload: FeedbackPayload;
  orgId: string;
  projectKey: string;
  reporterEmail: string | null;
  /** The reporter when they are a member (signed-in widget or dashboard report), else null. */
  reporterId: string | null;
  notifyReporter: boolean;
  notify: ProjectNotifySettings;
  /** Set when the item is in the trash. */
  deletedAt: Date | null;
};

/** Load one feedback item as the shape used by webhooks, notifications and emails. */
export async function loadFeedbackContext(feedbackId: string): Promise<FeedbackContext | null> {
  const [row] = await getDb()
    .select({
      f: feedback,
      projectName: project.name,
      projectKey: project.publicKey,
      notifyReporter: project.notifyReporter,
      notify: {
        memberIds: project.notifyMemberIds,
        emails: project.notifyEmails,
        reporterReceived: project.reporterEmailReceived,
        reporterStatus: project.reporterEmailStatus,
        reporterPriority: project.reporterEmailPriority,
        reporterAssigned: project.reporterEmailAssigned,
      },
      pageUrl: page.url,
      reviewLink: reviewLink.label,
    })
    .from(feedback)
    .innerJoin(project, eq(project.id, feedback.projectId))
    .leftJoin(page, eq(page.id, feedback.pageId))
    .leftJoin(reviewLink, eq(reviewLink.id, feedback.reviewLinkId))
    .where(eq(feedback.id, feedbackId));
  if (!row) return null;
  const f = row.f;
  const guest = f.reporterGuest ?? null;
  let reporterName = guest?.name ?? null;
  let reporterEmail = guest?.email ?? null;
  if (f.reporterId) {
    const [u] = await getDb()
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, f.reporterId));
    reporterName ??= u?.name ?? null;
    reporterEmail ??= u?.email ?? null;
  }
  return {
    orgId: f.orgId,
    projectKey: row.projectKey,
    reporterEmail,
    reporterId: f.reporterId,
    notifyReporter: row.notifyReporter,
    notify: row.notify,
    deletedAt: f.deletedAt,
    payload: {
      id: f.id,
      number: f.number,
      projectId: f.projectId,
      projectName: row.projectName,
      kind: f.kind,
      status: f.status,
      priority: f.priority,
      title: f.title,
      body: f.body.length > 4000 ? `${f.body.slice(0, 3999)}…` : f.body,
      pageUrl: row.pageUrl,
      reporterName,
      reviewLink: row.reviewLink ?? null,
      assigneeIds: f.assigneeIds,
      createdAt: f.createdAt.toISOString(),
      updatedAt: f.updatedAt.toISOString(),
      url: feedbackLink(f.orgId, f.id),
    },
  };
}

export async function loadCommentPayload(
  commentId: string,
): Promise<(CommentPayload & { authorId: string | null; feedbackId: string }) | null> {
  const [row] = await getDb()
    .select({ c: comment, authorName: user.name })
    .from(comment)
    .leftJoin(user, eq(user.id, comment.authorId))
    .where(eq(comment.id, commentId));
  if (!row) return null;
  const c = row.c;
  return {
    id: c.id,
    body: c.body,
    visibility: c.visibility,
    authorName: row.authorName ?? c.authorGuest?.name ?? null,
    team: c.authorId !== null,
    createdAt: c.createdAt.toISOString(),
    authorId: c.authorId,
    feedbackId: c.feedbackId,
  };
}

/** What a team email shows about a report besides its text (the `details` templates). */
export type FeedbackFacts = {
  browser: string | null;
  os: string | null;
  consoleErrors: number;
  failedRequests: number;
  hasReplay: boolean;
  /** The image to show: annotated screenshot, else the capture, else its thumbnail. */
  screenshotAssetId: string | null;
};

const SCREENSHOT_ORDER = ["screenshot_annotated", "screenshot", "thumbnail"] as const;

/** Counts from captured diagnostics: console `error` entries; requests that failed or answered ≥ 400. */
export function diagnosticCounts(d: { console?: unknown; network?: unknown } | null | undefined): {
  consoleErrors: number;
  failedRequests: number;
} {
  // Entries come from the widget (validated on the way in), but stay defensive: null rows are skipped.
  const list = (v: unknown) =>
    (Array.isArray(v) ? (v as unknown[]) : []).filter(
      (e): e is Record<string, unknown> => typeof e === "object" && e !== null,
    );
  return {
    consoleErrors: list(d?.console).filter((e) => e.level === "error").length,
    failedRequests: list(d?.network).filter(
      (e) => typeof e.status === "number" && (e.status === 0 || e.status >= 400),
    ).length,
  };
}

export async function loadFeedbackFacts(feedbackId: string): Promise<FeedbackFacts> {
  const db = getDb();
  const [[f], [d], assets] = await Promise.all([
    db.select({ environment: feedback.environment }).from(feedback).where(eq(feedback.id, feedbackId)),
    db
      .select({ console: diagnostics.console, network: diagnostics.network })
      .from(diagnostics)
      .where(eq(diagnostics.feedbackId, feedbackId)),
    db
      .select({ id: feedbackAsset.id, kind: feedbackAsset.kind })
      .from(feedbackAsset)
      .where(
        and(
          eq(feedbackAsset.feedbackId, feedbackId),
          inArray(feedbackAsset.kind, [...SCREENSHOT_ORDER, "replay"]),
        ),
      ),
  ]);
  const env = (f?.environment ?? {}) as { browser?: unknown; os?: unknown };
  const shot = SCREENSHOT_ORDER.map((k) => assets.find((a) => a.kind === k)).find(Boolean);
  return {
    browser: typeof env.browser === "string" ? env.browser : null,
    os: typeof env.os === "string" ? env.os : null,
    ...diagnosticCounts(d),
    hasReplay: assets.some((a) => a.kind === "replay"),
    screenshotAssetId: shot?.id ?? null,
  };
}
