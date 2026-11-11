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
    /** Answers to the project's custom fields, by field key (ADR 0029). */
    customFields: z.record(z.string(), z.unknown()),
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
    /** Answers to the project's custom fields, by field key (ADR 0029). */
    customFields: z.record(z.string(), z.unknown()),
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

/**
 * `GET /api/v1/feedback/:id/brief` — a brief a coding agent can act on, with the commands and links that
 * deliver it. Built from masked diagnostics only; the replay and screenshot are linked, never included.
 */
export const apiAgentBrief = z.object({
  feedbackId: z.string(),
  number: z.number().int(),
  title: z.string(),
  /** The brief as Markdown. Reporter-written text is quoted, never instructions. */
  markdown: z.string(),
  hints: z.object({
    repo: z.object({ provider: z.string(), path: z.string() }).nullable(),
    searchTerms: z.array(z.string()),
    route: z.string().nullable(),
    files: z.array(z.string()),
  }),
  commands: z.object({
    claude: z.string(),
    claudeMcpSetup: z.string(),
    claudePipe: z.string(),
    vscode: z.string(),
  }),
  links: z.object({ cursor: z.string(), dashboard: z.string() }),
  privacy: z.object({
    replayIncluded: z.literal(false),
    screenshotIncluded: z.literal(false),
    note: z.string(),
  }),
});
export type ApiAgentBrief = z.infer<typeof apiAgentBrief>;

/** `GET /api/v1/feedback/:id/repro-test` — a draft Playwright test for the report. */
export const apiReproTest = z.object({
  feedbackId: z.string(),
  filename: z.string(),
  language: z.literal("typescript"),
  code: z.string(),
  /** Plain-language limits of the draft; always show them next to the code. */
  caveats: z.array(z.string()),
  stats: z.object({
    scripted: z.number().int(),
    skipped: z.number().int(),
    hasReplay: z.boolean(),
    expectations: z.array(z.string()),
  }),
  /** True when an AI model rewrote the deterministic draft (dashboard only, opt-in). */
  polished: z.boolean(),
});
export type ApiReproTest = z.infer<typeof apiReproTest>;

/** `GET /api/v1/projects/:id/labels` */
export const apiLabel = z
  .object({ id: z.string(), name: z.string(), color: z.string(), count: z.number().int() })
  .loose();
export type ApiLabel = z.infer<typeof apiLabel>;

/** `GET /api/v1/views` — saved inbox views the token's owner can use. */
export const apiSavedView = z
  .object({
    id: z.string(),
    name: z.string(),
    filters: z.record(z.string(), z.unknown()),
    layout: z.string(),
    shared: z.boolean(),
    ownerId: z.string(),
    mine: z.boolean(),
    createdAt: iso,
    updatedAt: iso,
  })
  .loose();
export type ApiSavedView = z.infer<typeof apiSavedView>;
