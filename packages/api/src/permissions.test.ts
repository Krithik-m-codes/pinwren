import { beforeAll, describe, expect, it, vi } from "vitest";
import type * as Context from "./context";

// Every mutating dashboard route must refuse a viewer (wave-4 contract §4). This walks the real route
// table, so a route added later without a deliberate exemption fails here.

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:1/none";
  process.env.PINWREN_URL ??= "http://localhost:3100";
  process.env.PINWREN_SECRET ??= "x".repeat(48);
});

// What the mocked session holds: a viewer by default, or a custom-role member (F-093) in a test.
const session = vi.hoisted(() => ({ role: "viewer", customPermissions: null as string[] | null }));

vi.mock("./context", async (importOriginal) => {
  const actual = await importOriginal<typeof Context>();
  const { createMiddleware } = await import("hono/factory");
  return {
    ...actual,
    // A signed-in viewer, without Better Auth or a database.
    requireSession: createMiddleware(async (c, next) => {
      c.set("userId", "viewer-user");
      c.set("orgId", "org-1");
      c.set("role", session.role);
      c.set("customPermissions", session.customPermissions);
      await next();
    }),
  };
});

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const ID = "0192f0c4-4f6e-7c1a-8d55-9a3e2b1c4d5e";
const concrete = (path: string) => path.replace(/:[A-Za-z]+/g, ID).replace(/\*/g, "x");

describe("viewer role", () => {
  it("is refused on every mutating dashboard route", async () => {
    const { app } = await import("./index");
    const { dashboard } = await import("./routes/dashboard");
    const { viewerMayCall } = await import("./permissions");
    const seen = new Set<string>();
    // Sub-routers' routes can appear more than once in the merged table.
    const routes = dashboard.routes.filter((r) => {
      const k = `${r.method} ${r.path}`;
      if (!MUTATING.has(r.method) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    expect(routes.length).toBeGreaterThan(40);
    const refused: string[] = [];
    const exempt: string[] = [];
    for (const r of routes) {
      const path = `/api${r.path}`;
      if (!viewerMayCall(r.method, path)) {
        const res = await app.request(concrete(path), {
          method: r.method,
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        const body = (await res.json()) as { code?: string };
        expect(`${r.method} ${path} → ${res.status} ${body.code ?? ""}`).toBe(
          `${r.method} ${path} → 403 READ_ONLY_ROLE`,
        );
        refused.push(`${r.method} ${path}`);
      } else {
        exempt.push(`${r.method} ${path}`);
      }
    }
    // The exemptions are personal state only; listing them keeps a new one a conscious decision.
    expect(exempt.filter((e) => !e.includes("/api/admin/")).sort()).toEqual(
      [
        "DELETE /api/tokens/:id",
        "DELETE /api/views/:id",
        "PATCH /api/views/:id",
        "POST /api/notifications/read",
        "POST /api/presence",
        "POST /api/tokens",
        "POST /api/views",
        "PUT /api/notification-preferences",
        "PATCH /api/me/preferences",
        "POST /api/feedback/:id/watch",
        "DELETE /api/feedback/:id/watch",
        "POST /api/dashboards",
        "PATCH /api/dashboards/:id",
        "DELETE /api/dashboards/:id",
        "POST /api/dashboards/:id/duplicate",
        "PATCH /api/me/workspace-preferences",
        "PATCH /api/me/ui-state",
      ].sort(),
    );
    expect(refused).toContain("PATCH /api/feedback/:id");
    expect(refused).toContain("POST /api/projects/:id/rounds");
  }, 60_000);

  it("lets a custom-role member write only through routes that name their permission", async () => {
    // A stale Editor base on purpose: the guard must hold even if the stored base role is wider than the role.
    session.role = "member";
    session.customPermissions = ["feedback.read", "labels.manage"];
    try {
      const { app } = await import("./index");
      const { dashboard } = await import("./routes/dashboard");
      const { viewerMayCall } = await import("./permissions");
      const seen = new Set<string>();
      const reached: string[] = [];
      for (const r of dashboard.routes) {
        const key = `${r.method} ${r.path}`;
        if (!MUTATING.has(r.method) || seen.has(key)) continue;
        seen.add(key);
        const path = `/api${r.path}`;
        if (viewerMayCall(r.method, path)) continue;
        const res = await app.request(concrete(path), {
          method: r.method,
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        if (res.status !== 403) reached.push(key);
      }
      // Only the label routes (their own permission) get past the guard; everything else is a 403.
      expect(reached.every((k) => k.includes("/labels"))).toBe(true);
      expect(reached.length).toBeGreaterThan(0);
    } finally {
      session.role = "viewer";
      session.customPermissions = null;
    }
  }, 60_000);

  it("resolves a custom role's permissions per route", async () => {
    session.role = "member";
    session.customPermissions = ["feedback.read", "feedback.update"];
    try {
      const { app } = await import("./index");
      const call = async (method: string, path: string) =>
        (
          await app.request(path, {
            method,
            headers: { "content-type": "application/json" },
            ...(method === "GET" ? {} : { body: "{}" }),
          })
        ).status;
      // Held: reaches validation (400), not the role check.
      expect(await call("PATCH", `/api/feedback/${ID}`)).not.toBe(403);
      // Not held although the Editor base would allow it.
      expect(await call("POST", `/api/feedback/${ID}/comments`)).toBe(403);
      expect(await call("DELETE", `/api/feedback/${ID}`)).toBe(403);
      // Never grantable: role management and Admin-only areas.
      expect(await call("POST", "/api/roles")).toBe(403);
      expect(await call("PATCH", "/api/members/someone")).toBe(403);
      expect(await call("PATCH", "/api/branding")).toBe(403);
      expect(await call("GET", "/api/audit")).toBe(403);
    } finally {
      session.role = "viewer";
      session.customPermissions = null;
    }
  }, 60_000);

  it("parses Better Auth role strings", async () => {
    const { isReadOnlyRole, viewerMayCall } = await import("./permissions");
    expect(isReadOnlyRole("viewer")).toBe(true);
    expect(isReadOnlyRole("viewer, member")).toBe(false);
    expect(isReadOnlyRole("member")).toBe(false);
    expect(isReadOnlyRole("")).toBe(false);
    expect(viewerMayCall("GET", "/api/feedback/1")).toBe(true);
    expect(viewerMayCall("PATCH", "/api/feedback/1")).toBe(false);
    expect(viewerMayCall("DELETE", "/api/tokens/abc/")).toBe(true);
    expect(viewerMayCall("POST", "/api/tokens/abc/rotate")).toBe(false);
  });
});
