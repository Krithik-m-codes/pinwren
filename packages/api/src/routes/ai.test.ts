import { beforeAll, describe, expect, it, vi } from "vitest";
import type * as Context from "../context";

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:1/none";
  process.env.PINWREN_URL ??= "http://localhost:3100";
  process.env.PINWREN_SECRET ??= "x".repeat(48);
});

vi.mock("../context", async (importOriginal) => {
  const actual = await importOriginal<typeof Context>();
  const { createMiddleware } = await import("hono/factory");
  return {
    ...actual,
    requireSession: createMiddleware(async (c, next) => {
      c.set("userId", "admin-user");
      c.set("orgId", "org-test-1");
      c.set("role", "admin");
      await next();
    }),
    requireOrgAdmin: createMiddleware(async (_c, next) => {
      await next();
    }),
  };
});

vi.mock("../services/ai", () => ({
  getOrgAiSettings: vi.fn().mockResolvedValue({
    provider: "anthropic",
    model: "claude-haiku-5-5",
    enabled: true,
    hasKey: true,
  }),
  updateOrgAiSettings: vi.fn().mockResolvedValue({
    provider: "openai",
    model: "gpt-4o-mini",
    enabled: true,
    hasKey: true,
  }),
  testAiConnection: vi.fn().mockResolvedValue({ ok: true, latencyMs: 120 }),
  getProjectAiConfig: vi.fn().mockResolvedValue({
    enabled: true,
    autoSummary: true,
    autoSeverity: true,
    detectDuplicates: true,
    generateRepro: true,
    allowReplayInAi: false,
  }),
  updateProjectAiConfig: vi.fn().mockResolvedValue({
    enabled: false,
    autoSummary: true,
    autoSeverity: true,
    detectDuplicates: true,
    generateRepro: true,
    allowReplayInAi: false,
  }),
  translateFeedbackReport: vi.fn().mockResolvedValue({
    targetLocale: "fr",
    title: "Titre traduit",
    body: "Corps traduit",
  }),
  applyAiTriageSuggestions: vi.fn().mockResolvedValue({ ok: true }),
}));

describe("AI API Routes", () => {
  it("returns AI settings for org", async () => {
    const { app } = await import("../index");
    const res = await app.request("/api/settings/ai", { method: "GET" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { provider: string; model: string; hasKey: boolean; enabled: boolean };
    expect(json.provider).toBe("anthropic");
    expect(json.hasKey).toBe(true);
  });

  it("updates AI settings for org", async () => {
    const { app } = await import("../index");
    const res = await app.request("/api/settings/ai", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-test",
        enabled: true,
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { provider: string; model: string };
    expect(json.provider).toBe("openai");
  });

  it("tests AI provider connectivity", async () => {
    const { app } = await import("../index");
    const res = await app.request("/api/settings/ai/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "anthropic",
        model: "claude-haiku-5-5",
        apiKey: "sk-test",
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; latencyMs: number };
    expect(json.ok).toBe(true);
    expect(json.latencyMs).toBe(120);
  });

  it("gets project AI configuration", async () => {
    const { app } = await import("../index");
    const res = await app.request("/api/projects/proj-1/ai", { method: "GET" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { enabled: boolean; autoSummary: boolean };
    expect(json.enabled).toBe(true);
    expect(json.autoSummary).toBe(true);
  });

  it("updates project AI configuration", async () => {
    const { app } = await import("../index");
    const res = await app.request("/api/projects/proj-1/ai", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { enabled: boolean };
    expect(json.enabled).toBe(false);
  });

  it("translates feedback report", async () => {
    const { app } = await import("../index");
    const res = await app.request("/api/feedback/fb-1/ai/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetLocale: "fr" }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { targetLocale: string; body: string };
    expect(json.targetLocale).toBe("fr");
    expect(json.body).toBe("Corps traduit");
  });

  it("applies AI suggestions to feedback item", async () => {
    const { app } = await import("../index");
    const res = await app.request("/api/feedback/fb-1/ai/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ applyTitle: true, applyPriority: true }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
  });
});
