import { beforeAll, describe, expect, it, vi } from "vitest";
import type * as Context from "./context";

// Wave 5 — widget area (docs/contracts/wave-5.md §3.3): signed page links, refused origins, reporter tokens,
// page re-grouping, and the session routes' role checks (which run before any database access).

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:1/none";
  process.env.PINWREN_URL ??= "http://localhost:3100";
  process.env.PINWREN_SECRET ??= "x".repeat(48);
});

const role = vi.hoisted(() => ({ value: "viewer" }));
vi.mock("./context", async (importOriginal) => {
  const actual = await importOriginal<typeof Context>();
  const { createMiddleware } = await import("hono/factory");
  return {
    ...actual,
    requireSession: createMiddleware(async (c, next) => {
      c.set("userId", "user-1");
      c.set("orgId", "org-1");
      c.set("role", role.value);
      await next();
    }),
  };
});

const ID = "0192f0c4-4f6e-7c1a-8d55-9a3e2b1c4d5e";

describe("page-link tokens", () => {
  it("round-trips, carries the scope and expires", async () => {
    const { pageLinkToken, verifyPageLinkToken } = await import("./services/page-link");
    const now = Date.UTC(2026, 0, 1);
    const read = pageLinkToken(ID, { now, ttlMs: 60_000 });
    expect(verifyPageLinkToken(read.token, now)).toEqual({
      feedbackId: ID,
      expiresAt: read.expiresAt,
      scope: "read",
    });
    expect(verifyPageLinkToken(read.token, now + 61_000)).toBeNull();
    const repin = pageLinkToken(ID, { now, scope: "repin" });
    expect(verifyPageLinkToken(repin.token, now)?.scope).toBe("repin");
  });

  it("refuses forged, altered and malformed tokens", async () => {
    const { pageLinkToken, verifyPageLinkToken } = await import("./services/page-link");
    const { token } = pageLinkToken(ID);
    const [part, mac] = token.split(".") as [string, string];
    // Upgrading a read link to a re-pin link changes the signed part.
    const upgraded = Buffer.from(`${Buffer.from(part, "base64url").toString()}.repin`).toString("base64url");
    expect(verifyPageLinkToken(`${upgraded}.${mac}`)).toBeNull();
    expect(verifyPageLinkToken(`${part}.${mac.slice(1)}x`)).toBeNull();
    expect(verifyPageLinkToken(`${part}.${mac}.extra`)).toBeNull();
    expect(verifyPageLinkToken("")).toBeNull();
    expect(verifyPageLinkToken(null)).toBeNull();
    expect(verifyPageLinkToken("a".repeat(600))).toBeNull();
  });

  it("caps the lifetime at 90 days", async () => {
    const { pageLinkToken } = await import("./services/page-link");
    const now = Date.UTC(2026, 0, 1);
    const { expiresAt } = pageLinkToken(ID, { now, ttlMs: 10_000 * 86_400_000 });
    expect(expiresAt.getTime() - now).toBeLessThanOrEqual(90 * 86_400_000);
  });

  it("builds the page URL with the deep-link parameters, replacing old ones", async () => {
    const { pageLinkUrl, verifyPageLinkToken } = await import("./services/page-link");
    const { url } = pageLinkUrl(ID, "https://shop.test/p?a=1&pinwren=old&pwt=old#top");
    const u = new URL(url);
    expect(u.searchParams.get("a")).toBe("1");
    expect(u.searchParams.get("pinwren")).toBe(ID);
    expect(u.searchParams.getAll("pwt")).toHaveLength(1);
    expect(verifyPageLinkToken(u.searchParams.get("pwt"))?.feedbackId).toBe(ID);
    expect(u.hash).toBe("#top");
  });
});

describe("refused origins", () => {
  it("records newest first, bumps the count, throttles and keeps ten", async () => {
    const { nextRejectedOrigins, REJECTED_ORIGIN_INTERVAL_MS } = await import("./services/rejected-origins");
    const t0 = Date.UTC(2026, 0, 1);
    const first = nextRejectedOrigins([], "https://a.test", t0);
    expect(first?.isNew).toBe(true);
    expect(first?.list).toEqual([{ origin: "https://a.test", at: new Date(t0).toISOString(), count: 1 }]);
    // Within the minute: nothing to write.
    expect(nextRejectedOrigins(first?.list, "https://a.test", t0 + 1000)).toBeNull();
    const again = nextRejectedOrigins(first?.list, "https://a.test", t0 + REJECTED_ORIGIN_INTERVAL_MS);
    expect(again?.isNew).toBe(false);
    expect(again?.list[0]?.count).toBe(2);

    let list = again?.list ?? [];
    for (let i = 0; i < 12; i++) list = nextRejectedOrigins(list, `https://o${i}.test`, t0 + i)?.list ?? list;
    expect(list).toHaveLength(10);
    expect(list[0]?.origin).toBe("https://o11.test");
    // Junk in the stored JSON is dropped, not trusted.
    expect(nextRejectedOrigins([{ origin: 1 }, null, "x"], "https://b.test", t0)?.list).toHaveLength(1);
  });

  it("stores only scheme, host and port", async () => {
    const { cleanOrigin } = await import("./services/rejected-origins");
    expect(cleanOrigin("HTTPS://Shop.Example.com:8443")).toBe("https://shop.example.com:8443");
    expect(cleanOrigin("null")).toBeNull();
    expect(cleanOrigin("chrome-extension://abc")).toBeNull();
  });
});

describe("reporter tokens header", () => {
  it("keeps well-formed tokens, deduplicated, at most 50", async () => {
    const { reporterTokensOf } = await import("./routes/widget");
    const t = "A".repeat(43);
    expect(reporterTokensOf(undefined)).toEqual([]);
    expect(reporterTokensOf(` ${t}, ${t},bad token,short`)).toEqual([t]);
    const many = Array.from({ length: 60 }, (_, i) => `${"b".repeat(40)}${String(i).padStart(3, "0")}`);
    expect(reporterTokensOf(many.join(","))).toHaveLength(50);
  });
});

describe("page re-grouping", () => {
  it("merges rows into the one holding the normalised URL and renames the rest", async () => {
    const { planPageMerge } = await import("./services/page-merge");
    const plan = planPageMerge(
      [
        { id: "a", url: "https://s.test/pricing?utm_source=x" },
        { id: "b", url: "https://s.test/pricing/" },
        { id: "c", url: "https://s.test/docs/" },
        { id: "d", url: "https://s.test/docs?sid=9" },
        { id: "e", url: "https://s.test/keep?q=1" },
      ],
      new Map([["https://s.test/pricing", "p"]]),
      ["sid"],
    );
    expect(plan.moves).toEqual([
      { from: "a", to: "p", url: "https://s.test/pricing" },
      { from: "b", to: "p", url: "https://s.test/pricing" },
      { from: "d", to: "c", url: "https://s.test/docs" },
    ]);
    expect(plan.renames).toEqual([{ id: "c", url: "https://s.test/docs" }]);
  });
});

describe("page-link and re-pin routes", () => {
  const call = async (method: string, path: string, body: unknown) => {
    const { app } = await import("./index");
    const res = await app.request(path, {
      method,
      headers: { "content-type": "application/json", origin: "http://localhost:3100" },
      body: JSON.stringify(body),
    });
    return { status: res.status, code: ((await res.json()) as { code?: string }).code };
  };

  it("lets viewers past the read-only guard for page links, but not for re-pin links", async () => {
    role.value = "viewer";
    const { viewerMayCall } = await import("./permissions");
    expect(viewerMayCall("POST", `/api/feedback/${ID}/page-link`)).toBe(true);
    expect(await call("POST", `/api/feedback/${ID}/page-link`, { repin: true })).toEqual({
      status: 403,
      code: "FORBIDDEN_ROLE",
    });
  });

  it("keeps PATCH /api/feedback/:id/anchor away from viewers and validates the anchor", async () => {
    role.value = "viewer";
    expect(await call("PATCH", `/api/feedback/${ID}/anchor`, { anchor: {} })).toEqual({
      status: 403,
      code: "READ_ONLY_ROLE",
    });
    role.value = "member";
    expect((await call("PATCH", `/api/feedback/${ID}/anchor`, { anchor: { v: 2 } })).status).toBe(400);
  });
});
