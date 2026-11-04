import { describe, expect, it } from "vitest";
import {
  deviceClass,
  fillBuckets,
  maskPii,
  maskUrl,
  shareLinkCreate,
  signoffCreate,
  signoffState,
  summarizeDiagnostics,
  timeBucketIndex,
} from "./index";

const id = "6f1c1a52-2f3a-4f7e-9d0c-3a1f7b1e2c11";

describe("shareLinkCreate", () => {
  it("takes exactly one target and applies the defaults", () => {
    const ok = shareLinkCreate.parse({ feedbackId: id });
    expect(ok).toMatchObject({ expiresInDays: 7, allowComments: false, label: "" });
    expect(shareLinkCreate.safeParse({}).success).toBe(false);
    expect(shareLinkCreate.safeParse({ feedbackId: id, roundId: id }).success).toBe(false);
    expect(shareLinkCreate.safeParse({ roundId: id, expiresInDays: 365 }).success).toBe(false);
    expect(shareLinkCreate.safeParse({ roundId: id, password: "abc" }).success).toBe(false);
    expect(shareLinkCreate.safeParse({ roundId: id, extra: 1 }).success).toBe(false);
  });
});

describe("signoffCreate", () => {
  const base = { name: "Dana", email: "dana@example.com" };
  it("lets an approval go without a note but wants one for changes", () => {
    expect(signoffCreate.safeParse({ ...base, decision: "approved" }).success).toBe(true);
    expect(signoffCreate.safeParse({ ...base, decision: "changes_requested" }).success).toBe(false);
    expect(
      signoffCreate.safeParse({ ...base, decision: "changes_requested", note: "Fix the logo" }).success,
    ).toBe(true);
    expect(signoffCreate.safeParse({ ...base, email: "nope", decision: "approved" }).success).toBe(false);
  });
  it("the newest answer decides the state", () => {
    expect(signoffState(null)).toBe("none");
    expect(signoffState({ decision: "approved" })).toBe("approved");
  });
});

describe("PII masking", () => {
  it("hides emails, tokens, long secrets, phones, cards and IPs", () => {
    const out = maskPii(
      "user a.b+c@example.com token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc Bearer abcdefgh12345 key " +
        "A".repeat(40) +
        " call +1 (555) 123-4567 card 4111 1111 1111 1111 from 192.168.1.20",
      2000,
    );
    expect(out).not.toMatch(/example\.com|eyJ|abcdefgh12345|AAAAAAAA|555|4111|192\.168/);
    expect(out).toContain("[email]");
  });
  it("caps the length", () => {
    expect(maskPii("x ".repeat(500), 50).length).toBeLessThanOrEqual(50);
  });
  it("drops query strings, credentials and opaque path segments from URLs", () => {
    expect(maskUrl("https://user:pw@api.example.com/v1/users/123456789/orders?token=secret#frag")).toBe(
      "https://api.example.com/v1/users/:id/orders?…",
    );
    expect(maskUrl("not a url?secret=1")).toBe("not a url");
  });
});

describe("summarizeDiagnostics", () => {
  it("counts everything, lists only errors, warnings and failed requests, masked", () => {
    const s = summarizeDiagnostics({
      console: [
        { level: "log", message: "hello", at: 1 },
        { level: "error", message: "failed for ceo@corp.com", at: 2 },
        { level: "warn", message: "careful", at: 3 },
      ],
      network: [
        { method: "GET", url: "https://a.test/x?token=1", status: 200, durationMs: 5, at: 1 },
        { method: "POST", url: "https://a.test/pay?card=4111", status: 500, durationMs: 12.4, at: 2 },
      ],
    });
    expect(s.console).toMatchObject({ errors: 1, warnings: 1, total: 3 });
    expect(s.console.entries).toHaveLength(2);
    expect(JSON.stringify(s)).not.toMatch(/ceo@corp|token=|card=/);
    expect(s.network).toMatchObject({ total: 2, failed: 1 });
    expect(s.network.entries[0]).toMatchObject({ status: 500, url: "https://a.test/pay?…" });
  });
  it("copes with missing or malformed captures", () => {
    expect(summarizeDiagnostics(null).console.total).toBe(0);
    expect(summarizeDiagnostics({ console: "x", network: [null, 3] }).network.total).toBe(0);
  });
});

describe("dashboard distributions", () => {
  it("buckets durations and fills empty buckets", () => {
    expect([0.5, 1, 3.9, 4, 23, 24, 71, 100, 167, 168, 900].map(timeBucketIndex)).toEqual([
      0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5,
    ]);
    expect(fillBuckets([{ index: 2, count: 4 }]).map((b) => b.count)).toEqual([0, 0, 4, 0, 0, 0]);
  });
  it("classes devices by viewport width", () => {
    expect([320, 767, 768, 1023, 1024, null].map(deviceClass)).toEqual([
      "mobile",
      "mobile",
      "tablet",
      "tablet",
      "desktop",
      "unknown",
    ]);
  });
});
