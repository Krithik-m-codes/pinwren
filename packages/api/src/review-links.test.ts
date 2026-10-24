import { feedbackListQuery, REVIEW_TOKEN_RE, viewFilters } from "@pinwren/core";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type * as Context from "./context";

// Wave 5 — review links / guest review (docs/contracts/wave-5.md §3.5): token shape and lookup guards, the
// list shape (never the token), the inbox filter, and who may call the routes.

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:1/none";
  process.env.PINWREN_URL ??= "http://localhost:3100";
  process.env.PINWREN_SECRET ??= "x".repeat(48);
});

const session = vi.hoisted(() => ({ role: "member" }));

vi.mock("./context", async (importOriginal) => {
  const actual = await importOriginal<typeof Context>();
  const { createMiddleware } = await import("hono/factory");
  return {
    ...actual,
    // A signed-in member with a chosen role, without Better Auth or a database.
    requireSession: createMiddleware(async (c, next) => {
      c.set("userId", "user-1");
      c.set("orgId", "org-1");
      c.set("role", session.role);
      await next();
    }),
  };
});

describe("review tokens", () => {
  it("accept only the shape that is handed out", async () => {
    const { plausibleToken } = await import("./services/review-links");
    const { randomToken } = await import("./crypto");
    expect(plausibleToken(`pwr_${randomToken(24)}`)).toBe(true);
    expect(REVIEW_TOKEN_RE.test(`pwr_${randomToken(24)}`)).toBe(true);
    for (const bad of [
      undefined,
      "",
      "pwr_short",
      "abc_0123456789abcdefghij",
      "pwr_has spaces in it here",
      `pwr_${"a".repeat(101)}`,
    ]) {
      expect(plausibleToken(bad)).toBe(false);
    }
  });

  it("never reach the database when malformed", async () => {
    const { findReviewLink } = await import("./services/review-links");
    // DATABASE_URL points nowhere: a query would reject, a guard returns null at once.
    await expect(findReviewLink("p", undefined)).resolves.toBeNull();
    await expect(findReviewLink("p", "not a token")).resolves.toBeNull();
  });

  it("record use at most once a minute", async () => {
    const { shouldTouch } = await import("./services/review-links");
    const now = new Date("2026-10-22T12:00:00Z");
    expect(shouldTouch(null, now)).toBe(true);
    expect(shouldTouch(new Date("2026-10-22T11:59:30Z"), now)).toBe(false);
    expect(shouldTouch(new Date("2026-10-22T11:58:00Z"), now)).toBe(true);
  });
});

describe("review link payloads", () => {
  it("list a link with its item count and without the token or its hash", async () => {
    const { linkOut } = await import("./services/review-links");
    const row = {
      id: "l1",
      orgId: "org-1",
      projectId: "p1",
      label: "Acme sign-off",
      tokenHash: "f".repeat(64),
      expiresAt: null,
      createdBy: "user-1",
      createdAt: new Date("2026-10-01T00:00:00Z"),
      lastUsedAt: null,
      revokedAt: null,
    };
    const out = linkOut(row, 3);
    expect(out).toEqual({
      id: "l1",
      label: "Acme sign-off",
      url: null,
      expiresAt: null,
      createdAt: row.createdAt,
      lastUsedAt: null,
      revokedAt: null,
      feedbackCount: 3,
    });
    expect(JSON.stringify(out)).not.toContain("f".repeat(64));
    expect(linkOut(row).feedbackCount).toBe(0);
  });

  it("filter the inbox and saved views by link id", () => {
    const id = "0192f0c4-4f6e-7c1a-8d55-9a3e2b1c4d5e";
    expect(feedbackListQuery.parse({ reviewLinkId: id }).reviewLinkId).toBe(id);
    expect(feedbackListQuery.safeParse({ reviewLinkId: "nope" }).success).toBe(false);
    expect(viewFilters.parse({ reviewLinkId: id })).toEqual({ reviewLinkId: id });
  });
});

describe("who may call the review-link routes", () => {
  const ID = "0192f0c4-4f6e-7c1a-8d55-9a3e2b1c4d5e";
  const call = async (method: string, path: string, headers: Record<string, string> = {}) => {
    const { app } = await import("./index");
    const res = await app.request(path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(method === "GET" ? {} : { body: "{}" }),
    });
    return `${res.status} ${((await res.json()) as { code?: string }).code ?? ""}`;
  };

  it("keeps listing, making and revoking links to Admins", async () => {
    for (const role of ["member", "viewer"]) {
      session.role = role;
      expect(await call("GET", `/api/projects/${ID}/review-links`)).toMatch(/^403 /);
      expect(await call("POST", `/api/projects/${ID}/review-links`)).toMatch(/^403 /);
      expect(await call("DELETE", `/api/review-links/${ID}`)).toMatch(/^403 /);
    }
  }, 60_000);

  it("validates an Admin's new link before touching the database", async () => {
    session.role = "admin";
    expect(await call("POST", `/api/projects/${ID}/review-links`)).toMatch(/^400 /);
  }, 60_000);

  it("needs the project key for the widget's token check", async () => {
    expect(await call("GET", "/w/review-link", { "x-pinwren-review-token": "pwr_x" })).toBe(
      "401 MISSING_PROJECT_KEY",
    );
  }, 60_000);
});
