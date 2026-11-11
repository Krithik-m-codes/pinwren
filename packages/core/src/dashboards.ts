import { z } from "zod";
import { APP_ROLES } from "./roles";

// Server-stored dashboards (ADR 0037): named layouts per person and screen, optionally published to the
// workspace, plus the small per-account and per-workspace preference bags that used to live in the browser.
// The widget catalogue itself stays in the dashboard app (it carries translation keys); the server only
// checks the shape of a layout and caps its size, so a release can add or retire a widget without a
// migration and an older client never destroys a layout it does not understand.

/** A dashboard surface: the home page and the overview strip of other screens. */
export const DASHBOARD_SCOPES = ["home", "inbox", "projects", "project", "notifications"] as const;
export type DashboardScope = (typeof DASHBOARD_SCOPES)[number];

/** Column spans on the 12-column grid and heights in grid rows. */
export const LAYOUT_SPANS = [3, 4, 6, 8, 12] as const;
export const LAYOUT_HEIGHTS = [1, 2, 3] as const;
export const LAYOUT_RANGES = [7, 14, 30, 90] as const;

/** Most widgets one layout may hold (the catalogue has fewer than 30) and dashboards one person may keep per screen. */
export const MAX_LAYOUT_SLOTS = 40;
export const MAX_DASHBOARDS_PER_SCOPE = 25;
/** Shared dashboards per workspace and screen. */
export const MAX_SHARED_PER_SCOPE = 25;
export const MAX_DASHBOARD_NAME = 60;
/** Pinned projects in the sidebar. */
export const MAX_PINNED_PROJECTS = 12;

/** `kpi.active`, `chart.trend`, `list.recent`: a group, a dot and a camelCase name. */
const WIDGET_ID = /^(?:kpi|chart|list|[a-z]{2,12})\.[A-Za-z][A-Za-z0-9]{0,39}$/;

const oneOf = <T extends number>(allowed: readonly T[]) =>
  z.number().refine((n): n is T => (allowed as readonly number[]).includes(n));

export type LayoutSlot = { id: string; w: number; h: number };
export type StoredLayout = { v: 1; slots: LayoutSlot[]; days: (typeof LAYOUT_RANGES)[number] };

/**
 * A layout as stored. Entries that are malformed, repeated or beyond the cap are dropped, not rejected, so
 * saving a layout whose widget was retired in the meantime still works. The dashboard app drops widgets it
 * does not know when it reads a layout back.
 */
export const dashboardLayout = z.preprocess(
  (raw): unknown => {
    if (!raw || typeof raw !== "object") return raw;
    const r = raw as { slots?: unknown };
    if (!Array.isArray(r.slots)) return raw;
    const seen = new Set<string>();
    const slots: unknown[] = [];
    for (const s of r.slots as unknown[]) {
      if (slots.length >= MAX_LAYOUT_SLOTS) break;
      if (!s || typeof s !== "object") continue;
      const { id, w, h } = s as { id?: unknown; w?: unknown; h?: unknown };
      if (typeof id !== "string" || !WIDGET_ID.test(id) || seen.has(id)) continue;
      if (
        !(LAYOUT_SPANS as readonly unknown[]).includes(w) ||
        !(LAYOUT_HEIGHTS as readonly unknown[]).includes(h)
      ) {
        continue;
      }
      seen.add(id);
      slots.push({ id, w, h });
    }
    return { ...r, slots };
  },
  z.object({
    v: z.literal(1),
    slots: z.array(z.object({ id: z.string().max(60), w: oneOf(LAYOUT_SPANS), h: oneOf(LAYOUT_HEIGHTS) })),
    days: oneOf(LAYOUT_RANGES),
  }),
) as unknown as z.ZodType<StoredLayout>;

export const dashboardScope = z.enum(DASHBOARD_SCOPES);
const dashboardName = z.string().trim().min(1, "Enter a name").max(MAX_DASHBOARD_NAME);
const defaultRoles = z.array(z.enum(APP_ROLES)).max(APP_ROLES.length);

/** `GET /api/dashboards?scope=`. */
export const dashboardListQuery = z.object({ scope: dashboardScope });

/** `POST /api/dashboards`: a new personal dashboard, or (Admin) one published to the workspace. */
export const dashboardCreate = z.object({
  scope: dashboardScope,
  name: dashboardName,
  layout: dashboardLayout,
  /** Publish to every member (read-only for them). Admins only. */
  shared: z.boolean().optional(),
  /** Roles that start on this dashboard instead of the built-in default. Shared dashboards only. */
  defaultRoles: defaultRoles.optional(),
});
export type DashboardCreate = z.infer<typeof dashboardCreate>;

/** `PATCH /api/dashboards/:id`: rename, change the layout, publish or unpublish. */
export const dashboardUpdate = z.object({
  name: dashboardName.optional(),
  layout: dashboardLayout.optional(),
  shared: z.boolean().optional(),
  defaultRoles: defaultRoles.optional(),
});
export type DashboardUpdate = z.infer<typeof dashboardUpdate>;

/** `POST /api/dashboards/:id/duplicate`: a personal copy; the name defaults to "<name> copy". */
export const dashboardDuplicate = z.object({ name: dashboardName.optional() });
export type DashboardDuplicate = z.infer<typeof dashboardDuplicate>;

export const apiDashboard = z.object({
  id: z.string(),
  scope: dashboardScope,
  name: z.string(),
  layout: dashboardLayout,
  shared: z.boolean(),
  defaultRoles: defaultRoles,
  ownerId: z.string(),
  ownerName: z.string().nullable(),
  /** Whether the caller owns it (and may rename, edit, delete). */
  mine: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ApiDashboard = z.infer<typeof apiDashboard>;

/**
 * `PATCH /api/me/workspace-preferences`: per person and workspace. `dashboardDefaults` maps a screen to the
 * dashboard that opens there (null clears it); `pinnedProjectIds` are the projects pinned in the sidebar.
 */
export const workspacePreferenceUpdate = z.object({
  dashboardDefaults: z.partialRecord(dashboardScope, z.uuid().nullable()).optional(),
  pinnedProjectIds: z.array(z.uuid()).max(MAX_PINNED_PROJECTS).optional(),
});
export type WorkspacePreferenceUpdate = z.infer<typeof workspacePreferenceUpdate>;

export type WorkspacePreferences = {
  dashboardDefaults: Partial<Record<DashboardScope, string>>;
  pinnedProjectIds: string[];
};

export const LANDINGS = ["inbox", "dashboard", "my-work"] as const;

const isoString = z.string().max(40).nullable();

/**
 * `PATCH /api/me/ui-state`: small account-wide interface state that follows a person between browsers: the
 * start page and the dismissals of the update strip and support card (ADR 0025). `user_preference.ui_state`.
 */
export const uiStateUpdate = z.object({
  startPage: z.enum(LANDINGS).optional(),
  nudges: z
    .object({
      firstSeen: isoString.optional(),
      dismissedUpdate: z.string().max(100).nullable().optional(),
      supportSnoozedUntil: isoString.optional(),
      supportOptOut: z.boolean().optional(),
    })
    .optional(),
});
export type UiStateUpdate = z.infer<typeof uiStateUpdate>;

export type UiState = {
  startPage: (typeof LANDINGS)[number] | null;
  nudges: {
    firstSeen: string | null;
    dismissedUpdate: string | null;
    supportSnoozedUntil: string | null;
    supportOptOut: boolean;
  };
};

/** The stored bag read defensively: anything unreadable is the empty state. */
export function readUiState(raw: unknown): UiState {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const n = (r.nudges && typeof r.nudges === "object" ? r.nudges : {}) as Record<string, unknown>;
  const str = (x: unknown, max = 100) => (typeof x === "string" && x.length <= max ? x : null);
  return {
    startPage: (LANDINGS as readonly unknown[]).includes(r.startPage)
      ? (r.startPage as UiState["startPage"])
      : null,
    nudges: {
      firstSeen: str(n.firstSeen, 40),
      dismissedUpdate: str(n.dismissedUpdate),
      supportSnoozedUntil: str(n.supportSnoozedUntil, 40),
      supportOptOut: n.supportOptOut === true,
    },
  };
}

/** Apply a patch to the stored bag. Keys the patch does not name keep their value. */
export function mergeUiState(current: UiState, patch: UiStateUpdate): UiState {
  return {
    startPage: patch.startPage ?? current.startPage,
    nudges: {
      firstSeen: patch.nudges?.firstSeen === undefined ? current.nudges.firstSeen : patch.nudges.firstSeen,
      dismissedUpdate:
        patch.nudges?.dismissedUpdate === undefined
          ? current.nudges.dismissedUpdate
          : patch.nudges.dismissedUpdate,
      supportSnoozedUntil:
        patch.nudges?.supportSnoozedUntil === undefined
          ? current.nudges.supportSnoozedUntil
          : patch.nudges.supportSnoozedUntil,
      supportOptOut: patch.nudges?.supportOptOut ?? current.nudges.supportOptOut,
    },
  };
}

/** Who sees a dashboard: the owner, or everyone when it is shared. */
export const canSeeDashboard = (d: { ownerId: string; shared: boolean }, userId: string) =>
  d.shared || d.ownerId === userId;
