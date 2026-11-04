import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:1/none";
  process.env.PINWREN_URL ??= "http://localhost:3100";
  process.env.PINWREN_SECRET ??= "x".repeat(48);
});

const linkId = "6f1c1a52-2f3a-4f7e-9d0c-3a1f7b1e2c11";

describe("share link tokens", () => {
  it("only accepts tokens shaped like the ones handed out", async () => {
    const { plausibleShareToken } = await import("./services/share-links");
    expect(plausibleShareToken(`pws_${"a".repeat(32)}`)).toBe(true);
    expect(plausibleShareToken("pwr_" + "a".repeat(32))).toBe(false);
    expect(plausibleShareToken("pws_short")).toBe(false);
    expect(plausibleShareToken(undefined)).toBe(false);
    expect(plausibleShareToken(`pws_${"a".repeat(32)} or 1=1`)).toBe(false);
  });

  it("puts the token in the URL fragment, never the path or query", async () => {
    const { shareUrl } = await import("./services/share-links");
    const url = new URL(shareUrl("pk_abc", "pws_secret_token_value_0123456789"));
    expect(url.pathname).toBe("/share/pk_abc");
    expect(url.search).toBe("");
    expect(url.hash).toBe("#t=pws_secret_token_value_0123456789");
  });

  it("reports revoked and expired links as such", async () => {
    const { linkStatus } = await import("./services/share-links");
    const now = new Date("2026-11-04T00:00:00Z");
    const future = new Date("2026-11-05T00:00:00Z");
    const past = new Date("2026-11-03T00:00:00Z");
    expect(linkStatus({ revokedAt: null, expiresAt: future }, now)).toBe("active");
    expect(linkStatus({ revokedAt: null, expiresAt: past }, now)).toBe("expired");
    expect(linkStatus({ revokedAt: past, expiresAt: future }, now)).toBe("revoked");
  });
});

describe("password unlock proof", () => {
  it("is bound to one link and expires", async () => {
    const { unlockToken, verifyUnlockToken } = await import("./services/share-links");
    const now = Date.now();
    const token = unlockToken(linkId, now);
    expect(verifyUnlockToken(token, linkId, now + 1000)).toBe(true);
    expect(verifyUnlockToken(token, "00000000-0000-4000-8000-000000000000", now + 1000)).toBe(false);
    expect(verifyUnlockToken(token, linkId, now + 13 * 3_600_000)).toBe(false);
  });
  it("rejects forged, tampered and missing proofs", async () => {
    const { unlockToken, verifyUnlockToken } = await import("./services/share-links");
    const token = unlockToken(linkId);
    expect(verifyUnlockToken(undefined, linkId)).toBe(false);
    expect(verifyUnlockToken("a.b", linkId)).toBe(false);
    expect(verifyUnlockToken(`${token}x`, linkId)).toBe(false);
    const [part] = token.split(".");
    expect(verifyUnlockToken(`${part ?? ""}.${"A".repeat(43)}`, linkId)).toBe(false);
  });
});

describe("sign-off labels", () => {
  it("names both decisions for the email", async () => {
    const { DECISION_LABEL } = await import("./services/signoff");
    expect(DECISION_LABEL).toEqual({ approved: "Approved", changes_requested: "Changes requested" });
  });
});
