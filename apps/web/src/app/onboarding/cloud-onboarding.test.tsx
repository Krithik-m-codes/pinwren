// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  seats: { used: 1, limit: 1 },
  invite: vi.fn(),
}));

vi.mock("@/lib/store/api", () => ({
  errorMessage: (_e: unknown, fallback: string) => fallback,
  useMeQuery: () => ({ data: undefined }),
  useBillingQuery: () => ({
    data: { planName: "Free", usage: { seats: mocks.seats } },
    refetch: vi.fn(),
  }),
  useInviteMemberMutation: () => [
    (arg: unknown) => ({ unwrap: () => mocks.invite(arg) as Promise<unknown> }),
  ],
}));
vi.mock("@/lib/store/api/people", () => ({
  useWorkspacesQuery: () => ({ data: [] }),
  useRenameWorkspaceMutation: () => [vi.fn()],
}));
vi.mock("./onboarding-form", () => ({ OnboardingForm: () => null }));

import { InviteStep } from "./cloud-onboarding";

afterEach(() => {
  cleanup();
  mocks.invite.mockReset();
});

describe("Cloud onboarding: invite step", () => {
  it("shows the seats in use and hides the form when the plan has none free", () => {
    mocks.seats = { used: 1, limit: 1 };
    render(<InviteStep onDone={vi.fn()} />);
    expect(screen.getByTestId("onboarding-seats").textContent).toBe("1 of 1 seats used on the Free plan");
    expect(screen.getByTestId("onboarding-seats-full")).toBeDefined();
    expect(screen.queryByLabelText("Teammate's email")).toBeNull();
  });

  it("invites a teammate as an editor while seats remain", async () => {
    mocks.seats = { used: 1, limit: 3 };
    mocks.invite.mockResolvedValue({});
    render(<InviteStep onDone={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Teammate's email"), { target: { value: "bo@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    await waitFor(() =>
      expect(mocks.invite).toHaveBeenCalledWith({ email: "bo@example.com", role: "member" }),
    );
    expect((await screen.findByRole("status")).textContent).toBe("Invitation sent to bo@example.com");
  });
});
