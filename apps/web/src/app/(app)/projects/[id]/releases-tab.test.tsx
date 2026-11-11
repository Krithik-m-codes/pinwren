// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectDetail } from "@/lib/api";

const record = vi.fn();
const releases = [
  {
    id: "r1",
    projectId: "p1",
    version: "v1.4.0",
    commit: "9f2c1abdef",
    notes: null,
    deployedAt: "2026-11-01T10:00:00Z",
    createdAt: "2026-11-01T10:00:00Z",
    fixedCount: 2,
    regressionCount: 1,
  },
];

vi.mock("@/lib/store/api", () => ({
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
  useReleasesQuery: () => ({ data: { releases }, isLoading: false, isError: false }),
  useRecordReleaseMutation: () => [
    (args: unknown) => ({ unwrap: () => Promise.resolve(record(args)) }),
    { isLoading: false },
  ],
  useDeleteReleaseMutation: () => [vi.fn(), { isLoading: false }],
}));
vi.mock("@/lib/viewer", () => ({ useViewer: () => ({ isAdmin: true }) }));
vi.mock("./use-project", () => ({ useProjectPatch: () => ({ isPending: false, mutate: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ReleasesTab } from "./releases-tab";

const project = {
  id: "p1",
  slug: "site",
  publicKey: "pk_x",
  publicUrl: "https://fb.example.com",
  detectRegressions: true,
  autoReopenRegressions: false,
} as unknown as ProjectDetail;

describe("ReleasesTab", () => {
  afterEach(cleanup);
  beforeEach(() =>
    record.mockReset().mockReturnValue({ release: { version: "v1.5.0" }, created: true, adopted: 0 }),
  );

  it("lists releases with their counts and the CI snippets", () => {
    render(<ReleasesTab project={project} />);
    const row = screen.getByTestId("release-table").querySelector("[data-release='v1.4.0']");
    expect(row?.textContent).toContain("9f2c1abdef".slice(0, 10));
    expect(row?.textContent).toContain("2");
    expect(screen.getByText(/api\/v1\/projects\/p1\/releases/)).toBeTruthy();
    expect(screen.getByText(/release create/)).toBeTruthy();
  });

  it("records a release, leaving blank commit and notes out, and clears the form for the next one", async () => {
    render(<ReleasesTab project={project} />);
    const add = screen.getByRole<HTMLButtonElement>("button", { name: "Record release" });
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Version"), { target: { value: "v1.5.0" } });
    await waitFor(() => expect(add.disabled).toBe(false));
    fireEvent.click(add);
    await waitFor(() =>
      expect(record).toHaveBeenCalledWith({ projectId: "p1", release: { version: "v1.5.0" } }),
    );
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Version").value).toBe(""));
    // A second one can be typed straight away.
    fireEvent.change(screen.getByLabelText("Version"), { target: { value: "v1.5.1" } });
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Record release" }).disabled).toBe(false),
    );
  });

  it("clears the form after a refused attempt followed by a good one, commit included", async () => {
    render(<ReleasesTab project={project} />);
    fireEvent.change(screen.getByLabelText("Version"), { target: { value: "not valid" } });
    fireEvent.click(screen.getByRole("button", { name: "Record release" }));
    await screen.findByText(/no spaces/);
    fireEvent.change(screen.getByLabelText("Version"), { target: { value: "v1.5.0" } });
    fireEvent.change(screen.getByLabelText("Commit"), { target: { value: "9f2c1ab" } });
    fireEvent.click(screen.getByRole("button", { name: "Record release" }));
    await waitFor(() =>
      expect(record).toHaveBeenCalledWith({
        projectId: "p1",
        release: { version: "v1.5.0", commit: "9f2c1ab" },
      }),
    );
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Version").value).toBe(""));
    expect(screen.getByLabelText<HTMLInputElement>("Commit").value).toBe("");
  });

  it("refuses a version with spaces", async () => {
    render(<ReleasesTab project={project} />);
    fireEvent.change(screen.getByLabelText("Version"), { target: { value: "not valid" } });
    fireEvent.click(screen.getByRole("button", { name: "Record release" }));
    await screen.findByText(/no spaces/);
    expect(record).not.toHaveBeenCalled();
  });
});
