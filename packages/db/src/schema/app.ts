import { FEEDBACK_KINDS, FEEDBACK_STATUSES, PRIORITIES } from "@annota/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
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
