// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedbackDetail } from "@/lib/api";

const update = vi.fn();

vi.mock("@/lib/store/api", () => ({
  errorMessage: (e: unknown, fallback = "error") => (e instanceof Error ? e.message : fallback),
  useReleasesQuery: () => ({
    data: { releases: [{ id: "r1", version: "v1.4.0" }] },
    isLoading: false,
    isError: false,
  }),
  useUpdateFeedbackMutation: () => [
    (args: unknown) => ({ unwrap: () => Promise.resolve(update(args)) }),
    { isLoading: false },
  ],
}));

import { RegressionBanner, RegressionsOfThis, RegressionTag, ReleaseBadges } from "./release-ui";

type F = FeedbackDetail["feedback"];
const flagged = (extra: Partial<F> = {}) =>
  ({
    id: "f2",
    regressionOfId: "f1",
    regressionOfNumber: 41,
    regressionConfidence: "possible",
    release: "v1.4.1",
    regressionOf: {
      id: "f1",
      number: 41,
      title: "Pay button does nothing",
      status: "resolved",
      signals: ["error", "release"],
      score: 70,
    },
    ...extra,
  }) as unknown as F;

describe("RegressionBanner", () => {
  afterEach(cleanup);
  beforeEach(() => update.mockReset());

  it("says what it may be a regression of, why, and from which release", () => {
    render(<RegressionBanner feedback={flagged()} canWrite onOpen={vi.fn()} />);
    expect(screen.getByText("Possible regression")).toBeTruthy();
    expect(screen.getByText(/#41 “Pay button does nothing”/)).toBeTruthy();
    expect(screen.getByText("It shares a console error with it")).toBeTruthy();
    expect(screen.getByText("It was reported on or after the release that fixed it")).toBeTruthy();
    expect(screen.getByText("Reported in v1.4.1")).toBeTruthy();
  });

  it("explains an AI-found match, which has no detector signals", () => {
    const f = flagged();
    if (f.regressionOf) f.regressionOf.signals = [];
    render(<RegressionBanner feedback={f} canWrite={false} onOpen={vi.fn()} />);
    expect(screen.getByText("The AI duplicate check matched the two")).toBeTruthy();
  });

  it("opens the original, and reopens it for someone who can write", async () => {
    const onOpen = vi.fn();
    render(<RegressionBanner feedback={flagged()} canWrite onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /View #41/ }));
    expect(onOpen).toHaveBeenCalledWith("f1");
    fireEvent.click(screen.getByRole("button", { name: /Reopen #41/ }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ ids: ["f1"], patch: { status: "open" } }));
  });

  it("offers no reopen to a viewer or when the original is already open", () => {
    const { rerender } = render(<RegressionBanner feedback={flagged()} canWrite={false} onOpen={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Reopen/ })).toBeNull();
    const open = flagged();
    if (open.regressionOf) open.regressionOf.status = "open";
    rerender(<RegressionBanner feedback={open} canWrite onOpen={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Reopen/ })).toBeNull();
  });

  it("renders nothing for an item that is not flagged", () => {
    const { container } = render(
      <RegressionBanner feedback={flagged({ regressionOf: null })} canWrite onOpen={vi.fn()} />,
    );
    expect(container.textContent).toBe("");
  });
});

describe("badges", () => {
  afterEach(cleanup);

  it("shows the fix, the reported release and the regression", () => {
    render(
      <ReleaseBadges
        item={{
          status: "resolved",
          fixedInReleaseId: "r1",
          fixedInVersion: "v1.4.0",
          fixedInNextRelease: false,
          regressionOfId: "f1",
          regressionOfNumber: 41,
          regressionConfidence: "likely",
          release: "v1.4.1",
        }}
      />,
    );
    expect(screen.getByTestId("fixed-in-badge").textContent).toContain("Fixed in v1.4.0");
    expect(screen.getByTestId("reported-release").textContent).toContain("Reported in v1.4.1");
    expect(screen.getByTestId("regression-badge").textContent).toContain("Likely regression of #41");
  });

  it("promises the next release, and drops the fix once the item is reopened", () => {
    const base = {
      fixedInReleaseId: null,
      fixedInVersion: null,
      regressionOfId: null,
      regressionOfNumber: null,
      regressionConfidence: null,
      release: null,
    } as const;
    const { rerender } = render(
      <ReleaseBadges item={{ ...base, status: "resolved", fixedInNextRelease: true }} />,
    );
    expect(screen.getByTestId("fixed-in-badge").textContent).toContain("Fix ships in the next release");
    rerender(<ReleaseBadges item={{ ...base, status: "open", fixedInNextRelease: true }} />);
    expect(screen.queryByTestId("fixed-in-badge")).toBeNull();
  });

  it("tags a row only when it is flagged", () => {
    const row = {
      status: "open",
      regressionOfId: null,
      regressionOfNumber: null,
      regressionConfidence: null,
    } as const;
    const { container, rerender } = render(<RegressionTag item={row as never} />);
    expect(container.textContent).toBe("");
    rerender(
      <RegressionTag
        item={
          { ...row, regressionOfId: "f1", regressionOfNumber: 41, regressionConfidence: "possible" } as never
        }
      />,
    );
    expect(screen.getByTestId("regression-tag").getAttribute("title")).toBe("Possible regression of #41");
  });
});

describe("RegressionsOfThis", () => {
  afterEach(cleanup);

  it("lists the newer reports that may be this item coming back", () => {
    const onOpen = vi.fn();
    render(
      <RegressionsOfThis
        regressions={[
          { id: "f2", number: 50, title: "Pay fails again", status: "open", confidence: "likely" },
        ]}
        onOpen={onOpen}
      />,
    );
    expect(screen.getByText("1 newer report may be a regression of this item")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "#50 Pay fails again" }));
    expect(onOpen).toHaveBeenCalledWith("f2");
  });
});
