import { z } from "zod";

// Wire types shared by the API, the dashboard and the widget. Never hand-write a request or
// response type elsewhere — derive it from these schemas (blueprint 04, "packages/core").

export const FEEDBACK_KINDS = ["comment", "bug", "idea", "question"] as const;
export const FEEDBACK_STATUSES = [
  "open",
  "in_progress",
  "in_review",
  "resolved",
  "wont_fix",
  "duplicate",
] as const;
export const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export const COMMENT_VISIBILITIES = ["public", "internal"] as const;

export const feedbackKind = z.enum(FEEDBACK_KINDS);
export const feedbackStatus = z.enum(FEEDBACK_STATUSES);
export const priority = z.enum(PRIORITIES);

export type FeedbackKind = z.infer<typeof feedbackKind>;
export type FeedbackStatus = z.infer<typeof feedbackStatus>;
export type Priority = z.infer<typeof priority>;

export const CLOSED_STATUSES: readonly FeedbackStatus[] = ["resolved", "wont_fix", "duplicate"];
export const isClosedStatus = (s: FeedbackStatus) => CLOSED_STATUSES.includes(s);

// --- Anchor bundle (blueprint 05 §5) -------------------------------------------------------------

export const anchorBundle = z.object({
  v: z.literal(1),
  attrs: z
    .object({
      pinwrenAnchor: z.string().max(200).optional(),
      testId: z.string().max(200).optional(),
      id: z.string().max(200).optional(),
      ariaLabel: z.string().max(200).optional(),
      name: z.string().max(200).optional(),
    })
    .optional(),
  css: z.string().max(2000),
  xpath: z.string().max(2000),
  text: z.object({
    content: z.string().max(200),
    prefix: z.string().max(64),
    suffix: z.string().max(64),
  }),
  tag: z.string().max(40),
  role: z.string().max(40).optional(),
  structure: z.object({
    depth: z.number().int().min(0).max(500),
    siblingIndex: z.number().int().min(0),
    childTagsHash: z.string().max(64),
  }),
  rect: z.object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
    vw: z.number(),
    vh: z.number(),
    scrollY: z.number(),
  }),
  pin: z.object({
    xPct: z.number().min(0).max(100),
    yPct: z.number().min(0).max(100),
    wPct: z.number().min(0).max(100).optional(),
    hPct: z.number().min(0).max(100).optional(),
  }),
  textRange: z
    .object({ startOffset: z.number().int(), endOffset: z.number().int(), quote: z.string().max(500) })
    .optional(),
});
export type AnchorBundle = z.infer<typeof anchorBundle>;

export const environment = z.object({
  userAgent: z.string().max(500),
  browser: z.string().max(60).optional(),
  os: z.string().max(60).optional(),
  viewport: z.object({ w: z.number().int(), h: z.number().int() }),
  dpr: z.number().min(0.5).max(8),
  locale: z.string().max(35).optional(),
  timezone: z.string().max(64).optional(),
  referrer: z.string().max(2000).optional(),
});
export type Environment = z.infer<typeof environment>;

const consoleEntry = z.object({
  level: z.enum(["error", "warn", "info", "log", "debug"]),
  message: z.string().max(4000),
  at: z.number(),
});
const networkEntry = z.object({
  method: z.string().max(10),
  url: z.string().max(2000),
  status: z.number().int(),
  durationMs: z.number(),
  at: z.number(),
});

// --- Widget: attachments (wave-1 contract §2) -----------------------------------------------------

export const ATTACHMENT_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
] as const;
export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export const widgetAttachment = z.object({
  name: z.string().trim().min(1).max(200),
  contentType: z.enum(ATTACHMENT_CONTENT_TYPES),
  // base64 of 5 MB is ~6.99 M characters, plus the data-URL prefix.
  dataUrl: z
    .string()
    .regex(/^data:[a-z]+\/[a-z0-9.+-]+;base64,/)
    .max(7_000_200),
});
export type WidgetAttachment = z.infer<typeof widgetAttachment>;

// --- Widget: consent record + session replay (wave-4 contract §3, §6) -------------------------------

export const widgetConsent = z.object({
  /** The notice version the reporter saw (an admin-chosen label or a hash of the text). */
  version: z.string().trim().min(1).max(64),
  acceptedAt: z.iso.datetime({ offset: true }),
});
export type WidgetConsent = z.infer<typeof widgetConsent>;

export const MAX_REPLAY_BYTES = 10 * 1024 * 1024;
export const REPLAY_CONTENT_TYPE = "application/gzip";

export const widgetReplay = z.object({
  // base64 of 10 MB is ~13.98 M characters, plus the data-URL prefix.
  dataUrl: z
    .string()
    .regex(/^data:application\/gzip;base64,/)
    .max(14_000_000),
  durationMs: z
    .number()
    .int()
    .min(0)
    .max(30 * 60_000),
  events: z.number().int().min(0).max(1_000_000),
});
export type WidgetReplay = z.infer<typeof widgetReplay>;

// --- Widget: create feedback (blueprint 04 §2) ------------------------------------------------------

export const widgetFeedbackCreate = z.object({
  clientId: z.uuid(),
  kind: feedbackKind,
  title: z.string().trim().max(200).optional(),
  body: z.string().trim().min(1).max(10_000),
  priority: priority.optional(),
  page: z.object({
    // Shown as a link in the dashboard, emails and chat messages: http(s) only (no javascript:, data:).
    url: z.url({ protocol: /^https?$/ }).max(2000),
    title: z.string().max(300).optional(),
    urlPattern: z.string().max(500).optional(),
  }),
  anchor: anchorBundle.optional(),
  environment,
  metadata: z.record(z.string(), z.unknown()).optional(),
  reporter: z
    .object({
      name: z.string().trim().max(120).optional(),
      email: z.email().max(254).optional(),
      /** The host app's user id (`Pinwren.identify({ id })`). */
      externalId: z.string().max(200).optional(),
      /**
       * Signed identity (wave-4 contract §4): hex HMAC-SHA256(project identity secret, externalId),
       * computed by the host app's server. A valid one marks the reporter `verified`.
       */
      signature: z
        .string()
        .regex(/^[0-9a-fA-F]{64}$/)
        .optional(),
    })
    .optional(),
  diagnostics: z
    .object({
      console: z.array(consoleEntry).max(200).optional(),
      network: z.array(networkEntry).max(100).optional(),
    })
    .optional(),
  screenshot: z
    .string()
    .regex(/^data:image\/(png|jpeg|webp);base64,/)
    .max(11_000_000)
    .optional(),
  attachments: z.array(widgetAttachment).max(MAX_ATTACHMENTS).optional(),
  /** Review round (F-055). Omitted: the project's active round, if it has exactly one. */
  roundId: z.uuid().optional(),
  /** What the reporter accepted in the consent notice (F-019), stored on the feedback. */
  consent: widgetConsent.optional(),
  /** Session replay (F-007): gzip of a JSON array of rrweb events, ≤ 10 MB decoded. */
  replay: widgetReplay.optional(),
});
export type WidgetFeedbackCreate = z.infer<typeof widgetFeedbackCreate>;

// --- Dashboard ---------------------------------------------------------------------------------

export const projectCreate = z.object({
  name: z.string().trim().min(1).max(80),
  allowedOrigins: z.array(z.string().trim().min(1).max(253)).max(50).default([]),
});
export type ProjectCreate = z.infer<typeof projectCreate>;

export const projectUpdate = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  allowedOrigins: z.array(z.string().trim().min(1).max(253)).max(50).optional(),
  publicRead: z.boolean().optional(),
  /** Partial widget config, deep-merged into the stored one and validated as a whole. */
  widgetConfig: z.record(z.string(), z.unknown()).optional(),
  /** Partial capture config, deep-merged into the stored one and validated as a whole. */
  captureConfig: z.record(z.string(), z.unknown()).optional(),
  /** Partial widget branding (wave-3 contract §2), merged and validated like the configs. */
  widgetBranding: z.record(z.string(), z.unknown()).optional(),
  /** Hard-delete feedback older than this many days (daily job). null keeps everything. */
  retentionDays: z.number().int().min(1).max(3650).nullable().optional(),
  /** Email the reporter (when they left an address) about team replies and status changes. */
  notifyReporter: z.boolean().optional(),
  /** Widget reports + replies per IP per minute. null uses the instance default. */
  widgetRateLimitPerMin: z.number().int().min(1).max(1000).nullable().optional(),
  /** Archive (true) or restore (false). Archived projects leave lists and their widget key stops working. */
  archived: z.boolean().optional(),
});
export type ProjectUpdate = z.infer<typeof projectUpdate>;

export const feedbackUpdate = z.object({
  status: feedbackStatus.optional(),
  priority: priority.optional(),
  title: z.string().trim().max(200).nullable().optional(),
  assigneeIds: z.array(z.string()).max(20).optional(),
  /** Move into a review round of the same project, or out of any (null). */
  roundId: z.uuid().nullable().optional(),
});
export type FeedbackUpdate = z.infer<typeof feedbackUpdate>;

export const feedbackListQuery = z.object({
  projectId: z.uuid().optional(),
  status: z.union([feedbackStatus, z.literal("active"), z.literal("all")]).default("active"),
  kind: feedbackKind.optional(),
  q: z.string().trim().max(200).optional(),
  priority: priority.optional(),
  /** Only items in this review round. */
  roundId: z.uuid().optional(),
  /** Only items assigned to this user. */
  assigneeId: z.string().max(100).optional(),
  /** Only items whose page URL contains this text. */
  page: z.string().trim().max(2000).optional(),
  /** Only items created at or after this instant (ISO 8601). */
  since: z.iso.datetime({ offset: true }).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type FeedbackListQuery = z.infer<typeof feedbackListQuery>;
export type FeedbackListQueryInput = z.input<typeof feedbackListQuery>;

export const commentCreate = z.object({
  body: z.string().trim().min(1).max(10_000),
  visibility: z.enum(COMMENT_VISIBILITIES).default("internal"),
});

export const commentUpdate = z.object({
  body: z.string().trim().min(1).max(10_000),
});

export const widgetCommentCreate = z.object({
  body: z.string().trim().min(1).max(10_000),
  author: z
    .object({
      name: z.string().trim().max(120).optional(),
      email: z.email().optional(),
      /** Signed identity, as on `POST /w/feedback` (wave-4 contract §4). */
      externalId: z.string().max(200).optional(),
      signature: z
        .string()
        .regex(/^[0-9a-fA-F]{64}$/)
        .optional(),
    })
    .optional(),
});

/** `PATCH /w/feedback/:id` — resolve or reopen from the page (wave-1 contract §5). */
export const widgetFeedbackStatusUpdate = z.object({
  status: z.enum(["resolved", "open"]),
});
export const REPORTER_TOKEN_HEADER = "x-pinwren-reporter-token";

// --- Notifications ---------------------------------------------------------------------------------

export const NOTIFICATION_TYPES = [
  "feedback.created",
  "feedback.assigned",
  "feedback.status_changed",
  "comment.created",
] as const;

export const notificationPreferenceInput = z.object({
  projectId: z.uuid(),
  newFeedback: z.boolean().optional(),
  assigned: z.boolean().optional(),
  /** Mentions and replies on feedback you are involved in. */
  replies: z.boolean().optional(),
  statusChanges: z.boolean().optional(),
  /** Also send email (in-app notifications are always written). */
  email: z.boolean().optional(),
});
export type NotificationPreferenceInput = z.infer<typeof notificationPreferenceInput>;

export const notificationsRead = z.union([
  z.object({ ids: z.array(z.uuid()).min(1).max(200) }),
  z.object({ all: z.literal(true) }),
]);

// --- Instance settings: email ------------------------------------------------------------------------

export const emailSettingsUpdate = z.object({
  host: z.string().trim().max(253).nullable().optional(),
  port: z.number().int().min(1).max(65535).nullable().optional(),
  user: z.string().trim().max(320).nullable().optional(),
  /** Write-only. A string sets it, null clears it, omitted keeps it. Never returned. */
  password: z.string().max(500).nullable().optional(),
  secure: z.boolean().nullable().optional(),
  from: z.string().trim().max(320).nullable().optional(),
});
export type EmailSettingsUpdate = z.infer<typeof emailSettingsUpdate>;

export const emailTest = z.object({ to: z.email().optional() });

// --- Webhooks ----------------------------------------------------------------------------------------

export const WEBHOOK_EVENTS = [
  "feedback.created",
  "feedback.updated",
  "feedback.status_changed",
  "feedback.assigned",
  "comment.created",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export const WEBHOOK_KINDS = ["generic", "slack", "discord"] as const;

export const webhookCreate = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  url: z.url({ protocol: /^https?$/ }).max(2000),
  kind: z.enum(WEBHOOK_KINDS).default("generic"),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length),
  /** Limit to one project; omitted = every project in the organisation. */
  projectId: z.uuid().nullable().optional(),
  active: z.boolean().default(true),
});
export const webhookUpdate = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  url: z
    .url({ protocol: /^https?$/ })
    .max(2000)
    .optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length).optional(),
  projectId: z.uuid().nullable().optional(),
  active: z.boolean().optional(),
});

// --- API tokens + public API ----------------------------------------------------------------------------

export const API_TOKEN_SCOPES = ["feedback:read", "feedback:write", "comments:write"] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

export const apiTokenCreate = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(API_TOKEN_SCOPES)).min(1).max(API_TOKEN_SCOPES.length),
  /** Days until expiry; omitted = never expires. */
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});

/** Public API comment: always a team comment by the token's owner. */
export const apiCommentCreate = commentCreate;

// --- Branding (F-094): organisation-level dashboard + email branding ---------------------------------

const hex = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a hex colour like #5b5bd6");

export const orgBrandingUpdate = z.object({
  /** Replaces "Pinwren" in the dashboard header and in emails. null = default. */
  productName: z.string().trim().min(1).max(40).nullable().optional(),
  accent: hex.nullable().optional(),
  /** A brand asset uploaded with `POST /api/branding/assets`. null removes the logo. */
  logoAssetId: z.uuid().nullable().optional(),
});
export type OrgBrandingUpdate = z.infer<typeof orgBrandingUpdate>;

export const BRAND_ASSET_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const MAX_BRAND_ASSET_BYTES = 512 * 1024;

export const brandAssetUpload = z.object({
  /** PNG, JPEG or WebP as a base64 data URL, ≤ 512 KB. SVG is refused (it can carry script). */
  dataUrl: z
    .string()
    .regex(/^data:image\/(png|jpeg|webp);base64,/)
    .max(720_000),
});

// --- Email templates (F-020) -------------------------------------------------------------------------

export const EMAIL_TEMPLATE_KEYS = [
  "invitation",
  "feedback_created",
  "feedback_assigned",
  "comment_created",
  "status_changed",
  "reporter_reply",
  "reporter_status",
] as const;
export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

export const emailTemplateUpdate = z.object({
  subject: z.string().trim().min(1).max(200),
  /** Markdown with `{{variable}}` placeholders. Raw HTML is shown as text, never rendered. */
  body: z.string().trim().min(1).max(10_000),
});

export const emailTemplatePreview = z.object({
  subject: z.string().max(200).optional(),
  body: z.string().max(10_000).optional(),
  /** Override sample values (e.g. to see how odd input renders). */
  variables: z.record(z.string(), z.string().max(2000)).optional(),
});

export const emailTemplateTest = emailTemplatePreview.extend({ to: z.email().optional() });

// --- Issue trackers (F-076 GitHub, F-077 GitLab) ------------------------------------------------------

export const ISSUE_PROVIDERS = ["github", "gitlab"] as const;
export type IssueProvider = (typeof ISSUE_PROVIDERS)[number];
/** Which new feedback opens an issue on its own; "manual" = only the "Send to …" button. */
export const ISSUE_AUTO_CREATE = ["manual", "bugs", "all"] as const;

const repoPattern = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)+$/;

export const issueIntegrationCreate = z
  .object({
    provider: z.enum(ISSUE_PROVIDERS),
    /** Personal / project access token. Stored encrypted, never returned. */
    token: z.string().trim().min(8).max(500),
    /** GitHub `owner/name`; GitLab `group/subgroup/project`. */
    repo: z.string().trim().max(300).regex(repoPattern, "Use owner/name (GitLab: group/project)"),
    /** GitHub Enterprise API or self-managed GitLab base URL. null = GITHUB_API_URL / GITLAB_URL. */
    apiUrl: z
      .url({ protocol: /^https?$/ })
      .max(500)
      .nullable()
      .optional(),
    labels: z.array(z.string().trim().min(1).max(50)).max(10).default([]),
    autoCreate: z.enum(ISSUE_AUTO_CREATE).default("manual"),
  })
  .refine((v) => v.provider !== "github" || v.repo.split("/").length === 2, {
    path: ["repo"],
    message: "GitHub repositories are owner/name",
  });

export const issueIntegrationUpdate = z.object({
  token: z.string().trim().min(8).max(500).optional(),
  repo: z.string().trim().max(300).regex(repoPattern, "Use owner/name (GitLab: group/project)").optional(),
  apiUrl: z
    .url({ protocol: /^https?$/ })
    .max(500)
    .nullable()
    .optional(),
  labels: z.array(z.string().trim().min(1).max(50)).max(10).optional(),
  autoCreate: z.enum(ISSUE_AUTO_CREATE).optional(),
  active: z.boolean().optional(),
});

export const issueCreate = z.object({ integrationId: z.uuid() });

// --- Instance security settings ----------------------------------------------------------------------

export const MIN_SESSION_DAYS = 1;
export const MAX_SESSION_DAYS = 90;

export const securitySettingsUpdate = z.object({
  /** Applies to sessions created after the change. */
  sessionDays: z.number().int().min(MIN_SESSION_DAYS).max(MAX_SESSION_DAYS).optional(),
  /** Daily check of the release feed; off on its own whenever a project uses privacy mode. */
  updateCheck: z.boolean().optional(),
});

// --- First-run setup (ADR 0021) -------------------------------------------------------------------------

/** The one-time setup token printed to the server log, claimed by a signed-in user. */
export const setupClaim = z.object({ token: z.string().trim().min(20).max(200) });
