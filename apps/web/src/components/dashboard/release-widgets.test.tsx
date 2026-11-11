// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import type { DashboardStats } from "@pinwren/core";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { FixedPerReleaseWidget, RegressionsWidget } from "./widgets";

const stats = (over: Partial<DashboardStats>) =>
  ({ regressions: { total: 0, open: 0, items: [] }, releases: [], ...over }) as DashboardStats;

describe("Regressions widget", () => {
  afterEach(cleanup);

  it("is quiet when nothing came back", () => {
    render(<RegressionsWidget stats={stats({})} projectId={undefined} />);
    expect(screen.getByText("No regressions in this range")).toBeTruthy();
  });

  it("lists the newest regressions with what they may be a regression of", () => {
    render(
      <RegressionsWidget
        projectId="p1"
        stats={stats({
          regressions: {
            total: 3,
            open: 2,
            items: [
              {
                id: "f2",
                number: 50,
                title: "Pay fails again",
                status: "open",
                projectId: "p1",
                projectName: "Site",
                confidence: "likely",
                ofId: "f1",
                ofNumber: 41,
                createdAt: "2026-11-09T10:00:00Z",
              },
            ],
          },
        })}
      />,
    );
    expect(screen.getByTestId("regression-counts").textContent).toBe("2 open · 3 in this range");
    const row = screen.getByTestId("regression-list").querySelector("a");
    expect(row?.getAttribute("href")).toBe("/inbox?status=all&item=f2");
    expect(row?.textContent).toContain("#50");
    expect(row?.textContent).toContain("of #41");
    expect(screen.getByText("View all").getAttribute("href")).toBe(
      "/inbox?regression=true&status=all&project=p1",
    );
  });
});

describe("Fixed per release widget", () => {
  afterEach(cleanup);

  it("says when no release was recorded", () => {
    render(<FixedPerReleaseWidget stats={stats({})} projectId={undefined} />);
    expect(screen.getByText("No releases recorded yet")).toBeTruthy();
  });

  it("shows each release with its fixes and regressions, linking to the fixed items", () => {
    render(
      <FixedPerReleaseWidget
        projectId={undefined}
        stats={stats({
          releases: [
            {
              id: "r2",
              version: "v1.5.0",
              projectId: "p1",
              projectName: "Site",
              deployedAt: "2026-11-08T10:00:00Z",
              fixed: 4,
              regressions: 1,
            },
            {
              id: "r1",
              version: "v1.4.0",
              projectId: "p1",
              projectName: "Site",
              deployedAt: "2026-11-01T10:00:00Z",
              fixed: 2,
              regressions: 0,
            },
          ],
        })}
      />,
    );
    const rows = screen.getByTestId("release-list").querySelectorAll("li");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("v1.5.0");
    expect(rows[0]?.textContent).toContain("4 fixed");
    expect(rows[0]?.textContent).toContain("1 regressions");
    expect(rows[1]?.textContent).not.toContain("regressions");
    expect(rows[0]?.querySelector("a")?.getAttribute("href")).toBe("/inbox?status=all&fixedIn=r2");
  });
});
