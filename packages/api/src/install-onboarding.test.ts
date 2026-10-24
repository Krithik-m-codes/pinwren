import { inflateRawSync } from "node:zlib";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type * as Context from "./context";

// Wave-5 install-onboarding (docs/contracts/wave-5.md §3.5): project presets, refused origins, the setup
// checklist, review links, the project export archive and reporter erasure — plus who may call them.

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:1/none";
  process.env.PINWREN_URL ??= "http://localhost:3100";
  process.env.PINWREN_SECRET ??= "x".repeat(48);
});

const session = vi.hoisted(() => ({ role: "viewer" }));

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

describe("project presets", () => {
  it("keeps a public site's reports private and opens a review site", async () => {
    const { presetValues, projectCreateWithPreset } = await import("./services/project-setup");
    expect(presetValues("public-site")).toEqual({
      publicRead: false,
      widgetConfig: { visitorsCanResolve: false },
    });
    expect(presetValues(undefined)).toEqual(presetValues("public-site"));
    expect(presetValues("review")).toEqual({ publicRead: true, widgetConfig: { visitorsCanResolve: true } });
    expect(projectCreateWithPreset.parse({ name: "Site", preset: "review" })).toEqual({
      name: "Site",
      allowedOrigins: [],
      preset: "review",
    });
    expect(projectCreateWithPreset.safeParse({ name: "Site", preset: "public" }).success).toBe(false);
  }, 30_000);
});

describe("refused origins", () => {
  it("drops the ones the new allowlist lets through", async () => {
    const { pruneRejected } = await import("./services/project-setup");
    const rejected = [
      { origin: "https://www.example.com", at: "2026-10-22T10:00:00Z", count: 3 },
      { origin: "https://shop.example.com", at: "2026-10-22T09:00:00Z", count: 1 },
      { origin: "http://localhost:3000", at: "2026-10-22T08:00:00Z", count: 2 },
    ];
    expect(pruneRejected(rejected, ["www.example.com"]).map((r) => r.origin)).toEqual([
      "https://shop.example.com",
      "http://localhost:3000",
    ]);
    expect(pruneRejected(rejected, ["*.example.com", "localhost:3000"])).toEqual([]);
    expect(pruneRejected(rejected, [])).toEqual(rejected);
  });
});

describe("setup checklist", () => {
  it("counts the steps done", async () => {
    const { checklistOf, SETUP_STEPS } = await import("./services/project-setup");
    const none = Object.fromEntries(SETUP_STEPS.map((s) => [s, false])) as Record<
      (typeof SETUP_STEPS)[number],
      boolean
    >;
    expect(checklistOf(none, null)).toEqual({ steps: none, done: 0, total: 6, projectId: null });
    const some = { ...none, admin: true, email: true, widget: true };
    expect(checklistOf(some, "p1")).toMatchObject({ done: 3, total: 6, projectId: "p1" });
  });
});

describe("review links", () => {
  it("adds the token to the page URL, keeping its query", async () => {
    const { reviewUrl } = await import("./routes/review-links");
    expect(reviewUrl("https://staging.example.com/pricing?plan=pro#faq", "pwr_abc")).toBe(
      "https://staging.example.com/pricing?plan=pro&pinwren_review=pwr_abc#faq",
    );
  });

  it("works until revoked or expired", async () => {
    const { reviewLinkActive } = await import("./routes/review-links");
    const now = new Date("2026-10-22T12:00:00Z");
    expect(reviewLinkActive({ revokedAt: null, expiresAt: null }, now)).toBe(true);
    expect(reviewLinkActive({ revokedAt: null, expiresAt: new Date("2026-10-23T00:00:00Z") }, now)).toBe(
      true,
    );
    expect(reviewLinkActive({ revokedAt: null, expiresAt: new Date("2026-10-21T00:00:00Z") }, now)).toBe(
      false,
    );
    expect(reviewLinkActive({ revokedAt: now, expiresAt: null }, now)).toBe(false);
  });
});

/** Read a stored-or-deflated ZIP back (local headers only), enough to check what buildZip wrote. */
function readZip(zip: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const method = view.getUint16(at + 8, true);
    const size = view.getUint32(at + 18, true);
    const nameLen = view.getUint16(at + 26, true);
    const extra = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(zip.subarray(at + 30, at + 30 + nameLen));
    const start = at + 30 + nameLen + extra;
    const body = zip.subarray(start, start + size);
    out.set(name, method === 8 ? new Uint8Array(inflateRawSync(body)) : body);
    at = start + size;
  }
  return out;
}

describe("export archive", () => {
  it("computes the standard CRC-32", async () => {
    const { crc32 } = await import("./services/zip");
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("writes entries that read back, with a central directory", async () => {
    const { buildZip } = await import("./services/zip");
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const zip = buildZip([
      { name: "feedback.json", data: new TextEncoder().encode('{"a":1}'), deflate: true },
      { name: "assets/1/x.png", data: png },
    ]);
    const files = readZip(zip);
    expect(new TextDecoder().decode(files.get("feedback.json"))).toBe('{"a":1}');
    expect(files.get("assets/1/x.png")).toEqual(png);
    // End of central directory: two entries.
    const end = zip.length - 22;
    const view = new DataView(zip.buffer, zip.byteOffset);
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
  });

  it("never writes a path that climbs out of the folder", async () => {
    const { safeEntryName } = await import("./services/zip");
    expect(safeEntryName("../../etc/passwd")).toBe("etc/passwd");
    expect(safeEntryName("/assets//1\\a.png")).toBe("assets/1/a.png");
    expect(() => safeEntryName("../..")).toThrow();
  });

  it("hides the storage key and an expired download", async () => {
    const { exportView } = await import("./services/project-export");
    const ready = {
      status: "ready" as const,
      requestedAt: "2026-10-20T10:00:00Z",
      requestedBy: "u1",
      finishedAt: "2026-10-20T10:01:00Z",
      expiresAt: "2026-10-27T10:01:00Z",
      storageKey: "p1/abc.zip",
      bytes: 1024,
      items: 3,
      assets: 2,
      skippedAssets: 0,
      error: null,
    };
    const view = exportView("p1", ready, Date.parse("2026-10-22T00:00:00Z"));
    expect(view).toMatchObject({ status: "ready", downloadUrl: "/api/projects/p1/export/download" });
    expect(view).not.toHaveProperty("storageKey");
    expect(view).not.toHaveProperty("requestedBy");
    expect(exportView("p1", ready, Date.parse("2026-10-28T00:00:00Z"))).toBeNull();
    expect(exportView("p1", { ...ready, status: "running" })?.downloadUrl).toBeNull();
    expect(exportView("p1", null)).toBeNull();
  });
});

describe("reporter erasure", () => {
  it("validates the address and keeps the newest records", async () => {
    const { appendErasure, normalizeEmail, privacyErase } = await import("./services/privacy-erase");
    expect(normalizeEmail("  Ana@Example.COM ")).toBe("ana@example.com");
    expect(privacyErase.safeParse({ email: "nope" }).success).toBe(false);
    expect(privacyErase.parse({ email: "a@b.co", dryRun: true })).toEqual({ email: "a@b.co", dryRun: true });
    const rec = (n: number) => ({
      at: `t${n}`,
      by: "u",
      emailSha256: "h",
      feedback: n,
      comments: 0,
      emails: 0,
    });
    let log = [rec(0)];
    for (let i = 1; i <= 250; i++) log = appendErasure(log, rec(i));
    expect(log).toHaveLength(200);
    expect(log[0]?.feedback).toBe(250);
  });
});

describe("who may call the install-onboarding routes", () => {
  const ID = "0192f0c4-4f6e-7c1a-8d55-9a3e2b1c4d5e";
  const call = async (method: string, path: string) => {
    const { app } = await import("./index");
    const res = await app.request(path, {
      method,
      headers: { "content-type": "application/json" },
      ...(method === "GET" ? {} : { body: "{}" }),
    });
    return `${res.status} ${((await res.json()) as { code?: string }).code ?? ""}`;
  };

  it("refuses a viewer every write", async () => {
    session.role = "viewer";
    for (const [method, path] of [
      ["POST", "/api/projects"],
      ["POST", `/api/projects/${ID}/export`],
      ["POST", "/api/privacy/erase"],
      ["POST", `/api/projects/${ID}/review-links`],
      ["DELETE", `/api/review-links/${ID}`],
    ] as const) {
      expect(`${method} ${path} → ${await call(method, path)}`).toBe(
        `${method} ${path} → 403 READ_ONLY_ROLE`,
      );
    }
  }, 60_000);

  it("keeps project creation, exports, erasure and review links to Admins", async () => {
    session.role = "member";
    for (const [method, path] of [
      ["POST", "/api/projects"],
      ["GET", `/api/projects/${ID}/export`],
      ["POST", `/api/projects/${ID}/export`],
      ["GET", `/api/projects/${ID}/export/download`],
      ["POST", "/api/privacy/erase"],
      ["GET", "/api/privacy/erasures"],
      ["GET", `/api/projects/${ID}/review-links`],
      ["POST", `/api/projects/${ID}/review-links`],
      ["DELETE", `/api/review-links/${ID}`],
    ] as const) {
      expect(`${method} ${path} → ${await call(method, path)}`).toBe(
        `${method} ${path} → 403 FORBIDDEN_ROLE`,
      );
    }
  }, 60_000);

  it("validates an Admin's request before touching the database", async () => {
    session.role = "admin";
    expect(await call("POST", "/api/privacy/erase")).toMatch(/^400 /);
  }, 60_000);
});
