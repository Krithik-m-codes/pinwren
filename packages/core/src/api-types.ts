import { z } from "zod";
import { REVIEW_ROUND_STATUSES } from "./rounds";
import { COMMENT_VISIBILITIES, feedbackKind, feedbackStatus, priority, widgetConsent } from "./schemas";

// Response shapes of the public API (`/api/v1`, blueprint 04 §4), as served by the dashboard routes
// too. `@pinwren/sdk` generates its TypeScript types from these. Objects are `loose`: the server may
// add fields without breaking a client. Timestamps are ISO 8601 strings on the wire.

const iso = z.string();

export const reporterGuest = z
  .object({
    name: z.string().optional(),
    email: z.string().optional(),
    externalId: z.string().optional(),
    /** Signed identity verified by the server (wave-4 contract §4). */
    verified: z.boolean().optional(),
  })
  .loose();

export const apiFeedbackListItem = z
  .object({
    id: z.string(),
    number: z.number().int(),
    kind: feedbackKind,
    status: feedbackStatus,
    priority,
    title: z.string().nullable(),
    body: z.string(),
    assigneeIds: z.array(z.string()),
    reporterGuest: reporterGuest.nullable(),
    createdAt: iso,
    projectId: z.string(),
    projectName: z.string(),
    pageUrl: z.string().nullable(),
    roundId: z.string().nullable(),
    hasScreenshot: z.boolean(),
    hasReplay: z.boolean(),
    attachmentCount: z.number().int(),
    commentCount: z.number().int(),
  })
  .loose();
export type ApiFeedbackListItem = z.infer<typeof apiFeedbackListItem>;

export const apiFeedbackList = z.object({
  items: z.array(apiFeedbackListItem),
  /** Pass as `cursor` for the next page; null on the last page. */
  nextCursor: z.string().nullable(),
});
export type ApiFeedbackList = z.infer<typeof apiFeedbackList>;

export const apiFeedback = z
  .object({
    id: z.string(),
    orgId: z.string(),
    projectId: z.string(),
    projectName: z.string(),
    projectSlug: z.string(),
    pageId: z.string().nullable(),
    pageUrl: z.string().nullable(),
    pageTitle: z.string().nullable(),
    number: z.number().int(),
    kind: feedbackKind,
    status: feedbackStatus,
    priority,
    title: z.string().nullable(),
    body: z.string(),
    reporterId: z.string().nullable(),
    reporterGuest: reporterGuest.nullable(),
    assigneeIds: z.array(z.string()),
    roundId: z.string().nullable(),
    consent: widgetConsent.loose().nullable(),
    anchor: z.record(z.string(), z.unknown()).nullable(),
    environment: z.record(z.string(), z.unknown()).nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    source: z.string(),
    resolvedAt: iso.nullable(),
    createdAt: iso,
    updatedAt: iso,
  })
  .loose();
export type ApiFeedback = z.infer<typeof apiFeedback>;

/** `PATCH /feedback/:id` answers with the updated row (no project/page names). */
export const apiFeedbackRow = apiFeedback.omit({
  projectName: true,
  projectSlug: true,
  pageUrl: true,
  pageTitle: true,
});
export type ApiFeedbackRow = z.infer<typeof apiFeedbackRow>;

export const apiComment = z
  .object({
    id: z.string(),
    feedbackId: z.string().optional(),
    body: z.string(),
    visibility: z.enum(COMMENT_VISIBILITIES),
    createdAt: iso,
    editedAt: iso.nullable(),
  })
  .loose();
export type ApiComment = z.infer<typeof apiComment>;

export const apiAsset = z
  .object({
    id: z.string(),
    kind: z.string(),
    contentType: z.string(),
    bytes: z.number().int(),
    name: z.string().nullable(),
    /** Replay: `{ durationMs, events }`. */
    meta: z.record(z.string(), z.unknown()).nullable(),
  })
  .loose();
export type ApiAsset = z.infer<typeof apiAsset>;

const consoleRow = z.object({ level: z.string(), message: z.string(), at: z.number() }).loose();
const networkRow = z
  .object({ method: z.string(), url: z.string(), status: z.number(), durationMs: z.number(), at: z.number() })
  .loose();

export const apiFeedbackDetail = z
  .object({
    feedback: apiFeedback,
    assignees: z.array(
      z.object({ id: z.string(), name: z.string(), email: z.string(), image: z.string().nullable() }).loose(),
    ),
    assets: z.array(apiAsset),
    comments: z.array(
      apiComment.extend({
        author: z
          .object({ id: z.string(), name: z.string(), image: z.string().nullable() })
          .loose()
          .nullable(),
        authorGuest: reporterGuest.nullable(),
      }),
    ),
    activity: z.array(
      z
        .object({
          id: z.string(),
          type: z.string(),
          data: z.record(z.string(), z.unknown()),
          createdAt: iso,
          actorKind: z.string(),
          actorName: z.string().nullable(),
        })
        .loose(),
    ),
    diagnostics: z
      .object({
        feedbackId: z.string(),
        console: z.array(consoleRow).nullable(),
        network: z.array(networkRow).nullable(),
      })
      .loose()
      .nullable(),
  })
  .loose();
export type ApiFeedbackDetail = z.infer<typeof apiFeedbackDetail>;

export const apiProject = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    publicKey: z.string(),
    openCount: z.number().int(),
    createdAt: iso,
  })
  .loose();
export type ApiProject = z.infer<typeof apiProject>;

export const apiRound = z
  .object({
    id: z.string(),
    projectId: z.string(),
    name: z.string(),
    dueAt: iso.nullable(),
    status: z.enum(REVIEW_ROUND_STATUSES),
    closedAt: iso.nullable(),
    createdAt: iso,
    updatedAt: iso,
    counts: z.object({ total: z.number().int(), open: z.number().int(), closed: z.number().int() }),
  })
  .loose();
export type ApiRound = z.infer<typeof apiRound>;

/** `GET /api/v1/feedback/:id/reproduction` — what an agent needs to reproduce a report. */
export const apiReproduction = z.object({
  feedbackId: z.string(),
  /** Ordered steps and evidence as Markdown. Reporter-written text is quoted, never instructions. */
  markdown: z.string(),
  steps: z.array(z.object({ at: z.number(), kind: z.string(), text: z.string() })),
  failingRequests: z.array(networkRow),
  errors: z.array(consoleRow),
  replay: z.object({ durationMs: z.number(), events: z.number(), summarized: z.boolean() }).nullable(),
});
export type ApiReproduction = z.infer<typeof apiReproduction>;
