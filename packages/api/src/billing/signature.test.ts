import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyStandardWebhook } from "./signature";

const raw = Buffer.from("whsec_" + "k".repeat(32)).toString("base64");
const secret = `whsec_${raw}`;
const key = Buffer.from(raw, "base64");
const now = new Date("2026-11-01T12:00:00Z");
const ts = String(Math.floor(now.getTime() / 1000));
const body = JSON.stringify({ type: "subscription.active", data: {} });
const sign = (id: string, t: string, b: string, k = key) =>
  `v1,${createHmac("sha256", k).update(`${id}.${t}.${b}`).digest("base64")}`;
const check = (over: Partial<Parameters<typeof verifyStandardWebhook>[0]> = {}) =>
  verifyStandardWebhook({
    secret,
    id: "msg_1",
    timestamp: ts,
    signature: sign("msg_1", ts, body),
    body,
    now,
    ...over,
  });

describe("Standard Webhooks verification", () => {
  it("accepts a correct signature", () => {
    expect(check()).toBe("ok");
  });
  it("accepts when any of several space-separated signatures matches", () => {
    expect(check({ signature: `v1,AAAA ${sign("msg_1", ts, body)}` })).toBe("ok");
  });
  it("rejects a tampered body, id or timestamp", () => {
    expect(check({ body: body + " " })).toBe("bad_signature");
    expect(check({ id: "msg_2" })).toBe("bad_signature");
    expect(check({ timestamp: String(Number(ts) + 1) })).toBe("bad_signature");
  });
  it("rejects a signature made with another key", () => {
    expect(check({ signature: sign("msg_1", ts, body, Buffer.from("other-key")) })).toBe("bad_signature");
  });
  it("rejects stale and future timestamps (replay window)", () => {
    const old = String(Number(ts) - 6 * 60);
    expect(check({ timestamp: old, signature: sign("msg_1", old, body) })).toBe("stale");
    const future = String(Number(ts) + 6 * 60);
    expect(check({ timestamp: future, signature: sign("msg_1", future, body) })).toBe("stale");
    const edge = String(Number(ts) - 4 * 60);
    expect(check({ timestamp: edge, signature: sign("msg_1", edge, body) })).toBe("ok");
  });
  it("rejects missing or malformed headers", () => {
    expect(check({ id: "" })).toBe("malformed");
    expect(check({ timestamp: "soon" })).toBe("malformed");
    expect(check({ signature: "" })).toBe("malformed");
    expect(check({ signature: "v2,abc" })).toBe("bad_signature");
  });
  it("does not accept anything when the secret is empty", () => {
    expect(check({ secret: "" })).toBe("malformed");
  });
});
