import type { AuditEntry } from "@pinwren/core";
import type * as AuditModule from "./services/audit";
import { beforeAll, describe, expect, it } from "vitest";

// The audit export's CSV is opened in spreadsheets by people who didn't write its cells: an actor name or a
// target id can be attacker-chosen (a member's display name, a project name), so formula characters are
// neutralised and quoting is exact (ADR 0044).

// Excel needs a byte-order mark to open UTF-8 CSV.
const BOM = String.fromCharCode(0xfeff);
let mod: typeof AuditModule;

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:1/none";
  process.env.PINWREN_URL ??= "http://localhost:3100";
  process.env.PINWREN_SECRET ??= "x".repeat(48);
  mod = await import("./services/audit");
});

const entry = (over: Partial<AuditEntry> = {}): AuditEntry => ({
  id: "6f1c1f0e-0000-4000-8000-000000000001",
  actorId: "u1",
  actorLabel: "Ada <ada@example.com>",
  actorIp: "203.0.113.7",
  action: "member.removed",
  targetType: "member",
  targetId: "u2",
  data: { role: "editor" },
  createdAt: "2026-11-27T10:00:00.000Z",
  ...over,
});

describe("audit CSV export", () => {
  it("starts with a BOM and the header, ends lines with CRLF", () => {
    const csv = mod.auditCsv([entry()]);
    expect(csv.startsWith(BOM + "time,actor,actor_id,ip,action,target_type,target_id,data\r\n")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(3);
  });

  it("neutralises formula injection in every cell", () => {
    for (const evil of ['=HYPERLINK("http://x")', "+1+1", "-2+3", "@SUM(A1)", "\t=1", "  =1"]) {
      const csv = mod.auditCsv([entry({ actorLabel: evil, targetId: evil })]);
      const row = csv.split("\r\n")[1] ?? "";
      // A leading apostrophe makes the spreadsheet read the cell as text.
      expect(row, evil).toContain(`'${evil.replaceAll('"', '""')}`);
      expect(row.split(",")[1]?.replace(/^"/, ""), evil).toMatch(/^'/);
    }
  });

  it("quotes commas, quotes and newlines, and serialises data as JSON", () => {
    const csv = mod.auditCsv([entry({ actorLabel: 'Lee "L", Jr\nline', data: { a: "x,y" } })]);
    expect(csv).toContain('"Lee ""L"", Jr\nline"');
    expect(csv).toContain('"{""a"":""x,y""}"');
  });

  it("writes nulls as empty cells", () => {
    const row = mod
      .auditCsv([entry({ actorId: null, actorIp: null, targetType: null, targetId: null })])
      .split("\r\n")[1];
    expect(row).toBe(
      '2026-11-27T10:00:00.000Z,Ada <ada@example.com>,,,member.removed,,,"{""role"":""editor""}"',
    );
  });
});

describe("audit JSON lines export", () => {
  it("is one JSON object per line and empty for no entries", () => {
    const text = mod.auditJsonl([entry(), entry({ action: "member.invited" })]);
    const lines = text.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1] ?? "")).toMatchObject({ action: "member.invited" });
    expect(mod.auditJsonl([])).toBe("");
  });
});
