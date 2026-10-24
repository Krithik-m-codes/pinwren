import { beforeAll, describe, expect, it, vi } from "vitest";
import type * as Context from "./context";

// Wave 5 — triage (docs/contracts/wave-5.md §3.4): list cursors and search, mentions, export rows,
// labels, and the Admin-only trash routes. No database: route checks that refuse before any query.

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:1/none";
  process.env.PINWREN_URL ??= "http://localhost:3100";
  process.env.PINWREN_SECRET ??= "x".repeat(48);
});

// The signed-in member's role, per test.
const session = vi.hoisted(() => ({ role: "member" }));

vi.mock("./context", async (importOriginal) => {
  const actual = await importOriginal<typeof Context>();
  const { createMiddleware } = await import("hono/factory");
  return {
    ...actual,
    requireSession: createMiddleware(async (c, next) => {
      c.set("userId", "user-1");
      c.set("orgId", "org-1");
      c.set("role", session.role);
      await next();
    }),
  };
});

const ID = "0192f0c4-4f6e-7c1a-8d55-9a3e2b1c4d5e";

describe("list cursor", () => {
  it("round-trips the sort key", async () => {
    const { decodeCursor, encodeCursor } = await import("./services/feedback");
    const key = { v: "high", t: "2026-10-22 10:00:00.123456+00", id: ID };
    expect(decodeCursor(encodeCursor(key))).toEqual(key);
    expect(decodeCursor(encodeCursor({ t: key.t, id: ID }))).toEqual({ t: key.t, id: ID });
  });

  it("still accepts the pre-wave-5 ISO cursor", async () => {
    const { decodeCursor } = await import("./services/feedback");
    const out = decodeCursor("2026-10-22T10:00:00.000Z");
    expect("legacy" in out && out.legacy.toISOString()).toBe("2026-10-22T10:00:00.000Z");
  });

  it("refuses anything else with 400 INVALID_CURSOR", async () => {
    const { decodeCursor, encodeCursor } = await import("./services/feedback");
    const bad = (c: string) => {
      try {
        decodeCursor(c);
        return null;
      } catch (e) {
        return (e as { status?: number; code?: string }).code;
      }
    };
    expect(bad("nope")).toBe("INVALID_CURSOR");
    expect(bad(Buffer.from("[1,2]").toString("base64url"))).toBe("INVALID_CURSOR");
    // The id goes into a `::uuid` cast: anything but a uuid is refused up front.
    expect(bad(encodeCursor({ t: "2026-01-01", id: "1; drop table x" }))).toBe("INVALID_CURSOR");
  });
});

describe("search", () => {
  it("turns words into a prefix tsquery with nothing but letters and digits", async () => {
    const { prefixQuery } = await import("./services/feedback");
    expect(prefixQuery("Check out")).toBe("check:* & out:*");
    expect(prefixQuery("can't log-in!")).toBe("can:* & t:* & log:* & in:*");
    expect(prefixQuery("Größe 漢字")).toBe("größe:* & 漢字:*");
    expect(prefixQuery("&|!():*")).toBeNull();
  });

  it("recognises item numbers", async () => {
    const { numberOf } = await import("./services/feedback");
    expect(numberOf("#12")).toBe(12);
    expect(numberOf(" 7 ")).toBe(7);
    expect(numberOf("#12 checkout")).toBeNull();
    expect(numberOf("v2")).toBeNull();
  });

  it("escapes LIKE pattern characters", async () => {
    const { likePattern } = await import("./services/feedback");
    expect(likePattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
    expect(likePattern("example.com/a")).toBe("%example.com/a%");
  });
});

describe("mentions", () => {
  it("drops duplicates and the author", async () => {
    const { mentionIds } = await import("./services/feedback");
    expect(mentionIds(["a", "b", "a", "me"], "me")).toEqual(["a", "b"]);
    expect(mentionIds(undefined, "me")).toEqual([]);
  });
});

describe("export", () => {
  const row = {
    id: ID,
    number: 4,
    kind: "bug" as const,
    status: "open" as const,
    priority: "high" as const,
    title: '=HYPERLINK("x")',
    body: "Line one\nLine, two",
    assigneeIds: ["u1", "gone"],
    reporterGuest: { name: "Dana", email: "dana@example.com" },
    createdAt: new Date("2026-10-01T10:00:00Z"),
    updatedAt: new Date("2026-10-02T10:00:00Z"),
    deletedAt: null,
    dueAt: null,
    projectId: ID,
    projectName: "Site",
    pageUrl: "https://example.com/checkout",
    roundId: null,
    hasReplay: false,
    hasScreenshot: true,
    screenshotAssetId: null,
    attachmentCount: 0,
    commentCount: 2,
    labels: [{ id: ID, name: "checkout", color: "#e5484d" }],
  };

  it("maps an item with names, labels and the workspace link", async () => {
    const { exportItem } = await import("./export/feedback");
    const item = exportItem("org-1", row, new Map([["u1", "Sam"]]));
    expect(item.assignees).toEqual(["Sam", "former member"]);
    expect(item.labels).toEqual(["checkout"]);
    expect(item.link).toBe(`http://localhost:3100/inbox?status=all&org=org-1&item=${ID}`);
  });

  it("writes formula-safe CSV records in column order", async () => {
    const { EXPORT_COLUMNS, csvLine, exportItem } = await import("./export/feedback");
    const line = csvLine(exportItem("org-1", row, new Map()));
    expect(line.endsWith("\r\n")).toBe(true);
    expect(line.startsWith("4,Site,bug,open,high,")).toBe(true);
    expect(line).toContain(`"'=HYPERLINK(""x"")"`);
    expect(line).toContain('"Line one\nLine, two"');
    expect(EXPORT_COLUMNS).toHaveLength(16);
  });

  it("parses the query: filters, format and selected ids", async () => {
    const { feedbackExportQuery } = await import("./export/feedback");
    const q = feedbackExportQuery.parse({ format: "json", status: "all", ids: `${ID},${ID}` });
    expect(q.format).toBe("json");
    expect(q.ids).toEqual([ID, ID]);
    expect(feedbackExportQuery.parse({}).format).toBe("csv");
    expect(feedbackExportQuery.safeParse({ ids: "nope" }).success).toBe(false);
    expect(feedbackExportQuery.safeParse({ format: "xlsx" }).success).toBe(false);
  });
});

describe("labels", () => {
  it("normalises colours", async () => {
    const { normalizeColor } = await import("./routes/labels");
    expect(normalizeColor("#ABC")).toBe("#aabbcc");
    expect(normalizeColor("#E5484D")).toBe("#e5484d");
  });
});

describe("role checks (BugPin roles, contract §3.7)", () => {
  const call = async (method: string, path: string) => {
    const { app } = await import("./index");
    const res = await app.request(path, {
      method,
      headers: { "content-type": "application/json" },
      ...(method === "GET" ? {} : { body: "{}" }),
    });
    const body = (await res.json()) as { code?: string };
    return `${res.status} ${body.code ?? ""}`;
  };

  it("keeps the trash, deleting and restoring to Admins", async () => {
    session.role = "member"; // Editor
    expect(await call("DELETE", `/api/feedback/${ID}`)).toBe("403 FORBIDDEN_ROLE");
    expect(await call("POST", `/api/feedback/${ID}/restore`)).toBe("403 FORBIDDEN_ROLE");
    expect(await call("DELETE", `/api/feedback/${ID}/forever`)).toBe("403 FORBIDDEN_ROLE");
    expect(await call("GET", "/api/feedback?trash=1")).toBe("403 FORBIDDEN_ROLE");
    expect(await call("GET", "/api/feedback/export?trash=true")).toBe("403 FORBIDDEN_ROLE");
    expect(await call("DELETE", `/api/rounds/${ID}`)).toBe("403 FORBIDDEN_ROLE");
  });

  it("refuses viewers' label changes before anything else", async () => {
    session.role = "viewer";
    expect(await call("POST", `/api/projects/${ID}/labels`)).toBe("403 READ_ONLY_ROLE");
    expect(await call("PATCH", `/api/labels/${ID}`)).toBe("403 READ_ONLY_ROLE");
    expect(await call("DELETE", `/api/labels/${ID}`)).toBe("403 READ_ONLY_ROLE");
  });

  it("validates the export query", async () => {
    session.role = "admin";
    expect((await call("GET", "/api/feedback/export?format=xlsx")).startsWith("400")).toBe(true);
  });
});
