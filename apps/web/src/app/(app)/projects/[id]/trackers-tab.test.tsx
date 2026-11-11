// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueIntegration, ProjectDetail } from "@/lib/api";

const create = vi.fn();
const update = vi.fn();
const register = vi.fn();
const restart = vi.fn();
let integrations: IssueIntegration[] = [];

const mutation = (fn: (args: unknown) => unknown) => [
  (args: unknown) => ({ unwrap: () => Promise.resolve(fn(args)) }),
  { isLoading: false },
];

vi.mock("@/lib/store/api", () => ({
  errorMessage: (e: unknown, fallback = "error") => (e instanceof Error ? e.message : fallback),
  isForbidden: () => false,
  useTrackersQuery: () => ({ data: { integrations }, isLoading: false, error: undefined, refetch: vi.fn() }),
  useEntitlementsQuery: () => ({ data: { features: [] }, isLoading: false }),
  useCreateTrackerMutation: () => mutation((a) => create(a)),
  useUpdateTrackerMutation: () => mutation((a) => update(a)),
  useRegisterTrackerWebhookMutation: () => mutation((a) => register(a)),
  useRestartTrackerHandshakeMutation: () => mutation((a) => restart(a)),
  useTestTrackerMutation: () => mutation(() => ({ ok: true, name: "Board" })),
  useDeleteTrackerMutation: () => mutation(() => undefined),
  useLazyTrackerWebhookSecretQuery: () => [
    () => ({ unwrap: () => Promise.resolve({ secret: "secret_verification", url: "", pending: false }) }),
    { isFetching: false },
  ],
}));

import { TrackersTab } from "./trackers-tab";

const project = { id: "p1", name: "Site" } as unknown as ProjectDetail;
const base = {
  projectId: "p1",
  apiUrl: null,
  email: null,
  apiKey: null,
  labels: [],
  autoCreate: "manual",
  active: true,
  tokenHint: "…abcd",
  lastError: null,
  settings: {},
  webhookRegistered: false,
  webhookPending: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as const;
const connected = (over: Partial<IssueIntegration> & Pick<IssueIntegration, "provider" | "repo">) =>
  ({
    id: `i-${over.provider}`,
    webhookUrl: `https://p.dev/hook/${over.provider}`,
    ...base,
    ...over,
  }) as IssueIntegration;

const isDisabled = (el: HTMLElement) => el.hasAttribute("disabled");

/** Submit the form a button belongs to. */
function submit(button: HTMLElement) {
  const form = button.closest("form");
  if (!form) throw new Error("button is not in a form");
  fireEvent.submit(form);
}

describe("TrackersTab: board trackers", () => {
  afterEach(cleanup);
  beforeEach(() => {
    integrations = [];
    for (const m of [create, update, register, restart]) m.mockReset().mockReturnValue({});
  });

  it("offers Trello, Asana, ClickUp and Notion next to the existing trackers", () => {
    render(<TrackersTab project={project} />);
    for (const name of ["GitHub", "GitLab", "Linear", "Jira", "Trello", "Asana", "ClickUp", "Notion"]) {
      expect(screen.getByTestId(`tracker-${name.toLowerCase()}`), name).toBeTruthy();
    }
  });

  it("connects Trello with its API key and mapping, and refuses without a list", async () => {
    render(<TrackersTab project={project} />);
    const card = within(screen.getByTestId("tracker-trello"));
    fireEvent.click(card.getByRole("button", { name: "Connect Trello" }));
    fireEvent.change(card.getByLabelText("API key"), { target: { value: "trello-key-123456" } });
    fireEvent.change(card.getByLabelText("Token"), { target: { value: "trello-token-abcdef" } });
    fireEvent.change(card.getByLabelText("Board id"), { target: { value: "5f1a2b3c4d5e6f7a8b9c0d1e" } });
    fireEvent.change(card.getByLabelText("Priority: high"), { target: { value: "High" } });
    submit(card.getByRole("button", { name: "Connect Trello" }));
    await waitFor(() => expect(screen.getByText("listId is required")).toBeTruthy());
    expect(create).not.toHaveBeenCalled();

    fireEvent.change(card.getByLabelText("New cards go to list"), { target: { value: "list1" } });
    submit(card.getByRole("button", { name: "Connect Trello" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      projectId: "p1",
      body: {
        provider: "trello",
        apiKey: "trello-key-123456",
        token: "trello-token-abcdef",
        repo: "5f1a2b3c4d5e6f7a8b9c0d1e",
        settings: { listId: "list1", priorityHigh: "High" },
      },
    });
    expect((create.mock.calls[0]?.[0] as { body: Record<string, unknown> }).body).not.toHaveProperty("email");
  });

  it("connects Notion without a key or URL, sending an empty mapping", async () => {
    render(<TrackersTab project={project} />);
    const card = within(screen.getByTestId("tracker-notion"));
    fireEvent.click(card.getByRole("button", { name: "Connect Notion" }));
    expect(card.queryByLabelText("API key")).toBeNull();
    fireEvent.change(card.getByLabelText("Integration secret"), {
      target: { value: "secret_notion_abcdef" },
    });
    fireEvent.change(card.getByLabelText("Database id"), {
      target: { value: "0f0f0f0f0f0f4f0f8f0f0f0f0f0f0f0f" },
    });
    submit(card.getByRole("button", { name: "Connect Notion" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    const body = (create.mock.calls[0]?.[0] as { body: Record<string, unknown> }).body;
    expect(body).toMatchObject({ provider: "notion", settings: {}, apiUrl: null });
    expect(body).not.toHaveProperty("apiKey");
  });

  it("saves the mapping as one object when a field is edited", async () => {
    integrations = [connected({ provider: "clickup", repo: "9001", settings: { closedStatus: "complete" } })];
    render(<TrackersTab project={project} />);
    const card = within(screen.getByTestId("tracker-clickup"));
    const field = card.getByLabelText("Open status");
    fireEvent.change(field, { target: { value: "to do" } });
    fireEvent.blur(field);
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]?.[0]).toMatchObject({
      id: "i-clickup",
      patch: { settings: { closedStatus: "complete", openStatus: "to do" } },
    });
  });

  it("registers a webhook, and shows what each tracker is waiting for", async () => {
    integrations = [
      connected({ provider: "asana", repo: "1200000001", webhookPending: true }),
      connected({ provider: "clickup", repo: "9001", webhookRegistered: true }),
      connected({ provider: "notion", repo: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f", webhookPending: true }),
      connected({
        provider: "trello",
        repo: "5f1a2b3c4d5e6f7a8b9c0d1e",
        apiKey: "trello-key-123456",
        webhookPending: true,
        settings: { listId: "l" },
      }),
    ];
    render(<TrackersTab project={project} />);
    const asana = within(screen.getByTestId("tracker-asana"));
    expect(asana.getByTestId("tracker-hook-status").textContent).toContain("Waiting for the signing secret");
    fireEvent.click(asana.getByRole("button", { name: /Register webhook/ }));
    await waitFor(() => expect(register).toHaveBeenCalledWith({ id: "i-asana", projectId: "p1" }));

    const clickup = within(screen.getByTestId("tracker-clickup"));
    expect(clickup.getByTestId("tracker-hook-status").textContent).toContain("Webhook registered");
    expect(clickup.getByRole("button", { name: /Register again/ })).toBeTruthy();

    const notion = within(screen.getByTestId("tracker-notion"));
    expect(notion.getByTestId("tracker-hook-status").textContent).toContain("verification token");
    expect(isDisabled(notion.getByRole("button", { name: /Wait for a new token/ }))).toBe(true);

    // Trello can't register before its app secret is pasted.
    const trello = within(screen.getByTestId("tracker-trello"));
    expect(isDisabled(trello.getByRole("button", { name: /Register webhook/ }))).toBe(true);
    expect(trello.getByText("Paste the app secret before registering the webhook.")).toBeTruthy();
  });

  it("reveals Notion's verification token once it has arrived, and no other board tracker's secret", async () => {
    integrations = [
      connected({ provider: "notion", repo: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f" }),
      connected({ provider: "asana", repo: "1200000001" }),
    ];
    render(<TrackersTab project={project} />);
    expect(
      within(screen.getByTestId("tracker-asana")).queryByRole("button", { name: /Reveal webhook secret/ }),
    ).toBeNull();
    const notion = within(screen.getByTestId("tracker-notion"));
    fireEvent.click(notion.getByRole("button", { name: /Reveal webhook secret/ }));
    await waitFor(() => expect(notion.getByTestId("tracker-secret").textContent).toBe("secret_verification"));
  });
});
