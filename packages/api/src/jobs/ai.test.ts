import { beforeAll, describe, expect, it, vi } from "vitest";
import type * as Db from "@pinwren/db";
import { consoleErrorLines, failedRequests, runAiEnrichmentJob } from "./ai";

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:1/none";
  process.env.PINWREN_URL ??= "http://localhost:3100";
  process.env.PINWREN_SECRET ??= "x".repeat(48);
});

const mockProjectState = vi.hoisted(() => ({
  enabled: false,
}));

vi.mock("@pinwren/db", async (importOriginal) => {
  const actual = await importOriginal<typeof Db>();
  const database = () => ({
    select: vi.fn(() => ({
      from: vi.fn((table) => ({
        where: vi.fn(() => {
          if (table === actual.project) {
            return [
              {
                aiConfig: {
                  enabled: mockProjectState.enabled,
                  autoSummary: true,
                  autoSeverity: true,
                  detectDuplicates: false,
                  generateRepro: false,
                  allowReplayInAi: false,
                },
                widgetConfig: {},
              },
            ];
          }
          return [];
        }),
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => [
            {
              id: "00000000-0000-0000-0000-000000000001",
              title: "Login issue",
              body: "Cannot login with password",
              anchor: null,
              pageUrl: "https://example.com/login",
            },
          ]),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn().mockResolvedValue([]),
      })),
    })),
  });
  return {
    ...actual,
    getDb: vi.fn(database),
    withOrg: vi.fn((_orgId: string, fn: (db: ReturnType<typeof database>) => unknown) =>
      Promise.resolve(fn(database())),
    ),
  };
});

vi.mock("../services/ai", () => ({
  getAiClientForOrg: vi.fn().mockResolvedValue({
    model: "test-model",
    provider: {
      id: "openai",
      complete: vi.fn().mockResolvedValue({
        suggestedTitle: "Login failure with password",
        summary: "User cannot authenticate using password credentials.",
      }),
    },
  }),
}));

describe("runAiEnrichmentJob", () => {
  it("skips enrichment when project AI is disabled", async () => {
    mockProjectState.enabled = false;
    const res = await runAiEnrichmentJob({
      feedbackId: "00000000-0000-0000-0000-000000000001",
      orgId: "org-1",
      projectId: "proj-1",
    });
    expect(res.status).toBe("skipped");
  });

  it("completes enrichment when project AI is enabled", async () => {
    mockProjectState.enabled = true;
    const res = await runAiEnrichmentJob({
      feedbackId: "00000000-0000-0000-0000-000000000001",
      orgId: "org-1",
      projectId: "proj-1",
    });
    expect(res.status).toBe("completed");
  });
});

describe("what the model is shown of a report's diagnostics", () => {
  it("turns captured console entries into lines and drops plain logs", () => {
    const lines = consoleErrorLines([
      { level: "error", message: "TypeError: x is undefined", at: 1 },
      { level: "log", message: "hello", at: 2 },
      { level: "warn", message: "deprecated" },
      "raw string",
    ]);
    expect(lines).toEqual(["error: TypeError: x is undefined", "warn: deprecated", "raw string"]);
    expect(consoleErrorLines(null)).toEqual([]);
  });

  it("keeps only failed requests and strips the query string", () => {
    const out = failedRequests([
      { method: "GET", url: "https://a.test/ok?token=1", status: 200 },
      { method: "POST", url: "https://a.test/pay?token=secret#x", status: 500, durationMs: 140 },
      { method: "GET", url: "https://a.test/aborted", status: 0 },
      { nonsense: true },
    ]);
    expect(out).toEqual([
      { method: "POST", url: "https://a.test/pay", status: 500, durationMs: 140 },
      { method: "GET", url: "https://a.test/aborted", status: 0 },
    ]);
  });

  it("caps how much is sent", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ level: "error", message: `e${i}` }));
    expect(consoleErrorLines(many)).toHaveLength(20);
  });
});
