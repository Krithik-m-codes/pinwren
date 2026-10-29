import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:1/none";
  process.env.PINWREN_URL ??= "http://localhost:3100";
  process.env.PINWREN_SECRET ??= "x".repeat(48);
});

describe("guest capability parsing", () => {
  it("requires a capability before any project lookup", async () => {
    const { parseGuestAccess } = await import("./services/guest");
    expect(parseGuestAccess(undefined, undefined)).toBeNull();
    expect(parseGuestAccess("a fake token", undefined)).toBeNull();
    expect(parseGuestAccess("a".repeat(129), undefined)).toBeNull();
  });

  it("bounds the combined token count and deduplicates capabilities", async () => {
    const { parseGuestAccess } = await import("./services/guest");
    expect(
      parseGuestAccess(
        Array.from({ length: 51 }, (_, n) => `token_${String(n).padStart(16, "0")}`).join(","),
        undefined,
      ),
    ).toBeNull();
    expect(parseGuestAccess("abcdefghijklmnop,abcdefghijklmnop", undefined)?.reporterTokens).toEqual([
      "abcdefghijklmnop",
    ]);
  });

  it("does not accept ids, expired signatures or token text as permission", async () => {
    const { guestClaims } = await import("./services/guest");
    const { pageLinkToken } = await import("./services/page-link");
    const id = "11111111-1111-4111-8111-111111111111";
    const expired = pageLinkToken(id, { now: Date.now() - 20_000, ttlMs: 1000 }).token;
    expect(guestClaims({ reporterTokens: [], pageTokens: [expired, "forged.signature"] }).ids).toEqual([]);
    const valid = pageLinkToken(id).token;
    expect(guestClaims({ reporterTokens: [], pageTokens: [valid] }).ids).toEqual([id]);
    expect(guestClaims({ reporterTokens: ["abcdefghijklmnop"], pageTokens: [] }).hashes).not.toContain(
      "abcdefghijklmnop",
    );
  });
});

describe("guest routes without a team session", () => {
  it("refuses unauthenticated requests without connecting to a database", async () => {
    const { guestPortal } = await import("./routes/guest");
    const res = await guestPortal.request("/guest/pk_test/feedback");
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});
