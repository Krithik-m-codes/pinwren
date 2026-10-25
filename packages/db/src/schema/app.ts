import {
  type AnnotationLayer,
  type CaptureGeometry,
  EMAIL_DELIVERY_STATUSES,
  EMAIL_DIGEST_FREQUENCIES,
  FEEDBACK_KINDS,
  FEEDBACK_STATUSES,
  ISSUE_AUTO_CREATE,
  ISSUE_PROVIDERS,
  PRIORITIES,
  type ProjectAiConfig,
  type RejectedOrigin,
  REVIEW_ROUND_STATUSES,
  VIEW_LAYOUTS,
  type WidgetConsent,
  WEBHOOK_KINDS,
} from "@pinwren/core";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export const feedbackKindEnum = pgEnum("feedback_kind", FEEDBACK_KINDS);
export const feedbackStatusEnum = pgEnum("feedback_status", FEEDBACK_STATUSES);
export const priorityEnum = pgEnum("priority", PRIORITIES);
export const commentVisibilityEnum = pgEnum("comment_visibility", ["public", "internal"]);
export const feedbackSourceEnum = pgEnum("feedback_source", ["widget", "extension", "api", "email", "mcp"]);
export const assetKindEnum = pgEnum("asset_kind", [
  "screenshot",
  "screenshot_annotated",
  "annotation_layer",
  "replay",
  "attachment",
  "thumbnail",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

const orgId = () =>
  text("org_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });

export const project = pgTable(
  "project",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    publicKey: text("public_key").notNull().unique(),
    allowedOrigins: text("allowed_origins")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Visitors see the page's pins and public replies. Off by default (wave 5): bug reports stay private. */
    publicRead: boolean("public_read").notNull().default(false),
    widgetConfig: jsonb("widget_config").$type<Record<string, unknown>>().notNull().default({}),
    captureConfig: jsonb("capture_config").$type<Record<string, unknown>>().notNull().default({}),
    feedbackCounter: integer("feedback_counter").notNull().default(0),
    /** Hard-delete feedback older than this many days (`retention.apply` job). null = keep forever. */
    retentionDays: integer("retention_days"),
    /** Email reporters who left an address about team replies and status changes. */
    notifyReporter: boolean("notify_reporter").notNull().default(true),
    /**
     * Notifications › Reporter (BugPin model, wave-5 contract §1): which emails a reporter who left an address
     * gets, under the `notifyReporter` master switch. Public team replies always go out while it is on.
     */
    reporterEmailReceived: boolean("reporter_email_received").notNull().default(true),
    reporterEmailStatus: boolean("reporter_email_status").notNull().default(true),
    reporterEmailPriority: boolean("reporter_email_priority").notNull().default(false),
    reporterEmailAssigned: boolean("reporter_email_assigned").notNull().default(false),
    /**
     * Notifications › General: the members who get new-report notifications. null = every member (each still
     * filtered by their own preferences); a list narrows it to those people.
     */
    notifyMemberIds: text("notify_member_ids").array(),
    /** Notifications › General: extra addresses (not accounts) that get every new-report email. */
    notifyEmails: text("notify_emails")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Widget reports/replies per IP per minute; null = `WIDGET_RATE_LIMIT_PER_MIN`. */
    widgetRateLimitPerMin: integer("widget_rate_limit_per_min"),
    /** Widget branding (wave-3 contract §2): hidePoweredBy, dialogAccent, logoUrl. */
    widgetBranding: jsonb("widget_branding").$type<Record<string, unknown>>().notNull().default({}),
    /** AES-256-GCM ciphertext of the secret that signs webhook panel actions (F-016). */
    actionSecret: text("action_secret"),
    /** AES-256-GCM ciphertext of the signed-identity secret (`identify(..., { signature })`). */
    identitySecret: text("identity_secret"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    /**
     * Origins the `/w` middleware refused for this project's valid key (wave-5 contract §1): newest first,
     * at most 10, written at most once a minute per origin. The Install tab lists them with "Allow".
     */
    rejectedOrigins: jsonb("rejected_origins").$type<RejectedOrigin[]>().notNull().default([]),
    aiConfig: jsonb("ai_config").$type<ProjectAiConfig>().notNull().default({
      enabled: false,
      autoSummary: true,
      autoSeverity: true,
      detectDuplicates: true,
      generateRepro: true,
      allowReplayInAi: false,
    }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("project_org_slug_uq").on(t.orgId, t.slug)],
);

export const page = pgTable(
  "page",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    urlPattern: text("url_pattern"),
    title: text("title"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("page_project_url_uq").on(t.projectId, t.url)],
);

export type ReporterGuest = {
  name?: string | undefined;
  email?: string | undefined;
  externalId?: string | undefined;
  /** The host app signed `externalId` with the project's identity secret (wave-4 contract §4). */
  verified?: boolean | undefined;
};

export const reviewRoundStatusEnum = pgEnum("review_round_status", REVIEW_ROUND_STATUSES);

/** Review rounds (F-055): a named, time-boxed batch of feedback on a project. */
export const reviewRound = pgTable(
  "review_round",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    status: reviewRoundStatusEnum("status").notNull().default("active"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("review_round_project_status_idx").on(t.projectId, t.status)],
);

export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    pageId: uuid("page_id").references(() => page.id, { onDelete: "set null" }),
    number: integer("number").notNull(),
    kind: feedbackKindEnum("kind").notNull(),
    status: feedbackStatusEnum("status").notNull().default("open"),
    priority: priorityEnum("priority").notNull().default("none"),
    title: text("title"),
    body: text("body").notNull(),
    reporterId: text("reporter_id").references(() => user.id, { onDelete: "set null" }),
    reporterGuest: jsonb("reporter_guest").$type<ReporterGuest>(),
    assigneeIds: text("assignee_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    clientId: uuid("client_id").notNull(),
    /** SHA-256 (hex) of the reporter token handed to the widget once; proves "I filed this". */
    reporterTokenHash: text("reporter_token_hash"),
    anchor: jsonb("anchor"),
    environment: jsonb("environment"),
    metadata: jsonb("metadata"),
    source: feedbackSourceEnum("source").notNull().default("widget"),
    roundId: uuid("round_id").references(() => reviewRound.id, { onDelete: "set null" }),
    /** The consent notice the reporter accepted (F-019): `{ version, acceptedAt }`. */
    consent: jsonb("consent").$type<WidgetConsent>(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    /** Due date set in triage (F-051). */
    dueAt: timestamp("due_at", { withTimezone: true }),
    /** Set with status `duplicate`: the item this one duplicates (same project). */
    duplicateOfId: uuid("duplicate_of_id").references((): AnyPgColumn => feedback.id, {
      onDelete: "set null",
    }),
    /** The review link a guest came through (F-012), shown as the item's source and filterable in the inbox. */
    reviewLinkId: uuid("review_link_id").references((): AnyPgColumn => reviewLink.id, {
      onDelete: "set null",
    }),
    search: tsvector("search").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(title, '') || ' ' || body)`,
    ),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("feedback_project_number_uq").on(t.projectId, t.number),
    uniqueIndex("feedback_project_client_uq").on(t.projectId, t.clientId),
    index("feedback_project_status_idx").on(t.projectId, t.status, t.createdAt),
    index("feedback_org_created_idx").on(t.orgId, t.createdAt),
    index("feedback_round_idx").on(t.roundId),
    index("feedback_search_idx").using("gin", t.search),
    index("feedback_duplicate_of_idx").on(t.duplicateOfId),
    index("feedback_review_link_idx").on(t.reviewLinkId),
  ],
);

export const diagnostics = pgTable("diagnostics", {
  feedbackId: uuid("feedback_id")
    .primaryKey()
    .references(() => feedback.id, { onDelete: "cascade" }),
  console: jsonb("console"),
  network: jsonb("network"),
});

export const feedbackAi = pgTable(
  "feedback_ai",
  {
    feedbackId: uuid("feedback_id")
      .primaryKey()
      .references(() => feedback.id, { onDelete: "cascade" }),
    orgId: orgId(),
    // F-110: Auto-summary & refined title
    suggestedTitle: text("suggested_title"),
    summary: text("summary"),
    // F-111: Triage suggestions
    suggestedPriority: priorityEnum("suggested_priority"),
    suggestedKind: feedbackKindEnum("suggested_kind"),
    // F-112: Duplicate detection
    duplicateCandidateId: uuid("duplicate_candidate_id").references((): AnyPgColumn => feedback.id, {
      onDelete: "set null",
    }),
    duplicateConfidence: integer("duplicate_confidence"),
    duplicateReason: text("duplicate_reason"),
    // F-113: Synthesized reproduction steps
    reproductionSteps: text("reproduction_steps")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Telemetry & state
    status: text("status", { enum: ["pending", "completed", "failed", "skipped"] })
      .notNull()
      .default("pending"),
    model: text("model"),
    tokensUsed: integer("tokens_used"),
    error: text("error"),
    ...timestamps,
  },
  (t) => [index("feedback_ai_org_idx").on(t.orgId)],
);

export const feedbackTranslation = pgTable(
  "feedback_translation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    feedbackId: uuid("feedback_id")
      .notNull()
      .references(() => feedback.id, { onDelete: "cascade" }),
    targetLocale: text("target_locale").notNull(),
    title: text("title"),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("feedback_translation_locale_uq").on(t.feedbackId, t.targetLocale)],
);

export const feedbackAsset = pgTable(
  "feedback_asset",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    feedbackId: uuid("feedback_id")
      .notNull()
      .references(() => feedback.id, { onDelete: "cascade" }),
    kind: assetKindEnum("kind").notNull(),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    bytes: integer("bytes").notNull(),
    /** Original file name for attachments (display only; never used as a storage path). */
    name: text("name"),
    /** Kind-specific facts, e.g. a replay's `{ durationMs, events }`. */
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    /** Screenshots: the reporter's vector annotation shapes, drawn over the unflattened capture. */
    annotations: jsonb("annotations").$type<AnnotationLayer>(),
    /** Screenshots: the viewport the capture was taken in (`{ vw, vh, scrollY, mode }`), for Page Review. */
    capture: jsonb("capture").$type<CaptureGeometry>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("asset_feedback_idx").on(t.feedbackId)],
);

export const comment = pgTable(
  "comment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    feedbackId: uuid("feedback_id")
      .notNull()
      .references(() => feedback.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    authorGuest: jsonb("author_guest").$type<ReporterGuest>(),
    body: text("body").notNull(),
    visibility: commentVisibilityEnum("visibility").notNull().default("internal"),
    /** Members @mentioned in a team comment (user ids, checked against the organisation). */
    mentions: text("mentions")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("comment_feedback_idx").on(t.feedbackId, t.createdAt)],
);

export const activity = pgTable(
  "activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    feedbackId: uuid("feedback_id")
      .notNull()
      .references(() => feedback.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    actorKind: text("actor_kind").notNull().default("user"),
    type: text("type").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activity_feedback_idx").on(t.feedbackId, t.createdAt)],
);

/** Fixed-window rate-limit counters (Postgres-only, blueprint 02 — no Redis in self-host). */
export const rateLimit = pgTable("rate_limit", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});

/**
 * Instance-level settings (self-host), e.g. SMTP set in the admin UI. `secret` holds the
 * AES-256-GCM ciphertext of a write-only value (never returned by the API).
 */
export const setting = pgTable("setting", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull().default({}),
  secret: text("secret"),
  updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** Per-user, per-project notification switches. No row = every switch on. */
export const notificationPreference = pgTable(
  "notification_preference",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    newFeedback: boolean("new_feedback").notNull().default(true),
    assigned: boolean("assigned").notNull().default(true),
    replies: boolean("replies").notNull().default(true),
    statusChanges: boolean("status_changes").notNull().default(true),
    mentioned: boolean("mentioned").notNull().default(true),
    priorityChanges: boolean("priority_changes").notNull().default(true),
    email: boolean("email").notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("notification_pref_user_project_uq").on(t.userId, t.projectId)],
);

/** In-app notification inbox. */
export const notification = pgTable(
  "notification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    feedbackId: uuid("feedback_id").references(() => feedback.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    /** The `DomainEvent.id` that produced it: a retried dispatch inserts with ON CONFLICT DO NOTHING. */
    eventId: text("event_id"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notification_user_created_idx").on(t.userId, t.createdAt),
    uniqueIndex("notification_user_event_type_uq").on(t.userId, t.eventId, t.type),
  ],
);

export const emailDigestEnum = pgEnum("email_digest", EMAIL_DIGEST_FREQUENCIES);

/** Account-wide (every organisation) email settings. No row = instant email, not paused. */
export const userPreference = pgTable("user_preference", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** off = one email per notification; hourly/daily = unread notifications grouped by `notify.digest`. */
  emailDigest: emailDigestEnum("email_digest").notNull().default("off"),
  /** Stops every team notification email (the bell still fills). */
  emailPaused: boolean("email_paused").notNull().default(false),
  lastDigestAt: timestamp("last_digest_at", { withTimezone: true }),
  /** Storage key of an uploaded avatar; `user.image` then points at `/api/avatars/:userId`. */
  avatarKey: text("avatar_key"),
  ...timestamps,
});

/** People following an item (F-054): added on create/comment/assign/mention, or with "Follow". */
export const feedbackWatcher = pgTable(
  "feedback_watcher",
  {
    feedbackId: uuid("feedback_id")
      .notNull()
      .references(() => feedback.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.feedbackId, t.userId] }), index("feedback_watcher_user_idx").on(t.userId)],
);

/** Per-project labels (F-051). Names are unique per project, ignoring case. */
export const label = pgTable(
  "label",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Hex colour, e.g. `#e5484d`. */
    color: text("color").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("label_project_name_uq").on(t.projectId, sql`lower(${t.name})`)],
);

export const feedbackLabel = pgTable(
  "feedback_label",
  {
    feedbackId: uuid("feedback_id")
      .notNull()
      .references(() => feedback.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => label.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.feedbackId, t.labelId] }),
    index("feedback_label_label_idx").on(t.labelId),
  ],
);

export type EmailDeliveryPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string> | undefined;
  suppressionOrgId?: string | undefined;
};

export const emailDeliveryStatusEnum = pgEnum("email_delivery_status", EMAIL_DELIVERY_STATUSES);

/**
 * Every email the `notify.email` worker handled: sent, skipped (SMTP unset, unsubscribed) or failed after its
 * retries, so admins can see and resend it. `payload` is the whole message, for the resend. Pruned by a sweep.
 */
export const emailDelivery = pgTable(
  "email_delivery",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** null for instance emails (password reset, verification, test). */
    orgId: text("org_id").references(() => organization.id, { onDelete: "cascade" }),
    toAddress: text("to_address").notNull(),
    /** An `EmailTemplateKey`, or `test`. */
    templateKey: text("template_key").notNull(),
    subject: text("subject").notNull(),
    status: emailDeliveryStatusEnum("status").notNull(),
    error: text("error"),
    attempts: integer("attempts").notNull().default(1),
    payload: jsonb("payload").$type<EmailDeliveryPayload>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("email_delivery_created_idx").on(t.createdAt)],
);

export const webhookKindEnum = pgEnum("webhook_kind", WEBHOOK_KINDS);

export const webhookEndpoint = pgTable(
  "webhook_endpoint",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    /** null = every project in the organisation. */
    projectId: uuid("project_id").references(() => project.id, { onDelete: "cascade" }),
    name: text("name"),
    url: text("url").notNull(),
    kind: webhookKindEnum("kind").notNull().default("generic"),
    events: text("events")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** AES-256-GCM ciphertext of the signing secret (generic) or the access token (ntfy, optional). */
    secret: text("secret"),
    active: boolean("active").notNull().default(true),
    /** First failure of the current failing streak; the endpoint is disabled after 3 days. */
    failingSince: timestamp("failing_since", { withTimezone: true }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("webhook_endpoint_org_idx").on(t.orgId)],
);

/** One row per delivery attempt; attempts of one event share `eventId`. Pruned after 30 days. */
export const webhookDelivery = pgTable(
  "webhook_delivery",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => webhookEndpoint.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull(),
    event: text("event").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    attempt: integer("attempt").notNull().default(1),
    /** pending → success | failed (final) | retrying (another attempt scheduled). */
    status: text("status").notNull().default("pending"),
    responseCode: integer("response_code"),
    responseBody: text("response_body"),
    error: text("error"),
    durationMs: integer("duration_ms"),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    /**
     * The `DomainEvent.id` behind a first attempt (null on retries, tests and redeliveries): a retried
     * dispatch job can't queue the same event to the same endpoint twice.
     */
    domainEventId: text("domain_event_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("webhook_delivery_endpoint_idx").on(t.endpointId, t.createdAt),
    index("webhook_delivery_created_idx").on(t.createdAt),
    uniqueIndex("webhook_delivery_endpoint_event_uq")
      .on(t.endpointId, t.domainEventId)
      .where(sql`domain_event_id is not null`),
  ],
);

/** Personal API tokens for `/api/v1`. Only a scrypt hash is stored; `prefix` identifies it. */
export const apiToken = pgTable(
  "api_token",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    hash: text("hash").notNull(),
    scopes: text("scopes")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("api_token_prefix_uq").on(t.prefix), index("api_token_org_idx").on(t.orgId)],
);

/** Per-organisation settings (branding, …) as JSON by key. */
export const orgSetting = pgTable(
  "org_setting",
  {
    orgId: orgId(),
    key: text("key").notNull(),
    value: jsonb("value").$type<Record<string, unknown>>().notNull().default({}),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.key] })],
);

/**
 * Logos for dashboard, email and widget branding. Served without a session by random id
 * (`/api/brand-assets/:id`) because email clients and third-party pages must load them.
 */
export const brandAsset = pgTable(
  "brand_asset",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    bytes: integer("bytes").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("brand_asset_org_idx").on(t.orgId)],
);

/** Per-organisation overrides of an email template's subject and Markdown body (F-020). */
export const emailTemplate = pgTable(
  "email_template",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    key: text("key").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("email_template_org_key_uq").on(t.orgId, t.key)],
);

export const issueProviderEnum = pgEnum("issue_provider", ISSUE_PROVIDERS);

/**
 * GitHub / GitLab / Linear / Jira issue sync for one project, authenticated by an access token (ADR 0015).
 * `repo` is the repository path, Linear team key or Jira project key; Jira stores `email:apiToken` in `token`.
 */
export const issueIntegration = pgTable(
  "issue_integration",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    provider: issueProviderEnum("provider").notNull(),
    /** AES-256-GCM ciphertext of the access token. */
    token: text("token").notNull(),
    /** Last 4 characters, to recognise the token in the UI. */
    tokenHint: text("token_hint").notNull(),
    repo: text("repo").notNull(),
    /** GitHub Enterprise / self-managed GitLab base URL; null = instance default. */
    apiUrl: text("api_url"),
    labels: text("labels")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    autoCreate: text("auto_create", { enum: ISSUE_AUTO_CREATE }).notNull().default("manual"),
    /** AES-256-GCM ciphertext of the inbound webhook secret (X-Hub-Signature-256 / X-Gitlab-Token). */
    webhookSecret: text("webhook_secret").notNull(),
    active: boolean("active").notNull().default(true),
    lastError: text("last_error"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("issue_integration_project_provider_uq").on(t.projectId, t.provider),
    index("issue_integration_repo_idx").on(t.provider, t.repo),
  ],
);

/** One tracker issue per feedback item and integration. */
export const issueLink = pgTable(
  "issue_link",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    feedbackId: uuid("feedback_id")
      .notNull()
      .references(() => feedback.id, { onDelete: "cascade" }),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => issueIntegration.id, { onDelete: "cascade" }),
    provider: issueProviderEnum("provider").notNull(),
    /** GitHub issue number / GitLab issue iid / the number in a Linear or Jira key (`ENG-12` → 12). */
    number: integer("number").notNull(),
    url: text("url").notNull(),
    state: text("state", { enum: ["open", "closed"] })
      .notNull()
      .default("open"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("issue_link_feedback_integration_uq").on(t.feedbackId, t.integrationId),
    index("issue_link_integration_number_idx").on(t.integrationId, t.number),
  ],
);

export const viewLayoutEnum = pgEnum("view_layout", VIEW_LAYOUTS);

/** Saved inbox filters. Personal unless `shared` (then every member of the organisation sees it). */
export const savedView = pgTable(
  "saved_view",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    filters: jsonb("filters").$type<Record<string, unknown>>().notNull().default({}),
    layout: viewLayoutEnum("layout").notNull().default("list"),
    shared: boolean("shared").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("saved_view_org_idx").on(t.orgId, t.ownerId)],
);

/**
 * Addresses that unsubscribed from an organisation's reporter emails (one-click link,
 * `List-Unsubscribe`). Every reporter email checks this list before it is sent.
 */
export const emailSuppression = pgTable(
  "email_suppression",
  {
    orgId: orgId(),
    /** Lower-cased. */
    email: text("email").notNull(),
    reason: text("reason").notNull().default("unsubscribe"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.email] })],
);

/** Uploaded Enterprise licence files (instance-level; the newest one is in force). */
export const license = pgTable("license", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** The `.lic` text as uploaded: `base64url(payload).base64url(signature)`. */
  raw: text("raw").notNull(),
  /** Decoded payload, for display; always re-verified from `raw`. */
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
  installedBy: text("installed_by").references(() => user.id, { onDelete: "set null" }),
});

/**
 * Review links (F-012): a URL with a token that shows the widget to a guest on a site where visibility rules
 * hide it. Only a SHA-256 of the token is stored; the URL is shown once, at creation.
 */
export const reviewLink = pgTable(
  "review_link",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("review_link_project_idx").on(t.projectId)],
);
