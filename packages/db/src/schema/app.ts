import {
  FEEDBACK_KINDS,
  FEEDBACK_STATUSES,
  ISSUE_AUTO_CREATE,
  ISSUE_PROVIDERS,
  PRIORITIES,
  WEBHOOK_KINDS,
} from "@annota/core";
import { sql } from "drizzle-orm";
import {
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
    allowedOrigins: text("allowed_origins").array().notNull().default(sql`'{}'::text[]`),
    publicRead: boolean("public_read").notNull().default(true),
    widgetConfig: jsonb("widget_config").$type<Record<string, unknown>>().notNull().default({}),
    captureConfig: jsonb("capture_config").$type<Record<string, unknown>>().notNull().default({}),
    feedbackCounter: integer("feedback_counter").notNull().default(0),
    /** Hard-delete feedback older than this many days (`retention.apply` job). null = keep forever. */
    retentionDays: integer("retention_days"),
    /** Email reporters who left an address about team replies and status changes. */
    notifyReporter: boolean("notify_reporter").notNull().default(false),
    /** Widget reports/replies per IP per minute; null = `WIDGET_RATE_LIMIT_PER_MIN`. */
    widgetRateLimitPerMin: integer("widget_rate_limit_per_min"),
    /** Widget branding (wave-3 contract §2): hidePoweredBy, dialogAccent, logoUrl. */
    widgetBranding: jsonb("widget_branding").$type<Record<string, unknown>>().notNull().default({}),
    /** AES-256-GCM ciphertext of the secret that signs webhook panel actions (F-016). */
    actionSecret: text("action_secret"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
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

export type ReporterGuest = { name?: string; email?: string; externalId?: string };

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
    assigneeIds: text("assignee_ids").array().notNull().default(sql`'{}'::text[]`),
    clientId: uuid("client_id").notNull(),
    /** SHA-256 (hex) of the reporter token handed to the widget once; proves "I filed this". */
    reporterTokenHash: text("reporter_token_hash"),
    anchor: jsonb("anchor"),
    environment: jsonb("environment"),
    metadata: jsonb("metadata"),
    source: feedbackSourceEnum("source").notNull().default("widget"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
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
    index("feedback_search_idx").using("gin", t.search),
  ],
);

export const diagnostics = pgTable("diagnostics", {
  feedbackId: uuid("feedback_id")
    .primaryKey()
    .references(() => feedback.id, { onDelete: "cascade" }),
  console: jsonb("console"),
  network: jsonb("network"),
});

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
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notification_user_created_idx").on(t.userId, t.createdAt)],
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
    events: text("events").array().notNull().default(sql`'{}'::text[]`),
    /** AES-256-GCM ciphertext of the signing secret (generic endpoints). */
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("webhook_delivery_endpoint_idx").on(t.endpointId, t.createdAt),
    index("webhook_delivery_created_idx").on(t.createdAt),
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
    scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
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

/** GitHub / GitLab issue sync for one project, authenticated by an access token (ADR 0015). */
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
    labels: text("labels").array().notNull().default(sql`'{}'::text[]`),
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
    /** GitHub issue number / GitLab issue iid. */
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
