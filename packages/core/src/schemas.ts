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

/**
 * What people see for each kind everywhere (widget chips, dashboard, emails, webhooks, exports). The stored
 * values stay `comment`/`idea` for compatibility, but they read as "Other" and "Change", as in the widget.
 */
export const KIND_LABELS: Record<FeedbackKind, string> = {
  question: "Question",
  idea: "Change",
  bug: "Bug",
  comment: "Other",
};
/** The kind as a noun in a sentence: "New bug report from Maria", "a change request". */
export const KIND_NOUNS: Record<FeedbackKind, string> = {
  question: "question",
  idea: "change request",
  bug: "bug report",
  comment: "feedback",
};
export const kindLabel = (k: string): string => (KIND_LABELS as Partial<Record<string, string>>)[k] ?? k;
export const kindNoun = (k: string): string =>
  (KIND_NOUNS as Partial<Record<string, string>>)[k] ?? "feedback";

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

// --- Widget: annotation layer + capture geometry (wave-5 contract §1) ---------------------------------

export const ANNOTATION_TOOLS = [
  "rect",
  "ellipse",
  "arrow",
  "pen",
  "text",
  "blur",
  "crop",
  "highlighter",
  "step",
] as const;
export type AnnotationTool = (typeof ANNOTATION_TOOLS)[number];
export const ANNOTATION_SIZES = ["s", "m", "l"] as const;
/** Largest annotation layer, as serialised JSON. */
export const MAX_ANNOTATION_BYTES = 65_536;

const point = z.object({ x: z.number(), y: z.number() });
const shapeBase = {
  color: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/),
  size: z.enum(ANNOTATION_SIZES),
};

/** One shape in canvas pixels of the unflattened screenshot (mirrors `packages/widget/src/shapes.ts`). */
export const annotationShape = z.union([
  z.object({ tool: z.enum(["rect", "ellipse", "arrow", "blur", "crop"]), ...shapeBase, a: point, b: point }),
  z.object({ tool: z.enum(["pen", "highlighter"]), ...shapeBase, points: z.array(point).min(1).max(2000) }),
  z.object({
    tool: z.literal("text"),
    ...shapeBase,
    at: point,
    text: z.string().max(500),
    px: z.number().positive().max(400),
  }),
  /** Numbered step marker. */
  z.object({ tool: z.literal("step"), ...shapeBase, at: point, n: z.number().int().min(1).max(99) }),
]);
export type AnnotationShape = z.infer<typeof annotationShape>;

/** The vector layer drawn over a screenshot; `width`/`height` are the canvas size the shapes refer to. */
export const annotationLayer = z
  .object({
    v: z.literal(1),
    width: z.number().int().min(1).max(32_767),
    height: z.number().int().min(1).max(32_767),
    shapes: z.array(annotationShape).max(200),
  })
  .refine((l) => JSON.stringify(l).length <= MAX_ANNOTATION_BYTES, {
    message: `annotations must be at most ${MAX_ANNOTATION_BYTES} bytes of JSON`,
  });
export type AnnotationLayer = z.infer<typeof annotationLayer>;

export const CAPTURE_MODES = ["visible", "full", "element", "screen"] as const;

/** Where a screenshot was taken, independent of any anchor: Page Review places it with this. */
export const captureGeometry = z.object({
  vw: z.number().int().min(1).max(20_000),
  vh: z.number().int().min(1).max(20_000),
  scrollY: z.number().min(0),
  mode: z.enum(CAPTURE_MODES),
});
export type CaptureGeometry = z.infer<typeof captureGeometry>;

// --- Widget: create feedback (blueprint 04 §2) ------------------------------------------------------

/** Largest `metadata` object a report may carry, as serialised JSON. */
export const MAX_METADATA_BYTES = 16_384;

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
  /** Host-supplied context (`Pinwren.setMetadata`) plus the widget's timings. Capped (blueprint 04 §2):
   *  unbounded, any visitor could store megabytes of JSON with every report. */
  metadata: z
    .record(z.string(), z.unknown())
    .refine((m) => JSON.stringify(m).length <= MAX_METADATA_BYTES, {
      message: `metadata must be at most ${MAX_METADATA_BYTES} bytes of JSON`,
    })
    .optional(),
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
  /** Vector shapes over `screenshot` (which is then the unflattened capture). Stored on the screenshot asset. */
  annotations: annotationLayer.optional(),
  /** The viewport `screenshot` was taken in. Stored on the screenshot asset. */
  capture: captureGeometry.optional(),
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

/** A refused widget origin recorded on the project (`project.rejected_origins`, newest first, ≤ 10). */
export const rejectedOrigin = z.object({
  origin: z.string().max(300),
  /** Last refusal, ISO 8601. */
  at: z.string(),
  /** Refusals counted (throttled writes: at most one per minute per origin). */
  count: z.number().int().min(1),
});
export type RejectedOrigin = z.infer<typeof rejectedOrigin>;
export const MAX_REJECTED_ORIGINS = 10;

// --- Labels (F-051, wave-5 contract §2) --------------------------------------------------------------

export const MAX_LABELS_PER_PROJECT = 100;
export const MAX_LABELS_PER_ITEM = 20;

export const labelCreate = z.object({
  name: z.string().trim().min(1, "Give the label a name").max(40),
  color: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a hex colour like #e5484d"),
});
export type LabelCreate = z.infer<typeof labelCreate>;
export const labelUpdate = labelCreate.partial();
export type LabelUpdate = z.infer<typeof labelUpdate>;

export const feedbackUpdate = z.object({
  status: feedbackStatus.optional(),
  priority: priority.optional(),
  title: z.string().trim().max(200).nullable().optional(),
  assigneeIds: z.array(z.string()).max(20).optional(),
  /** Move into a review round of the same project, or out of any (null). */
  roundId: z.uuid().nullable().optional(),
  /** Replaces the item's labels (labels of the same project). */
  labelIds: z.array(z.uuid()).max(MAX_LABELS_PER_ITEM).optional(),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  /** The item this one duplicates (same project, not itself); set it together with status `duplicate`. */
  duplicateOfId: z.uuid().nullable().optional(),
  /** Convert between comment / bug / idea / question. */
  kind: feedbackKind.optional(),
});
export type FeedbackUpdate = z.infer<typeof feedbackUpdate>;

export const FEEDBACK_SORTS = ["created", "updated", "priority"] as const;
export const SORT_ORDERS = ["asc", "desc"] as const;

/** A query-string boolean: `true`/`1` or `false`/`0` (JSON callers may send a real boolean). */
const queryBool = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((v) => v === true || v === "true" || v === "1");

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
  /** Only items carrying this label. */
  labelId: z.uuid().optional(),
  /** Only items sent by guests who came through this review link. */
  reviewLinkId: z.uuid().optional(),
  /** Reporter name or email contains this text. */
  reporter: z.string().trim().max(254).optional(),
  /** Only items with (true) or without (false) a session replay. */
  hasReplay: queryBool.optional(),
  /** Browser name contains this text (from the captured environment), e.g. `Safari`. */
  browser: z.string().trim().max(60).optional(),
  /** Deleted items (the trash) instead of live ones. Org admins only; others get 403. */
  trash: queryBool.optional(),
  sort: z.enum(FEEDBACK_SORTS).default("created"),
  order: z.enum(SORT_ORDERS).default("desc"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type FeedbackListQuery = z.infer<typeof feedbackListQuery>;
export type FeedbackListQueryInput = z.input<typeof feedbackListQuery>;

export const MAX_MENTIONS = 20;

export const commentCreate = z.object({
  body: z.string().trim().min(1).max(10_000),
  visibility: z.enum(COMMENT_VISIBILITIES).default("internal"),
  /** Member user ids @mentioned in the body (the composer resolves names); others are refused (400). */
  mentions: z.array(z.string().min(1).max(100)).max(MAX_MENTIONS).optional(),
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
/** `GET /w/mine`: the reporter tokens the widget holds for this project, comma-separated (≤ 50). */
export const REPORTER_TOKENS_HEADER = "x-pinwren-reporter-tokens";
export const MAX_REPORTER_TOKENS = 50;
/** Deep-link query parameters: `?pinwren=<feedbackId>&pwt=<page-link token>` (wave-5 contract §3). */
export const DEEP_LINK_PARAM = "pinwren";
export const PAGE_LINK_TOKEN_PARAM = "pwt";
/** `GET /w/feedback/:id` sends the `pwt` token in this header. */
export const PAGE_LINK_TOKEN_HEADER = "x-pinwren-link-token";

// --- Notifications ---------------------------------------------------------------------------------

export const NOTIFICATION_TYPES = [
  "feedback.created",
  "feedback.assigned",
  "feedback.status_changed",
  "feedback.priority_changed",
  "feedback.deleted",
  "comment.created",
  "comment.mentioned",
  "webhook.disabled",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const notificationPreferenceInput = z.object({
  projectId: z.uuid(),
  newFeedback: z.boolean().optional(),
  assigned: z.boolean().optional(),
  /** Replies on feedback you are involved in or follow. */
  replies: z.boolean().optional(),
  statusChanges: z.boolean().optional(),
  /** Someone @mentioned you. */
  mentioned: z.boolean().optional(),
  priorityChanges: z.boolean().optional(),
  /** Also send email (in-app notifications are always written). */
  email: z.boolean().optional(),
});
export type NotificationPreferenceInput = z.infer<typeof notificationPreferenceInput>;

export const notificationsRead = z.union([
  z.object({ ids: z.array(z.uuid()).min(1).max(200) }),
  /** Every unread notification about one item (sent when the detail pane opens it). */
  z.object({ feedbackId: z.uuid() }),
  z.object({ all: z.literal(true) }),
]);

export const EMAIL_DIGEST_FREQUENCIES = ["off", "hourly", "daily"] as const;
export type EmailDigestFrequency = (typeof EMAIL_DIGEST_FREQUENCIES)[number];

/** `PATCH /api/me/preferences`: account-wide email settings (`user_preference`). */
export const userPreferenceUpdate = z.object({
  emailDigest: z.enum(EMAIL_DIGEST_FREQUENCIES).optional(),
  emailPaused: z.boolean().optional(),
});
export type UserPreferenceUpdate = z.infer<typeof userPreferenceUpdate>;

/**
 * Notifications › General and › Reporter for one project (BugPin model, wave-5 contract §3.2):
 * `GET`/`PATCH /api/projects/:id/notifications`. Stored on `project` (`notify_member_ids`, `notify_emails`,
 * `notify_reporter`, `reporter_email_*`).
 */
export const MAX_NOTIFY_EMAILS = 20;
export const projectNotifications = z.object({
  /** Members who get new-report notifications; null = every member (each filtered by their own preferences). */
  memberIds: z.array(z.string().min(1).max(100)).max(200).nullable(),
  /** Extra addresses (people without an account) that get every new-report email. */
  emails: z.array(z.email().max(254)).max(MAX_NOTIFY_EMAILS),
  reporter: z.object({
    /** Master switch (`project.notify_reporter`): no reporter email at all when off. Public replies go out when on. */
    enabled: z.boolean(),
    /** "We received your report" right after it is sent. */
    received: z.boolean(),
    statusChanged: z.boolean(),
    priorityChanged: z.boolean(),
    /** Someone on the team was assigned to their report. */
    assigned: z.boolean(),
  }),
});
export type ProjectNotifications = z.infer<typeof projectNotifications>;

/** `PATCH /api/projects/:id/notifications`: any subset; `reporter` merges field by field. */
export const projectNotificationsUpdate = z.object({
  memberIds: projectNotifications.shape.memberIds.optional(),
  emails: projectNotifications.shape.emails.optional(),
  reporter: projectNotifications.shape.reporter.partial().optional(),
});
export type ProjectNotificationsUpdate = z.infer<typeof projectNotificationsUpdate>;

// --- Instance settings: email ------------------------------------------------------------------------

export const emailSettingsUpdate = z.object({
  host: z.string().trim().max(253).nullable().optional(),
  port: z.number().int().min(1).max(65535).nullable().optional(),
  user: z.string().trim().max(320).nullable().optional(),
  /** Write-only. A string sets it, null clears it, omitted keeps it. Never returned. */
  password: z.string().max(500).nullable().optional(),
  secure: z.boolean().nullable().optional(),
  from: z.string().trim().max(320).nullable().optional(),
  /** Refuse to send unless the server upgrades with STARTTLS (ports 587/25). */
  requireTls: z.boolean().nullable().optional(),
  /** Accept a self-signed or otherwise unverifiable server certificate. */
  allowSelfSigned: z.boolean().nullable().optional(),
});
export type EmailSettingsUpdate = z.infer<typeof emailSettingsUpdate>;

export const emailTest = z.object({
  to: z.email().optional(),
  /** Unsaved form values to test instead of the saved ones (omitted password = the saved one). */
  config: emailSettingsUpdate.optional(),
});

export const EMAIL_DELIVERY_STATUSES = ["sent", "skipped", "failed"] as const;
export type EmailDeliveryStatus = (typeof EMAIL_DELIVERY_STATUSES)[number];

// --- Webhooks ----------------------------------------------------------------------------------------

export const WEBHOOK_EVENTS = [
  "feedback.created",
  "feedback.updated",
  "feedback.status_changed",
  "feedback.assigned",
  "feedback.priority_changed",
  "feedback.labels_changed",
  "feedback.deleted",
  "comment.created",
  "comment.updated",
  "comment.deleted",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
/**
 * generic: signed JSON. slack / discord / teams: the chat's incoming-webhook URL (Teams: a Workflows
 * "post to a channel when a webhook request is received" URL). telegram: a bot token + chat id. ntfy: a
 * topic URL plus an optional access token. Every kind except generic stores its URL encrypted.
 */
export const WEBHOOK_KINDS = ["generic", "slack", "discord", "teams", "telegram", "ntfy"] as const;
export type WebhookKind = (typeof WEBHOOK_KINDS)[number];

/** A Telegram bot token as @BotFather issues it: `<bot id>:<secret>`. */
export const TELEGRAM_BOT_TOKEN = /^\d{3,20}:[A-Za-z0-9_-]{30,100}$/;
/** A chat id (`-100…` for channels and supergroups) or a public `@channelname`. */
export const TELEGRAM_CHAT_ID = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/;

const webhookUrl = z.url({ protocol: /^https?$/ }).max(2000);
const telegramBotToken = z.string().trim().regex(TELEGRAM_BOT_TOKEN, "A bot token looks like 123456789:AA…");
const telegramChatId = z
  .string()
  .trim()
  .regex(TELEGRAM_CHAT_ID, "A numeric chat id (e.g. -1001234567890) or @channelname");
/** ntfy access token (`tk_…`) or `user:password`; sent as Bearer / Basic auth. */
const ntfyAccessToken = z.string().trim().min(4).max(200);

export const webhookCreate = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    /** Every kind except telegram (which is built from `botToken` + `chatId`). */
    url: webhookUrl.optional(),
    kind: z.enum(WEBHOOK_KINDS).default("generic"),
    events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length),
    /** Limit to one project; omitted = every project in the organisation. */
    projectId: z.uuid().nullable().optional(),
    active: z.boolean().default(true),
    /** telegram only. Stored encrypted, never returned. */
    botToken: telegramBotToken.optional(),
    /** telegram only. */
    chatId: telegramChatId.optional(),
    /** ntfy only, optional (protected topics). Stored encrypted, never returned. */
    accessToken: ntfyAccessToken.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "telegram") {
      if (!v.botToken) ctx.addIssue({ code: "custom", path: ["botToken"], message: "Paste the bot token" });
      if (!v.chatId) ctx.addIssue({ code: "custom", path: ["chatId"], message: "Enter the chat id" });
    } else if (!v.url) {
      ctx.addIssue({ code: "custom", path: ["url"], message: "Enter the URL" });
    }
    if (v.kind !== "telegram" && (v.botToken !== undefined || v.chatId !== undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["botToken"],
        message: "Only Telegram webhooks take a bot token",
      });
    }
    if (v.kind !== "ntfy" && v.accessToken !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["accessToken"],
        message: "Only ntfy webhooks take an access token",
      });
    }
  });
export type WebhookCreate = z.infer<typeof webhookCreate>;

/** Kind-specific fields are checked against the stored kind by the route. */
export const webhookUpdate = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  url: webhookUrl.optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length).optional(),
  projectId: z.uuid().nullable().optional(),
  active: z.boolean().optional(),
  /** telegram: replace the bot token (the chat id is kept unless sent too). */
  botToken: telegramBotToken.optional(),
  /** telegram: move to another chat (the bot token is kept). */
  chatId: telegramChatId.optional(),
  /** ntfy: set or (null) remove the access token. */
  accessToken: ntfyAccessToken.nullable().optional(),
});
export type WebhookUpdate = z.infer<typeof webhookUpdate>;

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
  "password_reset",
  "verify_email",
  "change_email",
  "magic_link",
  "mentioned",
  "priority_changed",
  "feedback_deleted",
  "digest",
  "reporter_received",
  "reporter_priority",
  "reporter_assigned",
  "webhook_disabled",
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

// --- Issue trackers (F-076 GitHub, F-077 GitLab, F-078 Linear, F-079 Jira Cloud) ------------------------

export const ISSUE_PROVIDERS = ["github", "gitlab", "linear", "jira"] as const;
export type IssueProvider = (typeof ISSUE_PROVIDERS)[number];
/** Which new feedback opens an issue on its own; "manual" = only the "Send to …" button. */
export const ISSUE_AUTO_CREATE = ["manual", "bugs", "all"] as const;

const repoPattern = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)+$/;
/** A Linear team key (`ENG`) or a Jira project key (`WEB`). */
const keyPattern = /^[A-Za-z][A-Za-z0-9_]{0,9}$/;

/**
 * What `repo` holds for each provider, and why a value is refused (null = valid). GitHub: `owner/name`;
 * GitLab: `group/subgroup/project`; Linear: the team key; Jira: the project key.
 */
export function trackerRepoError(provider: IssueProvider, repo: string): string | null {
  if (provider === "linear" || provider === "jira") {
    return keyPattern.test(repo)
      ? null
      : provider === "linear"
        ? "Use the team key, like ENG"
        : "Use the project key, like WEB";
  }
  if (!repoPattern.test(repo)) return "Use owner/name (GitLab: group/project)";
  if (provider === "github" && repo.split("/").length !== 2) return "GitHub repositories are owner/name";
  return null;
}

/** Linear team keys and Jira project keys are upper case; repository paths are kept as typed. */
export const normalizeTrackerRepo = (provider: IssueProvider, repo: string): string =>
  provider === "linear" || provider === "jira" ? repo.trim().toUpperCase() : repo.trim();

const trackerUrl = z.url({ protocol: /^https?$/ }).max(500);
/** Inbound webhook signing secret supplied by the tracker (Linear generates its own). */
const trackerWebhookSecret = z.string().trim().min(16).max(200);

export const issueIntegrationCreate = z
  .object({
    provider: z.enum(ISSUE_PROVIDERS),
    /** Personal / project access token, Linear API key or Jira API token. Stored encrypted, never returned. */
    token: z.string().trim().min(8).max(500),
    /** GitHub `owner/name`; GitLab `group/subgroup/project`; Linear team key; Jira project key. */
    repo: z.string().trim().min(1).max(300),
    /**
     * GitHub Enterprise API or self-managed GitLab base URL (null = GITHUB_API_URL / GITLAB_URL). Jira: the
     * site URL, required (`https://acme.atlassian.net`). Linear: unused.
     */
    apiUrl: trackerUrl.nullable().optional(),
    /** Jira only: the Atlassian account email the API token belongs to. */
    email: z.email().max(254).optional(),
    labels: z.array(z.string().trim().min(1).max(50)).max(10).default([]),
    autoCreate: z.enum(ISSUE_AUTO_CREATE).default("manual"),
    /** Linear: the signing secret Linear shows for the webhook. Others: generated by Pinwren. */
    webhookSecret: trackerWebhookSecret.optional(),
  })
  .superRefine((v, ctx) => {
    const repoError = trackerRepoError(v.provider, v.repo);
    if (repoError) ctx.addIssue({ code: "custom", path: ["repo"], message: repoError });
    if (v.provider === "jira") {
      if (!v.apiUrl) ctx.addIssue({ code: "custom", path: ["apiUrl"], message: "Enter your Jira site URL" });
      if (!v.email) ctx.addIssue({ code: "custom", path: ["email"], message: "Enter the account email" });
    } else if (v.email !== undefined) {
      ctx.addIssue({ code: "custom", path: ["email"], message: "Only Jira takes an account email" });
    }
    if (v.provider === "linear" && v.apiUrl) {
      ctx.addIssue({ code: "custom", path: ["apiUrl"], message: "Linear has no self-hosted URL" });
    }
  });

/** `repo` and `email` are checked against the stored provider by the route. */
export const issueIntegrationUpdate = z.object({
  token: z.string().trim().min(8).max(500).optional(),
  repo: z.string().trim().min(1).max(300).optional(),
  apiUrl: trackerUrl.nullable().optional(),
  email: z.email().max(254).optional(),
  labels: z.array(z.string().trim().min(1).max(50)).max(10).optional(),
  autoCreate: z.enum(ISSUE_AUTO_CREATE).optional(),
  active: z.boolean().optional(),
  /** Replace the inbound webhook secret with the one the tracker shows (Linear). */
  webhookSecret: trackerWebhookSecret.optional(),
});

export const issueCreate = z.object({ integrationId: z.uuid() });

// --- Review links (F-012, wave-5 contract §3) ----------------------------------------------------------

/** Query parameter a review link adds to the site URL; the widget shows itself when it carries a valid token. */
export const REVIEW_LINK_PARAM = "pinwren_review";
/**
 * The widget sends a review link's token in this header: `GET /w/review-link` checks it, and reports sent with
 * a valid one record the link as their source.
 */
export const REVIEW_TOKEN_HEADER = "x-pinwren-review-token";
/** A review token as handed out (`pwr_` + 32 base64url characters); anything else is refused unchecked. */
export const REVIEW_TOKEN_RE = /^pwr_[\w-]{16,100}$/;

export const reviewLinkCreate = z.object({
  label: z.string().trim().min(1, "Give the link a name").max(80),
  /** The site page the link opens (an allowed origin of the project). */
  url: z.url({ protocol: /^https?$/ }).max(2000),
  /** Days until it stops working; omitted = never expires (revoke it instead). */
  expiresInDays: z.number().int().min(1).max(365).optional(),
});
export type ReviewLinkCreate = z.infer<typeof reviewLinkCreate>;

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
