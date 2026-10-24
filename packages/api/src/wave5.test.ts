import { EMAIL_TEMPLATE_KEYS, WEBHOOK_EVENTS } from "@pinwren/core";
import { beforeAll, describe, expect, it } from "vitest";
import type { SessionVars } from "./context";

// Wave-5 foundation (docs/contracts/wave-5.md): templates for every key, the new domain events.

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://unused";
  process.env.PINWREN_URL ??= "http://localhost:3100";
  process.env.PINWREN_SECRET ??= "x".repeat(48);
});

describe("email templates (wave 5)", () => {
  it("has a definition for every key, rendering with its own sample values", async () => {
    const { renderDefault, sampleVariables, TEMPLATES, unknownVariables } = await import("./email/templates");
    for (const key of EMAIL_TEMPLATE_KEYS) {
      const def = TEMPLATES[key];
      expect(def.key).toBe(key);
      expect(unknownVariables(key, def.subject, def.body)).toEqual([]);
      if (def.cta) expect(def.variables.map((x) => x.name)).toContain(def.cta.urlVariable);
      const out = renderDefault(key, sampleVariables(key));
      expect(out.subject).not.toContain("{{");
      expect(out.text).not.toContain("{{");
      if (def.cta) expect(out.html).toContain("href=");
    }
  });

  it("keeps account emails out of the workspace editor", async () => {
    const { ORG_TEMPLATE_KEYS } = await import("./email/templates");
    for (const k of ["password_reset", "verify_email", "change_email"] as const) {
      expect(ORG_TEMPLATE_KEYS).not.toContain(k);
    }
    for (const k of [
      "mentioned",
      "priority_changed",
      "digest",
      "reporter_received",
      "webhook_disabled",
    ] as const) {
      expect(ORG_TEMPLATE_KEYS).toContain(k);
    }
  });

  it("titles every webhook event in chat messages", async () => {
    const { slackBody } = await import("./webhooks/format");
    for (const event of WEBHOOK_EVENTS) {
      const body = JSON.stringify(
        slackBody({
          id: "e1",
          event,
          apiVersion: "2026-11-01",
          createdAt: "2026-10-21T00:00:00.000Z",
          data: {
            feedback: {
              id: "f1",
              number: 1,
              projectId: "p1",
              projectName: "Site",
              kind: "bug",
              status: "open",
              priority: "none",
              title: "Broken",
              body: "b",
              pageUrl: null,
              reporterName: null,
              url: "https://x/inbox",
              createdAt: "2026-10-21T00:00:00.000Z",
            },
          },
        } as Parameters<typeof slackBody>[0]),
      );
      expect(body).not.toContain(event); // a human title, not the raw event name
    }
  });
});

describe("update events (wave 5)", () => {
  const base = { orgId: "o1", feedbackId: "f1", actor: { kind: "user" as const, id: "u1" } };

  it("emits priority_changed and labels_changed next to feedback.updated", async () => {
    const { updateEvents } = await import("./events");
    const out = updateEvents(
      base,
      { priority: "low", labelIds: ["a"] },
      { priority: "urgent", labelIds: ["a", "b"] },
      ["priority", "labelIds"],
    );
    expect(out.map((e) => e.type)).toEqual([
      "feedback.updated",
      "feedback.priority_changed",
      "feedback.labels_changed",
    ]);
    expect(out[1]?.changes).toEqual({ priority: { from: "low", to: "urgent" } });
    expect(out[2]?.changes).toEqual({ labelIds: { from: ["a"], to: ["a", "b"] } });
  });

  it("emits nothing when nothing changed", async () => {
    const { updateEvents } = await import("./events");
    expect(updateEvents(base, { priority: "low" }, { priority: "low" }, ["priority"])).toEqual([]);
  });
});

describe("requirePermission (wave 5)", () => {
  const appFor = async (role: string) => {
    const { Hono } = await import("hono");
    const { requirePermission } = await import("./permissions");
    const { ApiError } = await import("./errors");
    return new Hono<{ Variables: SessionVars }>()
      .use(async (c, next) => {
        c.set("role", role);
        await next();
      })
      .onError((err, c) =>
        err instanceof ApiError ? c.json({ code: err.code }, err.status as 403) : c.json({}, 500),
      )
      .delete("/x", requirePermission("feedback.delete"), (c) => c.json({ ok: true }));
  };

  it("lets Admins delete and refuses Editors and Viewers", async () => {
    for (const [role, status] of [
      ["owner", 200],
      ["admin", 200],
      ["member", 403],
      ["viewer", 403],
    ] as const) {
      const res = await (await appFor(role)).request("/x", { method: "DELETE" });
      expect(`${role} ${res.status}`).toBe(`${role} ${status}`);
      if (status === 403) expect(((await res.json()) as { code: string }).code).toBe("FORBIDDEN_ROLE");
    }
  });

  it("allows viewers the wave-5 personal routes up front", async () => {
    const { viewerMayCall } = await import("./permissions");
    expect(viewerMayCall("POST", "/api/feedback/abc/watch")).toBe(true);
    expect(viewerMayCall("DELETE", "/api/feedback/abc/watch")).toBe(true);
    expect(viewerMayCall("PATCH", "/api/me/preferences")).toBe(true);
    expect(viewerMayCall("POST", "/api/feedback/abc/restore")).toBe(false);
  });
});
