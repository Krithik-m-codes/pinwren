// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
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

vi.mock("@/lib/store/api/stats", () => ({
  useDashboardStatsQuery: () => ({ data: stats, isLoading: false, isError: false }),
}));
vi.mock("@/lib/viewer", () => ({ useViewer: () => ({ userId: "u1", role: "admin" }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { Dashboard } from "./dashboard";

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("Dashboard", () => {
  it("shows the role's default widgets with real numbers", () => {
    render(<Dashboard scope="home" />);
    const open = screen.getByText("Open items").closest("li");
    expect(open && within(open).getByText("12")).toBeTruthy();
    expect(screen.getByText("Reported vs resolved")).toBeTruthy();
    expect(screen.getByText("Marketing site")).toBeTruthy();
  });

  it("removes and re-adds a widget in edit mode, and remembers the layout", () => {
    const first = render(<Dashboard scope="home" />);
    fireEvent.click(screen.getByRole("button", { name: "Customise" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Overdue" }));
    expect(screen.queryByText("Overdue")).toBeNull();
    first.unmount();

    // A fresh mount (another visit) reads the saved layout.
    render(<Dashboard scope="home" />);
    expect(screen.queryByText("Overdue")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Customise" }));
    fireEvent.click(screen.getByRole("button", { name: "Add widget" }));
    fireEvent.click(screen.getByRole("button", { name: /^Overdue/ }));
    expect(screen.getAllByText("Overdue").length).toBeGreaterThan(0);
  });

  it("moves a widget later and resets to the default", () => {
    render(<Dashboard scope="inbox" />);
    // The inbox strip starts folded; open it.
    expect(screen.queryByText("Open items")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    const order = () =>
      [...document.querySelectorAll("[data-widget]")].map((e) => e.getAttribute("data-widget"));
    expect(order()[0]).toBe("kpi.active");
    fireEvent.click(screen.getByRole("button", { name: "Customise" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Open items later" }));
    expect(order().slice(0, 2)).toEqual(["kpi.mine", "kpi.active"]);
    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    expect(order()[0]).toBe("kpi.active");
  });
});
