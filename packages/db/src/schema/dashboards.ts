import { type DashboardScope, DASHBOARD_SCOPES, type StoredLayout } from "@pinwren/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";

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

/**
 * A named dashboard (ADR 0033): a layout for one screen, owned by one member of a workspace. `shared` publishes
 * it to the workspace (read-only for everyone else); `default_roles` makes a shared dashboard the starting
 * point for those roles instead of the built-in default. Names are unique per owner and screen, ignoring case.
 */
export const dashboard = pgTable(
  "dashboard",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    scope: text("scope").$type<DashboardScope>().notNull(),
    name: text("name").notNull(),
    layout: jsonb("layout").$type<StoredLayout>().notNull(),
    shared: boolean("shared").notNull().default(false),
    defaultRoles: text("default_roles")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("dashboard_id_org_uq").on(t.id, t.orgId),
    uniqueIndex("dashboard_owner_name_uq").on(t.orgId, t.ownerId, t.scope, sql`lower(${t.name})`),
    index("dashboard_scope_idx").on(t.orgId, t.scope, t.shared),
    check(
      "dashboard_scope_check",
      sql`${t.scope} in (${sql.join(
        DASHBOARD_SCOPES.map((s) => sql.raw(`'${s}'`)),
        sql`, `,
      )})`,
    ),
    check("dashboard_roles_shared_check", sql`${t.shared} or cardinality(${t.defaultRoles}) = 0`),
  ],
);

/**
 * What one member keeps per workspace: the dashboard that opens on each screen and the projects pinned in the
 * sidebar. Account-wide interface state (start page, dismissed prompts) is `user_preference.ui_state`.
 */
export const workspacePreference = pgTable(
  "workspace_preference",
  {
    orgId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** `{ home: <dashboard id>, … }`; a stale id (dashboard deleted or unshared) is ignored when read. */
    dashboardDefaults: jsonb("dashboard_defaults").$type<Record<string, string>>().notNull().default({}),
    pinnedProjectIds: jsonb("pinned_project_ids").$type<string[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);
