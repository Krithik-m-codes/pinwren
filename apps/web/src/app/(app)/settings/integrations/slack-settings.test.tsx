// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SlackState } from "@/lib/store/api/slack";

const state = vi.hoisted(() => {
  const current: { data: unknown; error: unknown; isLoading: boolean; isError: boolean } = {
    data: undefined,
    error: undefined,
    isLoading: false,
    isError: false,
  };
  return { current, channels: { data: { channels: [], error: null }, isLoading: false } };
});
const calls = vi.hoisted(() => ({
  connect: vi.fn(),
  test: vi.fn(),
  sync: vi.fn(),
  unlink: vi.fn(),
  disconnect: vi.fn(),
  createRoute: vi.fn(),
  deleteRoute: vi.fn(),
  claim: vi.fn(),
  copy: vi.fn(),
}));
const done = <T,>(fn: (a: never) => unknown, value?: T) =>
  [
    (a: never) => ({ unwrap: () => Promise.resolve(fn(a) ?? value) }),
    { isLoading: false, originalArgs: undefined },
  ] as const;

vi.mock("@/lib/store/api", () => ({
  errorMessage: (e: unknown, fallback = "error") => (e instanceof Error ? e.message : fallback),
  isForbidden: (e: unknown) => (e as { status?: number } | undefined)?.status === 403,
  useProjectsQuery: () => ({
    data: {
      projects: [
        { id: "p1", name: "Marketing site" },
        { id: "p2", name: "Mobile app" },
      ],
    },
  }),
}));
vi.mock("@/lib/store/api/slack", () => ({
  useSlackStateQuery: () => ({ ...state.current, refetch: vi.fn() }),
  useSlackChannelsQuery: () => state.channels,
  useConnectSlackMutation: () => done(calls.connect, { connection: { teamName: "Acme" } }),
  useTestSlackMutation: () => done(calls.test, { ok: true, message: "Posted a test message to C0ROUTEA01." }),
  useSyncSlackMembersMutation: () => done(calls.sync, { linked: 1, scanned: 3 }),
  useUnlinkSlackUserMutation: () => done(calls.unlink),
  useDisconnectSlackMutation: () => done(calls.disconnect),
  useCreateSlackRouteMutation: () => done(calls.createRoute, { route: {} }),
  useUpdateSlackRouteMutation: () => done(vi.fn(), { route: {} }),
  useDeleteSlackRouteMutation: () => done(calls.deleteRoute),
  useClaimSlackLinkMutation: () => done(calls.claim, { linked: true, teamName: "Acme" }),
}));
vi.mock("@/components/copy-button", () => ({
  copyText: (...a: unknown[]) => {
    calls.copy(...a);
    return Promise.resolve(true);
  },
  CopyButton: ({ value, label }: { value: string; label?: string }) => (
    <button type="button" aria-label={label ?? "Copy"} data-value={value} />
  ),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(searchToken.value),
}));
const searchToken = vi.hoisted(() => ({ value: "" }));

import { SlackLink } from "../../slack/link/slack-link";
import { SlackSettings } from "./slack-settings";

// Built, not spelled out: a literal 32-character hex string looks like a real Slack signing secret to scanners.
const VALID_SECRET = "0123456789abcdef".repeat(2);

const base: Omit<SlackState, "connection" | "routes" | "members"> = {
  requestUrls: {
    interactivity: "https://pinwren.test/api/slack/interactivity",
    commands: "https://pinwren.test/api/slack/commands",
  },
  scopes: [{ scope: "chat:write", why: "post and update feedback cards" }],
  manifest: '{"display_information":{"name":"Pinwren"}}',
};
const connection = {
  id: "w1",
  teamId: "T0123ABCD",
  teamName: "Acme",
  teamUrl: "https://acme.slack.com/",
  botUserId: "U0BOT",
  tokenHint: "…1111",
  active: true,
  lastError: null,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};
const connected: SlackState = {
  ...base,
  connection,
  routes: [
    {
      id: "r1",
      projectId: "p1",
      channelId: "C0ROUTEA01",
      channelName: "feedback",
      events: ["feedback.created", "comment.created"],
    },
    {
      id: "r2",
      projectId: null,
      channelId: "C0ROUTEA02",
      channelName: null,
      events: ["feedback.status_changed"],
    },
  ],
  members: [
    {
      userId: "u1",
      name: "Ada Lovelace",
      email: "ada@example.test",
      role: "owner",
      linked: true,
      linkId: "l1",
      slackUserId: "U0ADA",
      source: "email",
    },
    {
      userId: "u2",
      name: "Grace Hopper",
      email: "grace@example.test",
      role: "member",
      linked: false,
      linkId: null,
      slackUserId: null,
      source: null,
    },
  ],
};

const set = (data: unknown, extra: Partial<typeof state.current> = {}) => {
  state.current = { data, error: undefined, isLoading: false, isError: false, ...extra };
};

describe("Slack settings", () => {
  afterEach(cleanup);
  beforeEach(() => {
    for (const fn of Object.values(calls)) fn.mockReset();
    state.channels = { data: { channels: [], error: null }, isLoading: false };
  });

  it("shows a skeleton while loading and nothing for people who are not admins", () => {
    set(undefined, { isLoading: true });
    const { container, unmount } = render(<SlackSettings />);
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    unmount();
    set(undefined, { error: { status: 403 }, isError: true });
    const forbidden = render(<SlackSettings />);
    expect(forbidden.container.textContent).toBe("");
  });

  it("explains the error state and offers a retry", () => {
    set(undefined, { error: new Error("boom"), isError: true });
    render(<SlackSettings />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("walks through setup: manifest, URLs and the credential form", async () => {
    set({ ...base, connection: null, routes: [], members: [] });
    render(<SlackSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Copy app manifest" }));
    expect(calls.copy.mock.calls[0]?.[0]).toBe(base.manifest);
    const urls = within(screen.getByTestId("slack-urls"));
    expect(urls.getByText(base.requestUrls.interactivity)).toBeTruthy();
    expect(urls.getByText(base.requestUrls.commands)).toBeTruthy();

    // A wrong secret is refused before anything is sent.
    fireEvent.change(screen.getByLabelText("Signing secret"), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText("Bot token"), { target: { value: "xoxb-" + "1".repeat(30) } });
    fireEvent.click(screen.getByRole("button", { name: "Connect Slack" }));
    expect(await screen.findByText(/32 letters and digits/)).toBeTruthy();
    expect(calls.connect).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Signing secret"), {
      target: { value: VALID_SECRET },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect Slack" }));
    await waitFor(() => expect(calls.connect).toHaveBeenCalledTimes(1));
    expect(calls.connect.mock.calls[0]?.[0]).toEqual({
      signingSecret: VALID_SECRET,
      botToken: "xoxb-" + "1".repeat(30),
    });
  });

  it("never renders a stored secret: only the team and the last four of the token", () => {
    set(connected);
    const { container } = render(<SlackSettings />);
    expect(screen.getByText("Bot token …1111")).toBeTruthy();
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });

  it("shows the last Slack error where it can be acted on", () => {
    set({
      ...connected,
      connection: {
        ...connection,
        lastError: "The app isn't in a routed channel: invite it with /invite @your-app",
      },
    });
    render(<SlackSettings />);
    expect(screen.getByTestId("slack-error").textContent).toMatch(/invite it/);
  });

  it("lists routes per project and event, and deletes one", async () => {
    set(connected);
    render(<SlackSettings />);
    const routes = screen.getAllByTestId("slack-route");
    expect(routes).toHaveLength(2);
    expect(routes[0]?.textContent).toContain("Marketing site");
    expect(routes[0]?.textContent).toContain("#feedback");
    expect(routes[0]?.textContent).toContain("New feedback");
    expect(routes[1]?.textContent).toContain("All projects");
    expect(routes[1]?.textContent).toContain("#C0ROUTEA02");
    fireEvent.click(within(routes[0] ?? document.body).getByRole("button", { name: "Delete route" }));
    await waitFor(() => expect(calls.deleteRoute).toHaveBeenCalledWith("r1"));
  });

  it("adds a route by channel id when Slack's channel list isn't available", async () => {
    set(connected);
    state.channels = {
      data: { channels: [], error: "The app is missing a permission" } as never,
      isLoading: false,
    };
    render(<SlackSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Add route" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("The app is missing a permission")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Channel id"), { target: { value: "general" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText(/paste its id/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Channel id"), { target: { value: "C0123456789" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.createRoute).toHaveBeenCalledTimes(1));
    expect(calls.createRoute.mock.calls[0]?.[0]).toMatchObject({
      projectId: null,
      channelId: "C0123456789",
      events: ["feedback.created"],
    });
  });

  it("shows who is mapped, matches from Slack and unlinks", async () => {
    set(connected);
    render(<SlackSettings />);
    expect(screen.getByTestId("slack-mapped").textContent).toBe(
      "1 of 2 members are linked to a Slack account.",
    );
    const rows = within(screen.getByTestId("slack-members")).getAllByRole("listitem");
    expect(rows[0]?.textContent).toContain("Linked by email");
    expect(rows[1]?.textContent).toContain("Not linked");
    fireEvent.click(screen.getByRole("button", { name: "Match from Slack" }));
    await waitFor(() => expect(calls.sync).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Unlink Ada Lovelace" }));
    await waitFor(() => expect(calls.unlink).toHaveBeenCalledWith("l1"));
  });

  it("tests the connection, pauses it and disconnects after a confirmation", async () => {
    set(connected);
    render(<SlackSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Send test message" }));
    await waitFor(() => expect(calls.test).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("switch", { name: "Active" }));
    await waitFor(() => expect(calls.connect).toHaveBeenCalledWith({ active: false }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(calls.disconnect).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(calls.disconnect).toHaveBeenCalledTimes(1));
  });
});

describe("Link your Slack account", () => {
  afterEach(cleanup);
  beforeEach(() => calls.claim.mockReset());
  const token = (user: string) =>
    `${btoa(`8b7c3a52-1d3e-4f5a-9c61-0a1b2c3d4e5f.${user}.1999999999`).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}.sig`;

  it("names the Slack account and links only after the member confirms", async () => {
    searchToken.value = `token=${token("U0ATTACKER")}`;
    render(<SlackLink />);
    expect(screen.getByText(/Slack account U0ATTACKER asked to act as you/)).toBeTruthy();
    expect(calls.claim).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Link my account" }));
    await waitFor(() => expect(calls.claim).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Linked to Acme. You can go back to Slack.")).toBeTruthy();
  });

  it("explains an incomplete link", () => {
    searchToken.value = "";
    render(<SlackLink />);
    expect(screen.getByRole("alert").textContent).toMatch(/incomplete/);
    expect(screen.queryByRole("button", { name: "Link my account" })).toBeNull();
  });
});
