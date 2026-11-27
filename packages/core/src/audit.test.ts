import { describe, expect, it } from "vitest";
import { AUDIT_REDACTED, auditExportQuery, auditListQuery, redactAuditData } from "./audit";

describe("redactAuditData", () => {
  it("replaces secret-looking keys at any depth and keeps the rest", () => {
    const out = redactAuditData({
      name: "CI",
      token: "pwt_abc",
      nested: { Password: "x", webhookSecret: "y", apiKey: "z", Cookie: "c", ok: 1 },
      list: [{ authorization: "Bearer a", label: "l" }],
    });
    expect(out).toEqual({
      name: "CI",
      token: AUDIT_REDACTED,
      nested: {
        Password: AUDIT_REDACTED,
        webhookSecret: AUDIT_REDACTED,
        apiKey: AUDIT_REDACTED,
        Cookie: AUDIT_REDACTED,
        ok: 1,
      },
      list: [{ authorization: AUDIT_REDACTED, label: "l" }],
    });
  });

  it("cuts long strings, caps depth and survives cycles", () => {
    expect(redactAuditData("a".repeat(600))).toHaveLength(501);
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => redactAuditData(loop)).not.toThrow();
    expect(JSON.stringify(redactAuditData(loop))).toContain("[truncated]");
  });

  it("serialises dates and drops values that are not JSON", () => {
    expect(redactAuditData({ f: () => 1, d: new Date(0) })).toEqual({
      f: undefined,
      d: "1970-01-01T00:00:00.000Z",
    });
  });
});

describe("audit queries", () => {
  it("accepts an area prefix and rejects free-text actions", () => {
    expect(auditListQuery.safeParse({ action: "member." }).success).toBe(true);
    expect(auditListQuery.safeParse({ action: "member" }).success).toBe(true);
    expect(auditListQuery.safeParse({ action: "x; drop table" }).success).toBe(false);
  });
  it("bounds the page size and defaults the export format", () => {
    expect(auditListQuery.parse({}).limit).toBe(50);
    expect(auditListQuery.safeParse({ limit: "9999" }).success).toBe(false);
    expect(auditExportQuery.parse({}).format).toBe("csv");
    expect(auditExportQuery.safeParse({ format: "xml" }).success).toBe(false);
  });
});
