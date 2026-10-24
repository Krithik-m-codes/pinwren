import { beforeAll, describe, expect, it, vi } from "vitest";
import type * as Context from "./context";

// Accounts (wave-5 contract §3.1, BugPin model): who becomes the instance admin, the Users page rules,
// account deletion, and the role guards on the new routes. Route checks stop at the guards, so no
// database is needed.

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
    // A signed-in member with `session.role`, without Better Auth or a database.
    requireSession: createMiddleware(async (c, next) => {
      c.set("userId", "user-1");
      c.set("orgId", "org-1");
      c.set("role", session.role);
      await next();
    }),
  };
});

const ID = "0192f0c4-4f6e-7c1a-8d55-9a3e2b1c4d5e";

async function call(method: string, path: string, body: unknown = {}) {
  const { app } = await import("./index");
  const res = await app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { code?: string };
  return `${res.status} ${json.code ?? ""}`.trim();
}

describe("first account = instance admin", () => {
  it("picks the oldest account only while nobody administers the instance", async () => {
    const { pickFirstAdmin } = await import("./services/setup");
    expect(pickFirstAdmin({ listed: false, claimed: [], oldestUserId: "u1" })).toBe("u1");
    expect(pickFirstAdmin({ listed: false, claimed: [], oldestUserId: null })).toBeNull();
    // A second sign-up (or the loser of a race) finds the list taken.
    expect(pickFirstAdmin({ listed: false, claimed: ["u1"], oldestUserId: "u1" })).toBeNull();
    // PINWREN_ADMIN_EMAILS names the admins: nobody is promoted.
    expect(pickFirstAdmin({ listed: true, claimed: [], oldestUserId: "u1" })).toBeNull();
  });

  it("never removes the last administrator or an env-listed one", async () => {
    const { removalVerdict } = await import("./services/setup");
    expect(removalVerdict({ userId: "a", claimed: ["a"], listedUserIds: [] })).toBe("last_admin");
    expect(removalVerdict({ userId: "a", claimed: ["a", "b"], listedUserIds: [] })).toBe("ok");
    expect(removalVerdict({ userId: "a", claimed: ["a"], listedUserIds: ["e"] })).toBe("ok");
    expect(removalVerdict({ userId: "e", claimed: ["a"], listedUserIds: ["e"] })).toBe("env_locked");
    expect(removalVerdict({ userId: "z", claimed: ["a"], listedUserIds: [] })).toBe("not_admin");
  });

  it("the old setup-token claim answers 410", async () => {
    expect(await call("POST", "/api/setup/claim", { token: "pws_x" })).toBe("410 SETUP_TOKEN_REMOVED");
  });
});

describe("Users page rules", () => {
  it("protects the owner, yourself and the last Admin", async () => {
    const { memberChangeVerdict } = await import("./services/workspace");
    const base = { actorId: "me", adminCount: 2 };
    const code = (v: ReturnType<typeof memberChangeVerdict>) => (v.ok ? "ok" : v.code);
    expect(
      code(memberChangeVerdict({ ...base, target: { userId: "me", role: "admin" }, nextRole: "viewer" })),
    ).toBe("OWN_ROLE");
    expect(
      code(memberChangeVerdict({ ...base, target: { userId: "o", role: "owner" }, nextRole: "editor" })),
    ).toBe("OWNER_LOCKED");
    expect(
      code(memberChangeVerdict({ ...base, target: { userId: "o", role: "owner" }, nextRole: null })),
    ).toBe("OWNER_LOCKED");
    expect(
      code(
        memberChangeVerdict({
          ...base,
          adminCount: 1,
          target: { userId: "a", role: "admin" },
          nextRole: "viewer",
        }),
      ),
    ).toBe("LAST_ADMIN");
    expect(
      code(memberChangeVerdict({ ...base, target: { userId: "a", role: "admin" }, nextRole: "viewer" })),
    ).toBe("ok");
    expect(
      code(memberChangeVerdict({ ...base, target: { userId: "m", role: "member" }, nextRole: null })),
    ).toBe("ok");
    // Promoting is never blocked by the Admin count.
    expect(
      code(
        memberChangeVerdict({
          ...base,
          adminCount: 1,
          target: { userId: "m", role: "member" },
          nextRole: "admin",
        }),
      ),
    ).toBe("ok");
  });

  it("account deletion: blocked by a shared workspace you alone own, takes a solo one with it", async () => {
    const { accountDeletionPlan } = await import("./services/workspace");
    expect(
      accountDeletionPlan([
        { orgId: "solo", name: "Solo", owners: 1, members: 1 },
        { orgId: "team", name: "Team", owners: 1, members: 3 },
        { orgId: "co", name: "Co-owned", owners: 2, members: 4 },
      ]),
    ).toEqual({ blockedBy: ["Team"], deleteWith: ["solo"] });
    expect(accountDeletionPlan([])).toEqual({ blockedBy: [], deleteWith: [] });
  });
});

describe("role guards on the account routes", () => {
  const ADMIN_ONLY: [string, string, unknown][] = [
    ["POST", "/api/members", { name: "A", email: "a@example.com", password: "long-enough", role: "editor" }],
    ["PATCH", `/api/members/${ID}`, { role: "viewer" }],
    ["DELETE", `/api/members/${ID}`, {}],
    ["PATCH", "/api/workspace", { name: "Renamed" }],
  ];

  it("Editors get FORBIDDEN_ROLE on Admin routes", async () => {
    session.role = "member";
    for (const [method, path, body] of ADMIN_ONLY) {
      expect(`${method} ${path} → ${await call(method, path, body)}`).toBe(
        `${method} ${path} → 403 FORBIDDEN_ROLE`,
      );
    }
  });

  it("Viewers are refused every write on them", async () => {
    session.role = "viewer";
    const writes: [string, string, unknown][] = [
      ...ADMIN_ONLY,
      ["POST", `/api/members/${ID}/reset-link`, {}],
      ["POST", "/api/workspace/transfer", { userId: ID }],
      ["DELETE", "/api/workspace", { confirm: "x" }],
    ];
    for (const [method, path, body] of writes) {
      expect(`${method} ${path} → ${await call(method, path, body)}`).toBe(
        `${method} ${path} → 403 READ_ONLY_ROLE`,
      );
    }
  });

  it("validates Add User before touching anything", async () => {
    session.role = "admin";
    expect(
      await call("POST", "/api/members", {
        name: "A",
        email: "a@example.com",
        password: "short",
        role: "editor",
      }),
    ).toMatch(/^400/);
    expect(
      await call("POST", "/api/members", {
        name: "A",
        email: "a@example.com",
        password: "long-enough",
        role: "owner",
      }),
    ).toMatch(/^400/);
  });
});
