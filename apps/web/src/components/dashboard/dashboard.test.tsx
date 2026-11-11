// @vitest-environment happy-dom
import type { ApiDashboard } from "@pinwren/core";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stats = vi.hoisted(() => ({
  days: 14,
  totals: {
    active: 12,
    created: 5,
    previousCreated: 3,
    resolved: 4,
    unassigned: 2,
    overdue: 1,
    mine: 3,
    urgent: 0,
    avgResolutionHours: 30,
  },
  byStatus: [{ key: "open", count: 12 }],
  byKind: [{ key: "bug", count: 7 }],
  byPriority: [{ key: "high", count: 2 }],
  byProject: [{ id: "p1", name: "Marketing site", active: 12, total: 20 }],
  series: [
    { date: "2026-11-01", created: 1, resolved: 0 },
    { date: "2026-11-02", created: 2, resolved: 1 },
  ],
  recent: [],
}));
const statsCalls = vi.hoisted(() => [] as unknown[]);
const viewer = vi.hoisted(() => ({ role: "admin", isAdmin: true }));

/** An in-memory stand-in for the dashboards API: the rows, the defaults, and the requests made. */
const server = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = {
    rows: [] as Record<string, unknown>[],
    defaults: {} as Record<string, string>,
    version: 0,
    requests: [] as string[],
  };
  const emit = () => {
    state.version++;
    for (const l of listeners) l();
  };
  return {
    state,
    emit,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
});

const row = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  scope: "home",
  name: id,
  layout: { v: 1, days: 14, slots: [{ id: "kpi.active", w: 3, h: 1 }] },
  shared: false,
  defaultRoles: [],
  ownerId: "u1",
  ownerName: "Ada",
  mine: true,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  ...patch,
});
const rows = () => server.state.rows as unknown as ApiDashboard[];

vi.mock("@/lib/store/api/stats", () => ({
  useDashboardStatsQuery: (args: unknown) => {
    statsCalls.push(args);
    return { data: stats, isLoading: false, isError: false };
  },
}));
vi.mock("@/lib/store/api/dashboards", () => {
  const call = <T,>(label: string, run: () => T) => ({
    unwrap: () => {
      server.state.requests.push(label);
      const out = run();
      server.emit();
      return Promise.resolve(out);
    },
  });
  const useVersion = () =>
    useSyncExternalStore(
      server.subscribe,
      () => server.state.version,
      () => 0,
    );
  return {
    useDashboardsQuery: (scope: string) => {
      useVersion();
      return {
        data: { dashboards: server.state.rows.filter((r) => r.scope === scope) },
        isError: false,
        refetch: vi.fn(),
      };
    },
    useWorkspacePreferencesQuery: () => {
      useVersion();
      return { data: { preferences: { dashboardDefaults: server.state.defaults, pinnedProjectIds: [] } } };
    },
    useCreateDashboardMutation: () => [
      (body: Record<string, unknown>) =>
        call(`create ${String(body.name)}`, () => {
          const dashboard = row(`d${server.state.rows.length + 1}`, body);
          server.state.rows.push(dashboard);
          return { dashboard };
        }),
    ],
    useUpdateDashboardMutation: () => [
      (a: { id: string; patch: Record<string, unknown> }) =>
        call(`update ${a.id}`, () => {
          const r = server.state.rows.find((x) => x.id === a.id);
          if (r) Object.assign(r, a.patch);
          return { dashboard: r };
        }),
    ],
    useDeleteDashboardMutation: () => [
      (a: { id: string }) =>
        call(`delete ${a.id}`, () => {
          server.state.rows = server.state.rows.filter((x) => x.id !== a.id);
        }),
    ],
    useDuplicateDashboardMutation: () => [
      (a: { id: string }) =>
        call(`duplicate ${a.id}`, () => {
          const from = server.state.rows.find((x) => x.id === a.id);
          const dashboard = row(`copy-of-${a.id}`, {
            name: `${String(from?.name)} copy`,
            layout: from?.layout,
          });
          server.state.rows.push(dashboard);
          return { dashboard };
        }),
    ],
    useUpdateWorkspacePreferencesMutation: () => [
      (patch: { dashboardDefaults?: Record<string, string | null> }) =>
        call("prefs", () => {
          Object.assign(server.state.defaults, patch.dashboardDefaults);
          return {};
        }),
    ],
  };
});
vi.mock("@/lib/store/api", () => ({
  errorMessage: (e: unknown) => String(e),
  useProjectsQuery: () => ({ data: { projects: [{ id: "p1", name: "Marketing site" }] } }),
  useLabelsQuery: () => ({ data: { labels: [] } }),
}));
vi.mock("@/lib/viewer", () => ({
  useViewer: () => ({ userId: "u1", role: viewer.role, isAdmin: viewer.isAdmin }),
  useMembers: () => [],
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => "/dashboard",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { Dashboard } from "./dashboard";

const order = () => [...document.querySelectorAll("[data-widget]")].map((e) => e.getAttribute("data-widget"));

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/dashboard");
  Object.assign(server.state, { rows: [], defaults: {}, requests: [], version: 0 });
  statsCalls.length = 0;
  Object.assign(viewer, { role: "admin", isAdmin: true });
});
afterEach(cleanup);

describe("Dashboard", () => {
  it("shows the role's default widgets with real numbers before anything is saved", () => {
    render(<Dashboard scope="home" />);
    const open = screen.getByText("Open items").closest("li");
    expect(open && within(open).getByText("12")).toBeTruthy();
    expect(screen.getByText("Reported vs resolved")).toBeTruthy();
    expect(screen.getAllByText("Marketing site").length).toBeGreaterThan(0);
    expect(server.state.requests).toEqual([]);
  });

  it("saves the first edit to the account as the person's own dashboard and reads it back", async () => {
    const first = render(<Dashboard scope="home" />);
    fireEvent.click(screen.getByRole("button", { name: "Customise" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Overdue" }));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]).toMatchObject({ name: "My dashboard", shared: false });
    expect(rows()[0]?.layout.slots.map((s) => s.id)).not.toContain("kpi.overdue");
    expect(screen.queryByText("Overdue")).toBeNull();
    // A second edit follows the first onto the same dashboard instead of creating another.
    fireEvent.click(screen.getByRole("button", { name: "Remove Resolved" }));
    await waitFor(() => expect(server.state.requests).toContain(`update ${rows()[0]?.id ?? ""}`));
    expect(rows()).toHaveLength(1);
    first.unmount();

    // Another visit (or browser) reads the saved layout from the server.
    window.localStorage.clear();
    render(<Dashboard scope="home" />);
    expect(screen.queryByText("Overdue")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Customise" }));
    fireEvent.click(screen.getByRole("button", { name: "Add widget" }));
    fireEvent.click(screen.getByRole("button", { name: /^Overdue/ }));
    await waitFor(() => expect(screen.getAllByText("Overdue").length).toBeGreaterThan(0));
  });

  it("imports the layout the browser kept before dashboards lived on the server, once", async () => {
    const legacy = { v: 1, days: 30, slots: [{ id: "kpi.urgent", w: 3, h: 1 }] };
    window.localStorage.setItem("pinwren.dashboard.v1.u1.home", JSON.stringify(legacy));
    render(<Dashboard scope="home" />);
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]).toMatchObject({ name: "My dashboard", layout: legacy });
    expect(order()).toEqual(["kpi.urgent"]);
    await waitFor(() => expect(window.localStorage.getItem("pinwren.dashboard.v1.u1.home")).toBeNull());
    cleanup();
    render(<Dashboard scope="home" />);
    expect(rows()).toHaveLength(1);
  });

  it("opens a shared dashboard read-only and copies it to the person's own on Customise", async () => {
    server.state.rows = [
      row("shared1", {
        name: "Workspace weekly",
        shared: true,
        mine: false,
        ownerId: "boss",
        ownerName: "Grace",
        defaultRoles: ["editor"],
        layout: { v: 1, days: 7, slots: [{ id: "kpi.created", w: 4, h: 1 }] },
      }),
    ];
    Object.assign(viewer, { role: "member", isAdmin: false });
    render(<Dashboard scope="home" />);
    // Editors' role default is the shared one: it shows, with who shared it, and is not edited in place.
    expect(order()).toEqual(["kpi.created"]);
    expect(screen.getByTestId("dashboard-readonly").textContent).toContain("Grace");
    fireEvent.click(screen.getByRole("button", { name: "Duplicate to my dashboards" }));
    await waitFor(() => expect(server.state.requests).toContain("duplicate shared1"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeTruthy());
    expect(screen.queryByTestId("dashboard-readonly")).toBeNull();
  });

  it("passes the filter bar's choices to the stats request and clears them from the URL", () => {
    const project = "b3c1b2c0-5d1e-4c3a-9a77-0f6b1f0d9a11";
    window.history.replaceState(null, "", `/dashboard?project=${project}&assignee=me`);
    render(<Dashboard scope="home" />);
    expect(statsCalls.at(-1)).toMatchObject({ days: 14, projectId: project, assigneeId: "me" });
    fireEvent.click(screen.getByTestId("dashboard-filters-clear"));
    expect(window.location.search).toBe("");
  });

  it("moves a widget later and resets to the default on an overview strip", async () => {
    render(<Dashboard scope="inbox" />);
    // The inbox strip starts folded; open it.
    expect(screen.queryByText("Open items")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(order()[0]).toBe("kpi.active");
    expect(screen.queryByTestId("dashboard-filters")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Customise" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Open items later" }));
    await waitFor(() => expect(order().slice(0, 2)).toEqual(["kpi.mine", "kpi.active"]));
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    });
    await waitFor(() => expect(order()[0]).toBe("kpi.active"));
  });
});
