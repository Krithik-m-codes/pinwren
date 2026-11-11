import type { ApiDashboard, AppRole } from "@pinwren/core";

// Which of a person's dashboards opens on a screen. Pure, so the order is unit-tested.

export type ActiveSource = "selected" | "default" | "personal" | "role" | "builtin";

/**
 * 1. the one picked in the tabs or the link (`?dash=`), 2. the person's chosen default, 3. their first own
 * dashboard, 4. a shared dashboard published as the default for their role, 5. the built-in layout (null).
 * A role default only reaches people who have not made a dashboard of their own, like the old built-in ones.
 */
export function resolveActive(input: {
  dashboards: readonly ApiDashboard[];
  selectedId: string | null;
  defaultId: string | undefined;
  role: AppRole | undefined;
}): { dashboard: ApiDashboard | null; source: ActiveSource } {
  const { dashboards, selectedId, defaultId, role } = input;
  const byId = (id: string | null | undefined) => (id ? dashboards.find((d) => d.id === id) : undefined);
  const selected = byId(selectedId);
  if (selected) return { dashboard: selected, source: "selected" };
  const preferred = byId(defaultId);
  if (preferred) return { dashboard: preferred, source: "default" };
  const own = dashboards.find((d) => d.mine);
  if (own) return { dashboard: own, source: "personal" };
  const roleDefault = role ? dashboards.find((d) => d.shared && d.defaultRoles.includes(role)) : undefined;
  if (roleDefault) return { dashboard: roleDefault, source: "role" };
  return { dashboard: null, source: "builtin" };
}

/** Whether this person may change the dashboard in place (otherwise they duplicate it first). */
export const canEditDashboard = (d: ApiDashboard | null, isAdmin: boolean) =>
  d === null || d.mine || (d.shared && isAdmin);
