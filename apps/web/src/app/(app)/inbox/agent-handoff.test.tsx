// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedbackDetail } from "@/lib/api";

const brief = {
  feedbackId: "f1",
  number: 12,
  title: "Pay button does nothing",
  markdown: "# Fix feedback #12: Pay button does nothing\n",
  hints: { repo: null, searchTerms: [], route: null, files: [] },
  commands: {
    claude: "claude 'Fix Pinwren feedback #12'",
    claudeMcpSetup: "",
    claudePipe: "",
    vscode: "code chat 'x'",
  },
  links: { cursor: "cursor://anysphere.cursor-deeplink/prompt?text=x", dashboard: "https://p.dev/inbox" },
  privacy: { replayIncluded: false, screenshotIncluded: false, note: "" },
};
const test = {
  feedbackId: "f1",
  filename: "pinwren-12-pay.spec.ts",
  language: "typescript",
  code: 'import { test } from "@playwright/test";',
  caveats: ["This is a draft generated from the report."],
  stats: { scripted: 2, skipped: 1, hasReplay: true, expectations: ["no console errors"] },
  polished: false,
};
const runAction = vi.fn();
const copy = vi.fn();

vi.mock("@/lib/store/api", () => ({
  errorMessage: (e: unknown, fallback = "error") => (e instanceof Error ? e.message : fallback),
  useAgentBriefQuery: () => ({ data: brief, isLoading: false, isError: false }),
  useReproTestQuery: () => ({ data: test, isLoading: false, isError: false }),
  useRunPanelActionMutation: () => [
    (args: unknown) => ({ unwrap: () => Promise.resolve(runAction(args)) }),
    { isLoading: false, originalArgs: undefined },
  ],
}));
vi.mock("@/components/copy-button", () => ({
  copyText: (...a: unknown[]) => {
    copy(...a);
    return Promise.resolve(true);
  },
}));

import { AgentHandoff } from "./agent-handoff";

const detail = (panelActions: unknown[]) =>
  ({ feedback: { id: "f1", number: 12 }, panelActions }) as unknown as FeedbackDetail;

describe("AgentHandoff", () => {
  afterEach(cleanup);
  beforeEach(() => {
    runAction.mockReset().mockReturnValue({ ok: true, status: 200, message: "Queued", error: null });
    copy.mockReset();
  });

  it("copies the brief and the claude command", async () => {
    render(<AgentHandoff data={detail([])} />);
    fireEvent.click(screen.getByTestId("fix-with-agent"));
    fireEvent.click(await screen.findByTestId("copy-brief"));
    expect(copy.mock.calls[0]?.[0]).toBe(brief.markdown);
    fireEvent.click(screen.getByTestId("copy-claude"));
    expect(copy.mock.calls[1]?.[0]).toBe(brief.commands.claude);
    expect(screen.getByTestId("brief-preview").textContent).toContain("# Fix feedback #12");
    expect(screen.queryByTestId("send-to-agent")).toBeNull();
  });

  it("offers only agent webhooks under send-to, and runs the panel action", async () => {
    render(
      <AgentHandoff
        data={detail([
          { id: "plain", label: "Ping", kind: "webhook", url: "", agent: false },
          { id: "link", label: "Jira", kind: "link", url: "https://j.dev", agent: false },
          { id: "claude-bot", label: "Claude bot", kind: "webhook", url: "", agent: true },
        ])}
      />,
    );
    fireEvent.click(screen.getByTestId("fix-with-agent"));
    const send = await screen.findAllByTestId("send-to-agent");
    expect(send).toHaveLength(1);
    expect(send[0]?.textContent).toContain("Claude bot");
    const sendButton = send[0];
    if (!sendButton) throw new Error("no send button");
    fireEvent.click(sendButton);
    await waitFor(() => expect(runAction).toHaveBeenCalledWith({ feedbackId: "f1", actionId: "claude-bot" }));
  });

  it("shows the draft test with its caveats and a copy button", async () => {
    render(<AgentHandoff data={detail([])} />);
    fireEvent.click(screen.getByTestId("fix-with-agent"));
    const tab = await screen.findByRole("tab", { name: /Repro test/ });
    fireEvent.click(tab);
    expect((await screen.findByTestId("repro-caveats")).textContent).toContain("draft generated");
    expect(screen.getByTestId("repro-code").textContent).toContain("@playwright/test");
    fireEvent.click(screen.getByTestId("copy-test"));
    expect(copy.mock.calls.at(-1)?.[0]).toBe(test.code);
  });
});
