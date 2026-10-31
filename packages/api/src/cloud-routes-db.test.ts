import type * as StorageModule from "./storage";
import type * as OutboundModule from "./outbound/safe-fetch";
import type * as ApiModule from "./index";
import type * as BossModule from "./jobs/boss";
import type * as BusModule from "./realtime/bus";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { getRuntimeDb } from "../../db/src/connection";
import { closeIdentityDatabase } from "../../db/src/identity";
import { createCloudFixture } from "./test-helpers/cloud-fixture";
import { snapshotOrganization } from "./test-helpers/tenant-snapshot";
import { coverageGaps, expectedCheck, inventoryRoutes } from "./test-helpers/route-inventory";

/**
 * Route-wide acceptance coverage for the authenticated Cloud API (WP-21 Task 8). Every `tenant`,
 * `identity`, `system` and `public` entry of tenant-route-inventory.json must have exactly one case here;
 * the inventory and this registry are compared in both directions, so a new route without a case fails.
 * `capability` routes (widget, guest, unsubscribe, inbound webhooks, signed assets) live in
 * cloud-routes-public-db.test.ts, which compares the same way.
 *
 * Case kinds:
 *  - foreign: signed in to workspace A, name workspace B's resource; the answer is 404/403 and every
 *    workspace-B row (hashed, including parent-owned rows and B's member/user rows) is unchanged.
 *  - scoped: no resource id to name (lists, creates, singleton settings); the call runs as A, must not
 *    answer with anything of B's, and must leave B's rows unchanged.
 *  - authorization: instance-wide or account-wide routes; a signed-in non-administrator is refused.
 *  - public: no session by design; the answer carries nothing of any workspace.
 */
const effects = vi.hoisted(() => ({
  enqueue: vi.fn<(...args: unknown[]) => Promise<void>>(),
  publish: vi.fn<(...args: unknown[]) => Promise<void>>(),
  subscribe: vi.fn(),
  put: vi.fn<(...args: unknown[]) => Promise<void>>(),
  get: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  remove: vi.fn<(...args: unknown[]) => Promise<void>>(),
  fetch: vi.fn<(...args: unknown[]) => Promise<Response>>(),
}));
vi.mock("./jobs/boss", async (original) => ({
  ...(await original<typeof BossModule>()),
  enqueue: effects.enqueue,
}));
vi.mock("./realtime/bus", async (original) => ({
  ...(await original<typeof BusModule>()),
  publish: effects.publish,
  subscribe: effects.subscribe,
}));
vi.mock("./storage", async (original) => ({
  ...(await original<typeof StorageModule>()),
  storage: () => ({ put: effects.put, get: effects.get, remove: effects.remove }),
}));
vi.mock("./outbound/safe-fetch", async (original) => ({
  ...(await original<typeof OutboundModule>()),
  safeFetch: effects.fetch,
}));

type Ids = Record<string, string>;
type Call = {
  method: string;
  path: string;
  body?: unknown;
  /** Authenticate with the workspace-A API token instead of the A session cookie. */
  token?: boolean;
};
type Kind = "foreign" | "scoped" | "authorization" | "public";
type Spec = {
  kind: Kind;
  body?: (ids: Ids) => unknown;
  path?: (ids: Ids) => string;
  status?: number[];
  /** Runs the case itself when one request cannot show the property. */
  run?: (ctx: Context) => Promise<void>;
  /** Cases that delete or transfer the caller's own workspace run last, against a disposable workspace. */
  destructive?: boolean;
};
type Context = {
  ids: Ids;
  send: (call: Call, as?: "a" | "none" | "disposable") => Response | Promise<Response>;
  database: () => ReturnType<typeof createCloudFixture> extends Promise<infer F>
    ? F extends { db: infer D }
      ? D
      : never
    : never;
  snapshot: () => Promise<string>;
};

const resourceOf: Record<string, string> = {
  feedback: "feedbackB",
  comments: "commentB",
  integrations: "integrationB",
  labels: "labelB",
  "review-links": "reviewLinkB",
  rounds: "roundB",
  tokens: "tokenIdB",
  views: "viewB",
  webhooks: "webhookB",
  projects: "projectB",
  assets: "assetB",
  "webhook-deliveries": "deliveryB",
  members: "userB",
  "email-templates": "templateKey",
  actions: "actionKey",
  avatars: "userB",
  instance_admins: "userB",
  "instance-admins": "userB",
};

/** `/api/feedback/:id/actions/:actionId` -> workspace-B ids, from the segment before each parameter. */
function derivePath(pattern: string, ids: Ids): string {
  const segments = pattern.split("/");
  return segments
    .map((segment, index) => {
      if (!segment.startsWith(":")) return segment;
      const name = resourceOf[segments[index - 1] ?? ""];
      if (!name || !ids[name]) throw new Error(`No workspace-B resource for ${pattern}`);
      return ids[name];
    })
    .join("/");
}

const project = (ids: Ids) => ids.projectB ?? "";
const foreign = (spec: Partial<Spec> = {}): Spec => ({ kind: "foreign", ...spec });
const scoped = (spec: Partial<Spec> = {}): Spec => ({ kind: "scoped", ...spec });
const authorization = (spec: Partial<Spec> = {}): Spec => ({ kind: "authorization", ...spec });
const publicCase = (spec: Partial<Spec> = {}): Spec => ({ kind: "public", ...spec });
const dataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jHnQAAAAASUVORK5CYII=";

/** One entry per inventory key. Defaults: body `{}` for writes; ids come from workspace B. */
const cases: Record<string, Spec> = {
  // --- tenant: resource ids from workspace B -------------------------------------------------------
  "ALL /mcp": scoped({
    run: async ({ ids, send, snapshot }) => {
      const before = await snapshot();
      for (const name of ["get_feedback", "get_reproduction_context"]) {
        const response = await send({
          method: "POST",
          path: "/mcp",
          token: true,
          body: {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name, arguments: { id: ids.feedbackB } },
          },
        });
        const text = await response.text();
        expect(text, name).not.toContain(ids.marker ?? "");
        expect(text, name).not.toContain('isError":false');
      }
      expect(await snapshot()).toBe(before);
    },
  }),
  "DELETE /api/comments/:id": foreign(),
  "DELETE /api/email-templates/:key": scoped(),
  "DELETE /api/feedback/:id": foreign(),
  "DELETE /api/feedback/:id/forever": foreign(),
  "DELETE /api/feedback/:id/watch": foreign(),
  "DELETE /api/integrations/:id": foreign(),
  "DELETE /api/labels/:id": foreign(),
  "DELETE /api/members/:userId": foreign(),
  "DELETE /api/review-links/:id": foreign(),
  "DELETE /api/rounds/:id": foreign(),
  "DELETE /api/tokens/:id": foreign(),
  "DELETE /api/views/:id": foreign(),
  "DELETE /api/webhooks/:id": foreign(),
  "DELETE /api/workspace": scoped({
    destructive: true,
    run: async ({ ids, send, snapshot, database }) => {
      const before = await snapshot();
      // A wrong confirmation never deletes anything.
      expect((await send({ method: "DELETE", path: "/api/workspace", body: { confirm: "no" } })).status).toBe(
        400,
      );
      // The disposable owner deletes only their own workspace.
      const response = await send(
        { method: "DELETE", path: "/api/workspace", body: { confirm: ids.disposableOrg } },
        "disposable",
      );
      expect(response.status).toBe(204);
      expect(await database()`select id from organization where id=${ids.disposableOrg ?? ""}`).toHaveLength(
        0,
      );
      expect(await database()`select id from organization where id=${ids.orgA ?? ""}`).toHaveLength(1);
      expect(await snapshot()).toBe(before);
    },
  }),
  "GET /api/assets/:id": foreign(),
  "GET /api/branding": scoped(),
  "GET /api/email-templates": scoped(),
  "GET /api/email-templates/:key": scoped(),
  "GET /api/feedback": scoped({ path: (ids) => `/api/feedback?projectId=${project(ids)}` }),
  "GET /api/feedback/:id": foreign(),
  "GET /api/feedback/:id/reproduction": foreign(),
  "GET /api/feedback/export": scoped({ path: (ids) => `/api/feedback/export?projectId=${project(ids)}` }),
  "GET /api/integrations/:id/webhook-secret": foreign(),
  "GET /api/invitations": scoped(),
  "GET /api/me": scoped(),
  "GET /api/me/entitlements": scoped(),
  "GET /api/members": scoped(),
  "GET /api/notification-preferences": scoped(),
  "GET /api/notifications": scoped(),
  "GET /api/privacy/erasures": scoped(),
  "GET /api/projects": scoped(),
  "GET /api/projects/:id": foreign(),
  "GET /api/projects/:id/action-secret": foreign(),
  "GET /api/projects/:id/ai": foreign(),
  "GET /api/projects/:id/export": foreign(),
  "GET /api/projects/:id/export/download": foreign(),
  "GET /api/projects/:id/identity-secret": foreign(),
  "GET /api/projects/:id/integrations": foreign(),
  "GET /api/projects/:id/labels": foreign(),
  "GET /api/projects/:id/notifications": foreign(),
  "GET /api/projects/:id/review-links": foreign(),
  "GET /api/projects/:id/rounds": foreign(),
  "GET /api/rounds/:id": foreign(),
  "GET /api/rounds/:id/export": foreign(),
  "GET /api/settings/ai": scoped(),
  "GET /api/setup-checklist": scoped(),
  "GET /api/stream": foreign({ path: (ids) => `/api/stream?projectIds=${project(ids)}` }),
  "GET /api/tokens": scoped(),
  "GET /api/v1/assets/:id": foreign({ path: (ids) => `/api/v1/assets/${ids.assetB ?? ""}` }),
  "GET /api/v1/feedback": scoped({ path: (ids) => `/api/v1/feedback?projectId=${project(ids)}` }),
  "GET /api/v1/feedback/:id": foreign(),
  "GET /api/v1/feedback/:id/reproduction": foreign(),
  "GET /api/v1/projects": scoped(),
  "GET /api/v1/projects/:id/rounds": foreign(),
  "GET /api/v1/rounds/:id": foreign(),
  "GET /api/v1/token": scoped(),
  "GET /api/views": scoped(),
  "GET /api/webhooks": scoped(),
  "GET /api/webhooks/:id": foreign(),
  "GET /api/webhooks/:id/deliveries": foreign(),
  "PATCH /api/branding": scoped({ body: () => ({ productName: "Scoped A brand" }) }),
  "PATCH /api/comments/:id": foreign({ body: () => ({ body: "foreign edit" }) }),
  "PATCH /api/feedback/:id": foreign({ body: () => ({ title: "foreign edit" }) }),
  "PATCH /api/feedback/:id/anchor": foreign({
    body: () => ({
      anchor: {
        v: 1,
        css: "body",
        xpath: "/html/body",
        tag: "body",
        text: { content: "x", prefix: "", suffix: "" },
        structure: { depth: 1, siblingIndex: 0, childTagsHash: "x" },
        rect: { x: 0, y: 0, w: 1, h: 1, vw: 1, vh: 1, scrollY: 0 },
        pin: { xPct: 1, yPct: 1 },
      },
    }),
  }),
  "PATCH /api/integrations/:id": foreign({ body: () => ({ repo: "foreign/edit" }) }),
  "PATCH /api/labels/:id": foreign({ body: () => ({ name: "foreign edit" }) }),
  "PATCH /api/members/:userId": foreign({ body: () => ({ role: "viewer" }) }),
  "PATCH /api/projects/:id": foreign({ body: () => ({ name: "foreign edit" }) }),
  "PATCH /api/projects/:id/ai": foreign({ body: () => ({ enabled: true }) }),
  "PATCH /api/projects/:id/notifications": foreign({ body: () => ({ emails: ["foreign@test.invalid"] }) }),
  "PATCH /api/rounds/:id": foreign({ body: () => ({ name: "foreign edit" }) }),
  "PATCH /api/v1/feedback/:id": foreign({ body: () => ({ title: "foreign edit" }) }),
  "PATCH /api/v1/rounds/:id": foreign({ body: () => ({ name: "foreign edit" }) }),
  "PATCH /api/views/:id": foreign({ body: () => ({ name: "foreign edit" }) }),
  "PATCH /api/webhooks/:id": foreign({ body: () => ({ name: "foreign edit" }) }),
  "PATCH /api/workspace": scoped({ body: () => ({ name: "Renamed A" }) }),
  "POST /api/branding/assets": scoped({ body: () => ({ dataUrl }) }),
  "POST /api/email-templates/:key/preview": scoped({ body: () => ({}) }),
  "POST /api/email-templates/:key/test": scoped({ body: () => ({}) }),
  "POST /api/feedback/:id/actions/:actionId": foreign(),
  "POST /api/feedback/:id/ai/apply": foreign({ body: () => ({ applyTitle: true }) }),
  "POST /api/feedback/:id/ai/translate": foreign({ body: () => ({ targetLocale: "fr" }) }),
  "POST /api/feedback/:id/comments": foreign({ body: () => ({ body: "foreign reply" }) }),
  "POST /api/feedback/:id/issues": foreign({ body: (ids) => ({ integrationId: ids.integrationB }) }),
  "POST /api/feedback/:id/page-link": foreign({ body: () => ({}) }),
  "POST /api/feedback/:id/restore": foreign(),
  "POST /api/feedback/:id/watch": foreign(),
  "POST /api/integrations/:id/rotate-webhook-secret": foreign(),
  "POST /api/integrations/:id/test": foreign(),
  "POST /api/members": scoped({
    body: () => ({
      name: "Scoped Member",
      email: `scoped-${randomUUID()}@test.invalid`,
      password: "scoped-password-123",
      role: "viewer",
    }),
  }),
  "POST /api/members/:userId/reset-link": foreign({ status: [403, 404] }),
  "POST /api/notifications/read": scoped({ body: (ids) => ({ ids: [ids.notificationB] }) }),
  "POST /api/presence": foreign({ body: (ids) => ({ feedbackId: ids.feedbackB }) }),
  "POST /api/privacy/erase": scoped({ body: () => ({ email: "absent@test.invalid", dryRun: true }) }),
  "POST /api/projects": scoped({
    body: () => ({ name: "Scoped Project", slug: `scoped-${randomUUID().slice(0, 8)}` }),
  }),
  "POST /api/projects/:id/action-secret/rotate": foreign(),
  "POST /api/projects/:id/export": foreign({ body: () => ({}) }),
  "POST /api/projects/:id/identity-secret/rotate": foreign(),
  "POST /api/projects/:id/integrations": foreign({
    body: () => ({ provider: "github", token: "token-123456", repo: "foreign/repo" }),
  }),
  "POST /api/projects/:id/labels": foreign({ body: () => ({ name: "foreign label", color: "#112233" }) }),
  "POST /api/projects/:id/pages/regroup": foreign(),
  "POST /api/projects/:id/review-links": foreign({
    body: () => ({ label: "foreign link", url: "https://customer.test/" }),
  }),
  "POST /api/projects/:id/rotate-key": foreign(),
  "POST /api/projects/:id/rounds": foreign({ body: () => ({ name: "foreign round" }) }),
  "POST /api/settings/ai/test": scoped({
    body: () => ({ provider: "anthropic", model: "fixture", apiKey: randomUUID() }),
  }),
  "POST /api/tokens": scoped({ body: () => ({ name: "scoped token", scopes: ["feedback:read"] }) }),
  "POST /api/v1/feedback/:id/comments": foreign({ body: () => ({ body: "foreign reply" }) }),
  "POST /api/views": scoped({ body: () => ({ name: "scoped view" }) }),
  "POST /api/webhook-deliveries/:id/redeliver": foreign(),
  "POST /api/webhooks": foreign({
    body: (ids) => ({
      url: "https://example.test/hook",
      events: ["feedback.created"],
      projectId: ids.projectB,
    }),
  }),
  "POST /api/webhooks/:id/rotate-secret": foreign(),
  "POST /api/webhooks/:id/test": foreign(),
  "POST /api/workspace/transfer": foreign({
    body: (ids) => ({ userId: ids.userB }),
    status: [400, 403, 404],
  }),
  "PUT /api/email-templates/:key": scoped({ body: () => ({ subject: "Scoped A", body: "Scoped A body" }) }),
  "PUT /api/notification-preferences": foreign({
    body: (ids) => ({ projectId: ids.projectB, email: false }),
  }),
  "PUT /api/settings/ai": scoped({
    body: () => ({ provider: "anthropic", model: "fixture", apiKey: randomUUID() }),
  }),

  // --- system: instance administration; a workspace owner who is not an instance admin is refused --
  "DELETE /api/admin/instance-admins/:userId": authorization({ status: [403] }),
  "DELETE /api/admin/license": authorization({ status: [403] }),
  "GET /api/admin/instance-admins": authorization({ status: [403] }),
  "GET /api/admin/license": authorization({ status: [403] }),
  "GET /api/admin/settings/email": authorization({ status: [403] }),
  "GET /api/admin/settings/email/deliveries": authorization({ status: [403] }),
  "GET /api/admin/settings/security": authorization({ status: [403] }),
  "GET /api/admin/settings/sign-in": authorization({ status: [403] }),
  "PATCH /api/admin/settings/email": authorization({ status: [403], body: () => ({ host: "smtp.test" }) }),
  "PATCH /api/admin/settings/security": authorization({
    status: [403],
    body: () => ({ sessionDays: 7 }),
  }),
  "PATCH /api/admin/settings/sign-in": authorization({ status: [403], body: () => ({ magicLink: true }) }),
  "POST /api/admin/instance-admins": authorization({ status: [403], body: (ids) => ({ userId: ids.userB }) }),
  "POST /api/admin/license": authorization({
    status: [403],
    body: () => ({ license: "not-a-real-license-file-contents" }),
  }),
  "POST /api/admin/settings/email/deliveries/:id/resend": authorization({
    status: [403],
    path: (ids) => `/api/admin/settings/email/deliveries/${ids.deliveryB ?? ""}/resend`,
  }),
  "POST /api/admin/settings/email/deliveries/resend-skipped": authorization({ status: [403] }),
  "POST /api/admin/settings/email/test": authorization({
    status: [403],
    body: () => ({ to: "a@test.invalid" }),
  }),
  "POST /api/admin/update-check": authorization({ status: [403] }),

  // --- identity: the signed-in account, never the active workspace ---------------------------------
  "DELETE /api/me/avatar": authorization({
    run: async ({ send, snapshot }) => {
      const before = await snapshot();
      expect([200, 204]).toContain((await send({ method: "DELETE", path: "/api/me/avatar" })).status);
      expect(await snapshot()).toBe(before);
      expect((await send({ method: "DELETE", path: "/api/me/avatar" }, "none")).status).toBe(401);
    },
  }),
  "GET /api/auth/*": authorization({
    run: async ({ ids, send, snapshot, database }) => {
      const before = await snapshot();
      expect(await (await send({ method: "GET", path: "/api/auth/get-session" }, "none")).text()).toBe(
        "null",
      );
      const own = await (await send({ method: "GET", path: "/api/auth/get-session" })).text();
      expect(own).toContain("user-a-");
      expect(own).not.toContain(ids.userB ?? "");
      const foreignOrg = await send({
        method: "GET",
        path: `/api/auth/organization/get-full-organization?organizationId=${ids.orgB ?? ""}`,
      });
      // Better Auth clears the caller's own active workspace after this refusal; restore it for later cases.
      await database()`update session set active_organization_id=${ids.orgA ?? ""} where user_id=${ids.userA ?? ""}`;
      expect([400, 403, 404]).toContain(foreignOrg.status);
      expect(await foreignOrg.text()).not.toContain(ids.marker ?? "");
      expect(await snapshot()).toBe(before);
    },
  }),
  "GET /api/avatars/:userId": authorization({
    run: async ({ ids, send }) => {
      effects.get.mockClear();
      const response = await send({ method: "GET", path: `/api/avatars/${ids.userB ?? ""}` });
      expect(response.status).toBe(404);
      expect(effects.get).not.toHaveBeenCalled();
      expect((await send({ method: "GET", path: `/api/avatars/${ids.userB ?? ""}` }, "none")).status).toBe(
        401,
      );
    },
  }),
  "GET /api/me/invitations": authorization({
    run: async ({ ids, send, database }) => {
      const email = `${ids.userB ?? ""}@test.invalid`;
      const invitation = randomUUID();
      await database()`insert into invitation (id,organization_id,email,role,status,expires_at,inviter_id) values (${invitation},${ids.orgB ?? ""},${email},'member','pending',${new Date(Date.now() + 86_400_000)},${ids.userB ?? ""})`;
      try {
        const response = await send({ method: "GET", path: "/api/me/invitations" });
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).not.toContain(invitation);
        expect(text).not.toContain(ids.orgB ?? "");
        expect((await send({ method: "GET", path: "/api/me/invitations" }, "none")).status).toBe(401);
      } finally {
        await database()`delete from invitation where id=${invitation}`;
      }
    },
  }),
  "GET /api/me/preferences": authorization({
    run: async ({ send }) => {
      const response = await send({ method: "GET", path: "/api/me/preferences" });
      expect(response.status, await response.clone().text()).toBe(200);
      expect((await send({ method: "GET", path: "/api/me/preferences" }, "none")).status).toBe(401);
    },
  }),
  "PATCH /api/me/preferences": authorization({
    run: async ({ send, snapshot, database, ids }) => {
      const before = await snapshot();
      const response = await send({ method: "PATCH", path: "/api/me/preferences", body: { locale: "fr" } });
      expect(response.status).toBe(200);
      expect(await database()`select user_id from user_preference where locale='fr'`).toMatchObject([
        { user_id: String(ids.userA) },
      ]);
      expect(
        await database()`select 1 from user_preference where user_id=${ids.userB ?? ""} and locale='fr'`,
      ).toHaveLength(0);
      expect(await snapshot()).toBe(before);
      expect(
        (await send({ method: "PATCH", path: "/api/me/preferences", body: { locale: "de" } }, "none")).status,
      ).toBe(401);
    },
  }),
  "PATCH /api/me/profile": authorization({
    run: async ({ send, snapshot, database, ids }) => {
      const before = await snapshot();
      const response = await send({ method: "PATCH", path: "/api/me/profile", body: { name: "Only Me" } });
      expect(response.status).toBe(200);
      expect(await database()`select name from "user" where id=${ids.userB ?? ""}`).not.toMatchObject([
        { name: "Only Me" },
      ]);
      expect(await snapshot()).toBe(before);
      expect(
        (await send({ method: "PATCH", path: "/api/me/profile", body: { name: "Anon" } }, "none")).status,
      ).toBe(401);
    },
  }),
  "POST /api/auth/*": authorization({
    run: async ({ ids, send, snapshot, database }) => {
      const before = await snapshot();
      // Selecting, creating invitations in, or reading another workspace is refused for a non-member.
      for (const [path, body] of [
        ["/api/auth/organization/set-active", { organizationId: ids.orgB }],
        [
          "/api/auth/organization/invite-member",
          { organizationId: ids.orgB, email: "x@test.invalid", role: "member" },
        ],
        ["/api/auth/organization/update", { organizationId: ids.orgB, data: { name: "stolen" } }],
        [
          "/api/auth/organization/remove-member",
          { organizationId: ids.orgB, memberIdOrEmail: `${ids.userB ?? ""}@test.invalid` },
        ],
        ["/api/auth/organization/delete", { organizationId: ids.orgB }],
      ] as const) {
        const response = await send({ method: "POST", path, body });
        expect.soft([400, 401, 403, 404], path).toContain(response.status);
      }
      await database()`update session set active_organization_id=${ids.orgA ?? ""} where user_id=${ids.userA ?? ""}`;
      expect(await database()`select name from organization where id=${ids.orgB ?? ""}`).toMatchObject([
        { name: ids.orgB },
      ]);
      expect(await snapshot()).toBe(before);
      // Anonymous sign-in with a wrong password reveals nothing and creates no session.
      const anonymous = await send(
        {
          method: "POST",
          path: "/api/auth/sign-in/email",
          body: { email: `${ids.userB ?? ""}@test.invalid`, password: "wrong-password-1" },
        },
        "none",
      );
      expect([400, 401, 403]).toContain(anonymous.status);
    },
  }),
  "POST /api/me/avatar": authorization({
    run: async ({ send, snapshot, ids }) => {
      const before = await snapshot();
      effects.put.mockClear();
      const response = await send({ method: "POST", path: "/api/me/avatar", body: { dataUrl } });
      expect(response.status).toBe(200);
      expect(String(effects.put.mock.calls[0]?.[0])).not.toContain(ids.userB ?? "");
      expect(await snapshot()).toBe(before);
      expect((await send({ method: "POST", path: "/api/me/avatar", body: { dataUrl } }, "none")).status).toBe(
        401,
      );
    },
  }),
  "POST /api/me/email": authorization({
    run: async ({ send, snapshot, ids }) => {
      const before = await snapshot();
      const response = await send({
        method: "POST",
        path: "/api/me/email",
        body: { newEmail: `${ids.userB ?? ""}@test.invalid`, password: "not-the-password-1" },
      });
      expect([400, 401, 403, 409]).toContain(response.status);
      expect(await snapshot()).toBe(before);
      expect(
        (
          await send(
            { method: "POST", path: "/api/me/email", body: { newEmail: "a@test.invalid", password: "x" } },
            "none",
          )
        ).status,
      ).toBe(401);
    },
  }),

  // --- public: no session by design; nothing of any workspace in the answer ------------------------
  "GET /api/health": publicCase(),
  "GET /api/setup": publicCase(),
  "GET /api/sign-in-methods": publicCase(),
  "OPTIONS /w/*": publicCase({ path: () => "/w/config", status: [200, 204, 404] }),
  "POST /api/setup/claim": publicCase({ status: [410] }),
};

describe.skipIf(!process.env.PINWREN_ISOLATION_ADMIN_URL)("Cloud route-wide isolation acceptance", () => {
  let fixture: Awaited<ReturnType<typeof createCloudFixture>> | undefined;
  let api: typeof ApiModule.app;
  const suffix = randomUUID(),
    password = randomUUID();
  const marker = `MARK-B-${suffix}`;
  const ids: Ids = {};
  const cookies = { a: new Map<string, string>(), disposable: new Map<string, string>() };
  const database = () => {
    if (!fixture) throw new Error("Route fixture is not ready");
    return fixture.db;
  };
  function takeCookies(response: Response, jar: Map<string, string>) {
    for (const cookie of response.headers.getSetCookie()) {
      const value = cookie.split(";")[0] ?? "",
        equals = value.indexOf("=");
      if (equals < 0) continue;
      const content = value.slice(equals + 1);
      if (content) jar.set(value.slice(0, equals), content);
      else jar.delete(value.slice(0, equals));
    }
  }
  function raw(
    path: string,
    options: { method?: string; jar?: Map<string, string>; token?: string; body?: unknown },
  ) {
    const headers = new Headers({
      origin: "http://localhost:3100",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    });
    if (options.jar)
      headers.set("cookie", [...options.jar].map(([key, value]) => `${key}=${value}`).join("; "));
    if (options.token) headers.set("authorization", `Bearer ${options.token}`);
    return api.request(`http://localhost:3100${path}`, {
      method: options.method ?? "GET",
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  }
  async function signIn(user: string, org: string, jar: Map<string, string>) {
    const signed = await raw("/api/auth/sign-in/email", {
      method: "POST",
      body: { email: `${user}@test.invalid`, password },
    });
    expect(signed.status).toBe(200);
    takeCookies(signed, jar);
    const active = await raw("/api/auth/organization/set-active", {
      method: "POST",
      jar,
      body: { organizationId: org },
    });
    expect(active.status).toBe(200);
    takeCookies(active, jar);
  }
  const send: Context["send"] = (call, as = "a") =>
    raw(call.path, {
      method: call.method,
      ...(as === "none"
        ? {}
        : as === "disposable"
          ? { jar: cookies.disposable }
          : call.token
            ? { token: ids.tokenA ?? "" }
            : { jar: cookies.a }),
      ...(call.body === undefined ? {} : { body: call.body }),
    });

  const snapshot = () => snapshotOrganization(database(), ids.orgB ?? "");
  const context = (): Context => ({
    ids,
    send,
    database,
    snapshot,
  });

  beforeAll(async () => {
    fixture = await createCloudFixture();
    vi.stubEnv("PINWREN_MODE", "cloud");
    vi.stubEnv("DATABASE_URL", fixture.runtimeUrl);
    vi.stubEnv("PINWREN_SERVICE_DATABASE_URL", fixture.serviceUrl);
    vi.stubEnv("PINWREN_URL", "http://localhost:3100");
    vi.stubEnv("PINWREN_SECRET", randomUUID() + randomUUID());
    vi.stubEnv("PINWREN_DISABLE_SIGNUP", "false");
    vi.stubEnv("PINWREN_ADMIN_EMAILS", undefined);
    const hashed = await hashPassword(password);
    const { hashToken, encryptSecret } = await import("./crypto");
    const db = fixture.db;
    const disposableOrg = `route-disposable-${suffix}`,
      disposableUser = `user-disposable-${suffix}`;
    Object.assign(ids, {
      marker,
      orgA: `route-a-${suffix}`,
      orgB: `route-b-${suffix}`,
      userA: `user-a-${suffix}`,
      userB: `user-b-${suffix}`,
      disposableOrg,
    });
    for (const [key, org, user, mark] of [
      ["A", ids.orgA, ids.userA, `MARK-A-${suffix}`],
      ["B", ids.orgB, ids.userB, marker],
      ["D", disposableOrg, disposableUser, `MARK-D-${suffix}`],
    ] as const) {
      const projectId = randomUUID(),
        feedbackId = randomUUID(),
        token = `pwt_${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`;
      await db`insert into organization (id,name,slug) values (${org ?? ""},${org ?? ""},${org ?? ""})`;
      await db`insert into "user" (id,name,email,email_verified) values (${user ?? ""},${user ?? ""},${`${user ?? ""}@test.invalid`},true)`;
      await db`insert into account (id,account_id,provider_id,user_id,password) values (${randomUUID()},${user ?? ""},'credential',${user ?? ""},${hashed})`;
      await db`insert into member (id,organization_id,user_id,role) values (${randomUUID()},${org ?? ""},${user ?? ""},'owner')`;
      await db`insert into project (id,org_id,name,slug,public_key,allowed_origins,identity_secret,action_secret) values (${projectId},${org ?? ""},${mark},${org ?? ""},${projectId},${db.array(["https://customer.test"])},${randomUUID()},${randomUUID()})`;
      await db`insert into feedback (id,org_id,project_id,number,kind,body,client_id) values (${feedbackId},${org ?? ""},${projectId},1,'bug',${mark},${randomUUID()})`;
      await db`update project set feedback_counter=1 where id=${projectId}`;
      if (key === "D") continue;
      const row = {
        comment: randomUUID(),
        label: randomUUID(),
        round: randomUUID(),
        reviewLink: randomUUID(),
        view: randomUUID(),
        endpoint: randomUUID(),
        delivery: randomUUID(),
        integration: randomUUID(),
        asset: randomUUID(),
        notification: randomUUID(),
        token: randomUUID(),
        mail: randomUUID(),
      };
      await db`insert into comment (id,org_id,feedback_id,body) values (${row.comment},${org ?? ""},${feedbackId},${mark})`;
      await db`insert into label (id,org_id,project_id,name,color) values (${row.label},${org ?? ""},${projectId},${mark},'#112233')`;
      await db`insert into review_round (id,org_id,project_id,name) values (${row.round},${org ?? ""},${projectId},${mark})`;
      await db`insert into review_link (id,org_id,project_id,label,token_hash) values (${row.reviewLink},${org ?? ""},${projectId},${mark},${randomUUID()})`;
      await db`insert into saved_view (id,org_id,owner_id,name,shared) values (${row.view},${org ?? ""},${user ?? ""},${mark},true)`;
      await db`insert into webhook_endpoint (id,org_id,project_id,name,url) values (${row.endpoint},${org ?? ""},${projectId},${mark},'https://example.test/hook')`;
      const payload = {
        id: randomUUID(),
        event: "ping",
        apiVersion: "2025-01-01",
        createdAt: new Date().toISOString(),
        data: {},
      };
      await db`insert into webhook_delivery (id,org_id,endpoint_id,event_id,event,payload,status) values (${row.delivery},${org ?? ""},${row.endpoint},${payload.id},'ping',${db.json(payload)},'success')`;
      await db`insert into issue_integration (id,org_id,project_id,provider,token,token_hint,repo,webhook_secret) values (${row.integration},${org ?? ""},${projectId},'github',${encryptSecret(randomUUID())},'test',${mark},${encryptSecret(randomUUID())})`;
      await db`insert into feedback_asset (id,org_id,feedback_id,kind,storage_key,content_type,bytes) values (${row.asset},${org ?? ""},${feedbackId},'attachment',${row.asset},'text/plain',1)`;
      await db`insert into notification (id,org_id,user_id,type,feedback_id) values (${row.notification},${org ?? ""},${user ?? ""},'test',${feedbackId})`;
      await db`insert into feedback_watcher (feedback_id,user_id) values (${feedbackId},${user ?? ""})`;
      await db`insert into email_template (org_id,key,subject,body) values (${org ?? ""},'reporter_received',${mark},${mark})`;
      await db`insert into brand_asset (org_id,storage_key,content_type,bytes) values (${org ?? ""},${row.asset},'text/plain',1)`;
      await db`insert into email_delivery (id,org_id,to_address,template_key,subject,status,payload) values (${row.mail},${org ?? ""},${`${mark}@test.invalid`},'test',${mark},'sent',${db.json({})})`;
      await db`insert into api_token (id,org_id,user_id,name,prefix,hash,scopes) values (${row.token},${org ?? ""},${user ?? ""},${mark},${token.slice(0, 12)},${await hashToken(token)},${db.array(["feedback:read", "feedback:write"])})`;
      if (key === "A") {
        ids.tokenA = token;
        ids.projectA = projectId;
      } else
        Object.assign(ids, {
          projectB: projectId,
          feedbackB: feedbackId,
          commentB: row.comment,
          labelB: row.label,
          roundB: row.round,
          reviewLinkB: row.reviewLink,
          viewB: row.view,
          webhookB: row.endpoint,
          deliveryB: row.delivery,
          integrationB: row.integration,
          assetB: row.asset,
          notificationB: row.notification,
          tokenIdB: row.token,
          templateKey: "reporter_received",
          actionKey: "send",
        });
    }
    await db`update "user" set image='/api/avatars/' || id where id=${ids.userB ?? ""}`;
    api = (await import("./index")).app;
    await signIn(ids.userA ?? "", ids.orgA ?? "", cookies.a);
    await signIn(disposableUser, disposableOrg, cookies.disposable);
  }, 120_000);
  beforeEach(() => {
    for (const mock of [
      effects.put,
      effects.get,
      effects.remove,
      effects.fetch,
      effects.enqueue,
      effects.publish,
    ])
      mock.mockReset();
    effects.put.mockResolvedValue(undefined);
    effects.remove.mockResolvedValue(undefined);
    effects.enqueue.mockResolvedValue(undefined);
    effects.publish.mockResolvedValue(undefined);
    effects.get.mockResolvedValue({
      body: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("fixture"));
          c.close();
        },
      }),
      bytes: 7,
    });
    effects.fetch.mockResolvedValue(Response.json({ ok: true }));
  });
  afterAll(async () => {
    if (fixture) {
      await closeIdentityDatabase();
      await getRuntimeDb().$client.end();
      await fixture.dispose();
    }
    vi.unstubAllEnvs();
  });

  const entries = Object.entries(cases);
  const routes = inventoryRoutes("tenant", "identity", "system", "public");

  it("registers exactly one case for every tenant, identity, system and public inventory route", () => {
    const checks = Object.fromEntries(
      Object.entries(cases).map(([key, spec]) => {
        const boundary = routes[key]?.boundary ?? "unknown";
        const consistent =
          (spec.kind === "foreign" && boundary === "tenant") ||
          (spec.kind === "scoped" && boundary === "tenant") ||
          (spec.kind === "authorization" && (boundary === "system" || boundary === "identity")) ||
          (spec.kind === "public" && boundary === "public");
        return [key, { check: consistent ? expectedCheck(key, boundary) : `inconsistent ${spec.kind}` }];
      }),
    );
    expect(coverageGaps(["tenant", "identity", "system", "public"], checks)).toEqual({
      missing: [],
      stale: [],
      mismatched: [],
    });
  });

  describe.each(entries.filter(([, spec]) => !spec.destructive))("%s", (key, spec) => {
    it(`${spec.kind} case`, async () => {
      const ctx = context();
      if (spec.run) return spec.run(ctx);
      const [method = "GET", pattern = ""] = key.split(" ");
      const call: Call = {
        method,
        path: spec.path ? spec.path(ids) : derivePath(pattern, ids),
        ...(spec.body
          ? { body: spec.body(ids) }
          : method === "GET" || method === "DELETE" || method === "OPTIONS"
            ? {}
            : { body: {} }),
        ...(pattern.startsWith("/api/v1") || pattern === "/mcp" ? { token: true } : {}),
      };
      const before = await snapshot();
      const response = await send(call, spec.kind === "public" ? "none" : "a");
      const text = await response.text();
      const label = `${key} -> ${response.status} ${text.slice(0, 200)}`;
      if (spec.kind === "foreign") expect(spec.status ?? [403, 404], label).toContain(response.status);
      else if (spec.kind === "authorization") expect(spec.status ?? [403], label).toContain(response.status);
      else if (spec.kind === "public") {
        if (spec.status) expect(spec.status, label).toContain(response.status);
        else expect(response.status, label).toBeLessThan(500);
      } else expect(response.status, label).toBeLessThan(spec.status ? 600 : 400);
      expect(text, label).not.toContain(marker);
      expect(text, label).not.toContain(ids.projectB ?? "");
      expect(await snapshot(), `${key} changed workspace B`).toBe(before);
    });
  });

  describe.each(entries.filter(([, spec]) => spec.destructive))("%s", (key, spec) => {
    it(`${spec.kind} case against a disposable workspace`, async () => {
      await spec.run?.(context());
    });
  });

  it("answers 401 to every session-only inventory route without credentials", async () => {
    const skipped = (key: string) =>
      key.includes(" /api/auth/") ||
      key.includes(" /api/v1/") ||
      key.endsWith(" /mcp") ||
      key.includes(" /w/");
    for (const [key, spec] of entries) {
      const route = routes[key];
      if (!route || route.boundary === "public" || skipped(key) || spec.run) continue;
      const [method = "GET", pattern = ""] = key.split(" ");
      const response = await send(
        {
          method,
          path: spec.path ? spec.path(ids) : derivePath(pattern, ids),
          ...(method === "GET" || method === "DELETE" ? {} : { body: spec.body ? spec.body(ids) : {} }),
        },
        "none",
      );
      expect.soft(response.status, key).toBe(401);
    }
  });
});
