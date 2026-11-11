import type { ApiDashboard } from "@pinwren/core";
import { describe, expect, it } from "vitest";
import { canEditDashboard, resolveActive } from "./resolve";

const d = (id: string, patch: Partial<ApiDashboard> = {}): ApiDashboard => ({
  id,
  scope: "home",
  name: id,
  layout: { v: 1, days: 14, slots: [] },
  shared: false,
  defaultRoles: [],
  ownerId: "me",
  ownerName: null,
  mine: true,
  createdAt: "",
  updatedAt: "",
  ...patch,
});
const shared = (id: string, roles: ApiDashboard["defaultRoles"] = []) =>
  d(id, { shared: true, mine: false, ownerId: "admin", defaultRoles: roles });

describe("resolveActive", () => {
  const list = [d("a"), d("b"), shared("s", ["viewer"])];

  it("prefers the picked dashboard, then the default, then the first own one", () => {
    expect(
      resolveActive({ dashboards: list, selectedId: "b", defaultId: "a", role: "admin" }).dashboard?.id,
    ).toBe("b");
    expect(
      resolveActive({ dashboards: list, selectedId: null, defaultId: "b", role: "admin" }),
    ).toMatchObject({
      dashboard: { id: "b" },
      source: "default",
    });
    expect(
      resolveActive({ dashboards: list, selectedId: null, defaultId: undefined, role: "admin" }),
    ).toMatchObject({
      dashboard: { id: "a" },
      source: "personal",
    });
  });

  it("ignores ids that are gone and falls through", () => {
    expect(
      resolveActive({ dashboards: list, selectedId: "zzz", defaultId: "yyy", role: "viewer" }).dashboard?.id,
    ).toBe("a");
  });

  it("gives a role default only to people with no dashboard of their own", () => {
    const sharedOnly = [shared("s", ["viewer"]), shared("t", ["editor"])];
    expect(
      resolveActive({ dashboards: sharedOnly, selectedId: null, defaultId: undefined, role: "viewer" }),
    ).toMatchObject({
      dashboard: { id: "s" },
      source: "role",
    });
    expect(
      resolveActive({ dashboards: sharedOnly, selectedId: null, defaultId: undefined, role: "admin" }),
    ).toEqual({
      dashboard: null,
      source: "builtin",
    });
    expect(
      resolveActive({ dashboards: [], selectedId: null, defaultId: undefined, role: undefined }).source,
    ).toBe("builtin");
  });

  it("lets owners change their own, admins change shared ones, and nobody else", () => {
    expect(canEditDashboard(null, false)).toBe(true);
    expect(canEditDashboard(d("a"), false)).toBe(true);
    expect(canEditDashboard(shared("s"), false)).toBe(false);
    expect(canEditDashboard(shared("s"), true)).toBe(true);
  });
});
