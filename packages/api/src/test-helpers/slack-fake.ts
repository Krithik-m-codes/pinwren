import { type Mock, vi } from "vitest";
import type { SlackApi } from "../slack/client";

/** A Slack Web API double: every method succeeds with plausible data unless overridden. Calls are spies. */
export type FakeSlack = { [K in keyof SlackApi]: Mock<SlackApi[K]> };

export function fakeSlackApi(overrides: Partial<SlackApi> = {}): FakeSlack {
  const api = {
    authTest: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: {
          teamId: "T0FAKE0001",
          teamName: "Acme",
          teamUrl: "https://acme.slack.com/",
          botUserId: "U0BOT00001",
        },
      }),
    ),
    postMessage: vi.fn((a: { channel: string }) =>
      Promise.resolve({ ok: true as const, data: { channel: a.channel, ts: "1700000000.000100" } }),
    ),
    updateMessage: vi.fn(() => Promise.resolve({ ok: true as const, data: { ts: "1700000000.000100" } })),
    postEphemeral: vi.fn(() => Promise.resolve({ ok: true as const, data: {} })),
    openView: vi.fn(() => Promise.resolve({ ok: true as const, data: {} })),
    userInfo: vi.fn((id: string) =>
      Promise.resolve({
        ok: true as const,
        data: {
          id,
          name: "Pat",
          email: "pat@example.test",
          isBot: false,
          isRestricted: false,
          deleted: false,
        },
      }),
    ),
    listUsers: vi.fn(() => Promise.resolve({ ok: true as const, data: [] })),
    listChannels: vi.fn(() => Promise.resolve({ ok: true as const, data: [] })),
    ...overrides,
  };
  return api as never;
}
