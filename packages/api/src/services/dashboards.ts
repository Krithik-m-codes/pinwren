import {
  type ApiDashboard,
  APP_ROLES,
  type AppRole,
  type DashboardCreate,
  type DashboardScope,
  type DashboardUpdate,
  MAX_DASHBOARDS_PER_SCOPE,
  MAX_SHARED_PER_SCOPE,
  mergeUiState,
  readUiState,
  type UiState,
  type UiStateUpdate,
  type WorkspacePreferences,
  type WorkspacePreferenceUpdate,
} from "@pinwren/core";
import { dashboard, getDb, project, user, userPreference, workspacePreference } from "@pinwren/db";
import { identityDatabase } from "@pinwren/db/identity";
import { and, asc, count, eq, inArray, isNull, or } from "drizzle-orm";
import { isOrgAdmin } from "../context";
import { env } from "../env";
import { ApiError, forbidden, notFound } from "../errors";
import { isReadOnlyRole, readOnlyError } from "../permissions";

// Named, shareable dashboards (ADR 0029). Every query names the caller's organisation; a dashboard is visible
// to its owner and, when shared, to the whole workspace, but only its owner (or an Admin, for a shared one)
// may change it.

type Row = typeof dashboard.$inferSelect;

const out = (row: Row, me: string, ownerName: string | null): ApiDashboard => ({
  id: row.id,
  scope: row.scope,
  name: row.name,
  layout: row.layout,
  shared: row.shared,
  defaultRoles: row.defaultRoles.filter((r): r is AppRole => (APP_ROLES as readonly string[]).includes(r)),
  ownerId: row.ownerId,
  ownerName,
  mine: row.ownerId === me,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const nameTaken = () =>
  new ApiError(409, "DASHBOARD_EXISTS", "You already have a dashboard with that name on this screen");

const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return (e.cause?.code ?? e.code) === "23505";
};

/** Own dashboards first (oldest first), then the workspace's shared ones. */
export async function listDashboards(orgId: string, userId: string, scope: DashboardScope) {
  const rows = await getDb()
    .select({ d: dashboard, ownerName: user.name })
    .from(dashboard)
    .leftJoin(user, eq(user.id, dashboard.ownerId))
    .where(
      and(
        eq(dashboard.orgId, orgId),
        eq(dashboard.scope, scope),
        or(eq(dashboard.shared, true), eq(dashboard.ownerId, userId)),
      ),
    )
    .orderBy(asc(dashboard.createdAt), asc(dashboard.name));
  const mine = rows.filter((r) => r.d.ownerId === userId);
  const others = rows.filter((r) => r.d.ownerId !== userId);
  return [...mine, ...others].map((r) => out(r.d, userId, r.ownerName));
}

async function visible(orgId: string, userId: string, id: string): Promise<Row> {
  const [row] = await getDb()
    .select()
    .from(dashboard)
    .where(
      and(
        eq(dashboard.id, id),
        eq(dashboard.orgId, orgId),
        or(eq(dashboard.shared, true), eq(dashboard.ownerId, userId)),
      ),
    );
  if (!row) throw notFound("Dashboard");
  return row;
}

type Caller = { orgId: string; userId: string; role: string };

/** The owner may change a dashboard; an Admin may also change a shared one. */
function assertMayChange(row: Row, c: Caller) {
  if (row.ownerId === c.userId) return;
  if (row.shared && isOrgAdmin(c.role)) return;
  throw forbidden("Only the owner or an admin can change a shared dashboard");
}

function assertMayPublish(c: Caller) {
  if (isReadOnlyRole(c.role)) throw readOnlyError();
  if (!isOrgAdmin(c.role)) throw forbidden("Only workspace admins can publish a dashboard");
}

async function assertRoom(c: Caller, scope: DashboardScope, shared: boolean) {
  const [n] = await getDb()
    .select({ n: count() })
    .from(dashboard)
    .where(
      and(
        eq(dashboard.orgId, c.orgId),
        eq(dashboard.scope, scope),
        shared ? eq(dashboard.shared, true) : eq(dashboard.ownerId, c.userId),
      ),
    );
  const max = shared ? MAX_SHARED_PER_SCOPE : MAX_DASHBOARDS_PER_SCOPE;
  if ((n?.n ?? 0) >= max) {
    throw new ApiError(
      409,
      "DASHBOARD_LIMIT",
      shared
        ? `A workspace can share ${max} dashboards per screen`
        : `You can keep ${max} dashboards per screen`,
    );
  }
}

/** A role starts on at most one shared dashboard per screen: giving it to this one takes it from the others. */
async function takeRoles(orgId: string, scope: DashboardScope, id: string, roles: readonly string[]) {
  if (roles.length === 0) return;
  const db = getDb();
  const holders = await db
    .select({ id: dashboard.id, roles: dashboard.defaultRoles })
    .from(dashboard)
    .where(and(eq(dashboard.orgId, orgId), eq(dashboard.scope, scope), eq(dashboard.shared, true)));
  for (const h of holders) {
    if (h.id === id || !h.roles.some((r) => roles.includes(r))) continue;
    await db
      .update(dashboard)
      .set({ defaultRoles: h.roles.filter((r) => !roles.includes(r)) })
      .where(and(eq(dashboard.id, h.id), eq(dashboard.orgId, orgId)));
  }
}

export async function createDashboard(c: Caller, body: DashboardCreate): Promise<ApiDashboard> {
  const shared = body.shared === true;
  if (shared) assertMayPublish(c);
  else if (body.defaultRoles?.length) throw forbidden("Only a shared dashboard can be a role default");
  await assertRoom(c, body.scope, shared);
  try {
    const [row] = await getDb()
      .insert(dashboard)
      .values({
        orgId: c.orgId,
        ownerId: c.userId,
        scope: body.scope,
        name: body.name,
        layout: body.layout,
        shared,
        defaultRoles: shared ? [...new Set(body.defaultRoles ?? [])] : [],
      })
      .returning();
    if (!row) throw new Error("dashboard insert failed");
    if (shared) await takeRoles(c.orgId, body.scope, row.id, row.defaultRoles);
    return out(row, c.userId, null);
  } catch (e) {
    if (isUniqueViolation(e)) throw nameTaken();
    throw e;
  }
}

export async function updateDashboard(c: Caller, id: string, patch: DashboardUpdate): Promise<ApiDashboard> {
  const row = await visible(c.orgId, c.userId, id);
  assertMayChange(row, c);
  if (isReadOnlyRole(c.role) && row.shared) throw readOnlyError();
  const shared = patch.shared ?? row.shared;
  if (patch.shared !== undefined && patch.shared !== row.shared) {
    assertMayPublish(c);
    await assertRoom(c, row.scope, patch.shared);
  }
  if (!shared && patch.defaultRoles?.length) throw forbidden("Only a shared dashboard can be a role default");
  if (patch.defaultRoles !== undefined && shared) assertMayPublish(c);
  const set: Partial<typeof dashboard.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.layout !== undefined) set.layout = patch.layout;
  if (patch.shared !== undefined) set.shared = patch.shared;
  // Unpublishing drops the role defaults; otherwise they change only when the request names them.
  if (!shared) set.defaultRoles = [];
  else if (patch.defaultRoles !== undefined) set.defaultRoles = [...new Set(patch.defaultRoles)];
  if (Object.keys(set).length === 0) return out(row, c.userId, null);
  try {
    const [next] = await getDb()
      .update(dashboard)
      .set(set)
      .where(and(eq(dashboard.id, id), eq(dashboard.orgId, c.orgId)))
      .returning();
    if (!next) throw notFound("Dashboard");
    if (next.shared) await takeRoles(c.orgId, next.scope, next.id, next.defaultRoles);
    return out(next, c.userId, null);
  } catch (e) {
    if (isUniqueViolation(e)) throw nameTaken();
    throw e;
  }
}

export async function deleteDashboard(c: Caller, id: string): Promise<void> {
  const row = await visible(c.orgId, c.userId, id);
  assertMayChange(row, c);
  if (isReadOnlyRole(c.role) && row.shared) throw readOnlyError();
  await getDb()
    .delete(dashboard)
    .where(and(eq(dashboard.id, id), eq(dashboard.orgId, c.orgId)));
  // Defaults naming it are ignored when read and cleaned up as people next save.
}

/** "<name> copy", then "<name> copy 2"…, the first that the caller does not already have on this screen. */
async function freeName(c: Caller, scope: DashboardScope, base: string): Promise<string> {
  const taken = await getDb()
    .select({ name: dashboard.name })
    .from(dashboard)
    .where(and(eq(dashboard.orgId, c.orgId), eq(dashboard.ownerId, c.userId), eq(dashboard.scope, scope)));
  const lower = new Set(taken.map((t) => t.name.toLowerCase()));
  for (let n = 1; n < 100; n++) {
    const suffix = n === 1 ? " copy" : ` copy ${n}`;
    const name = `${base.slice(0, 60 - suffix.length)}${suffix}`;
    if (!lower.has(name.toLowerCase())) return name;
  }
  return `${base.slice(0, 40)} ${Date.now()}`;
}

/** A personal copy of any dashboard the caller can see ("Duplicate to my dashboards"). */
export async function duplicateDashboard(c: Caller, id: string, name?: string): Promise<ApiDashboard> {
  const row = await visible(c.orgId, c.userId, id);
  await assertRoom(c, row.scope, false);
  const chosen = name ?? (await freeName(c, row.scope, row.name));
  try {
    const [copy] = await getDb()
      .insert(dashboard)
      .values({
        orgId: c.orgId,
        ownerId: c.userId,
        scope: row.scope,
        name: chosen,
        layout: row.layout,
        shared: false,
        defaultRoles: [],
      })
      .returning();
    if (!copy) throw new Error("dashboard insert failed");
    return out(copy, c.userId, null);
  } catch (e) {
    if (isUniqueViolation(e)) throw nameTaken();
    throw e;
  }
}

// --- Per-workspace preferences (default dashboard per screen, pinned projects) -------------------------

export async function workspacePreferences(orgId: string, userId: string): Promise<WorkspacePreferences> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(workspacePreference)
    .where(and(eq(workspacePreference.orgId, orgId), eq(workspacePreference.userId, userId)));
  const defaults: WorkspacePreferences["dashboardDefaults"] = {};
  const stored = row?.dashboardDefaults ?? {};
  const ids = [...new Set(Object.values(stored))];
  if (ids.length) {
    // Only defaults that still name a dashboard this person can see.
    const live = await db
      .select({ id: dashboard.id, scope: dashboard.scope })
      .from(dashboard)
      .where(
        and(
          eq(dashboard.orgId, orgId),
          inArray(dashboard.id, ids),
          or(eq(dashboard.shared, true), eq(dashboard.ownerId, userId)),
        ),
      );
    for (const d of live) if (stored[d.scope] === d.id) defaults[d.scope] = d.id;
  }
  let pinned = Array.isArray(row?.pinnedProjectIds)
    ? row.pinnedProjectIds.filter((p): p is string => typeof p === "string")
    : [];
  if (pinned.length) {
    // Archived or deleted projects drop off the list.
    const live = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.orgId, orgId), inArray(project.id, pinned), isNull(project.archivedAt)));
    const ok = new Set(live.map((p) => p.id));
    pinned = pinned.filter((p) => ok.has(p));
  }
  return { dashboardDefaults: defaults, pinnedProjectIds: pinned };
}

export async function updateWorkspacePreferences(
  c: Caller,
  patch: WorkspacePreferenceUpdate,
): Promise<WorkspacePreferences> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(workspacePreference)
    .where(and(eq(workspacePreference.orgId, c.orgId), eq(workspacePreference.userId, c.userId)));
  const set: Partial<typeof workspacePreference.$inferInsert> = {};
  if (patch.dashboardDefaults) {
    const next: Record<string, string> = { ...(row?.dashboardDefaults ?? {}) };
    for (const [scope, id] of Object.entries(patch.dashboardDefaults)) {
      if (id === null) Reflect.deleteProperty(next, scope);
      else {
        const d = await visible(c.orgId, c.userId, id);
        if (d.scope !== scope)
          throw new ApiError(400, "BAD_REQUEST", "That dashboard belongs to another screen");
        next[scope] = id;
      }
    }
    set.dashboardDefaults = next;
  }
  if (patch.pinnedProjectIds) {
    const ids = [...new Set(patch.pinnedProjectIds)];
    if (ids.length) {
      const found = await db
        .select({ id: project.id })
        .from(project)
        .where(and(eq(project.orgId, c.orgId), inArray(project.id, ids), isNull(project.archivedAt)));
      if (found.length !== ids.length) throw notFound("Project");
    }
    set.pinnedProjectIds = ids;
  }
  if (Object.keys(set).length) {
    await db
      .insert(workspacePreference)
      .values({ orgId: c.orgId, userId: c.userId, ...set })
      .onConflictDoUpdate({
        target: [workspacePreference.orgId, workspacePreference.userId],
        set: { ...set, updatedAt: new Date() },
      });
  }
  return workspacePreferences(c.orgId, c.userId);
}

// --- Account-wide interface state (start page, dismissed prompts) --------------------------------------

const accountDatabase = () => (env().PINWREN_MODE === "cloud" ? identityDatabase() : getDb());

export async function uiStateOf(userId: string): Promise<UiState> {
  const [row] = await accountDatabase()
    .select({ uiState: userPreference.uiState })
    .from(userPreference)
    .where(eq(userPreference.userId, userId));
  return readUiState(row?.uiState);
}

export async function updateUiState(userId: string, patch: UiStateUpdate): Promise<UiState> {
  const db = accountDatabase();
  // Read-merge-write inside one statement's worth of data: concurrent patches of different keys from two
  // tabs may race, which only costs a dismissal being asked once more.
  const next = mergeUiState(await uiStateOf(userId), patch);
  await db
    .insert(userPreference)
    .values({ userId, uiState: next })
    .onConflictDoUpdate({
      target: userPreference.userId,
      set: { uiState: next, updatedAt: new Date() },
    });
  return next;
}
