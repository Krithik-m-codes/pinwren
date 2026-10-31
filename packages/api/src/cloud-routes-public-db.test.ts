import type * as ApiModule from "./index";
import type * as BossModule from "./jobs/boss";
import type * as BusModule from "./realtime/bus";
import type * as StorageModule from "./storage";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { getRuntimeDb } from "../../db/src/connection";
import { closeIdentityDatabase } from "../../db/src/identity";
import { createCloudFixture } from "./test-helpers/cloud-fixture";
import { coverageGaps, expectedCheck, inventoryRoutes } from "./test-helpers/route-inventory";
import { snapshotOrganization } from "./test-helpers/tenant-snapshot";

/**
 * Route-wide acceptance coverage for every `capability` inventory route (widget, guest portal,
 * unsubscribe, signed assets, inbound tracker webhooks). The caller holds a valid capability for
 * workspace A (its project key, reporter token, page link, review link, integration secret or signed
 * claim) and names workspace B's resource. Each case must answer with the established miss (404/403/401,
 * or an empty 200 for list reads), carry nothing of B's, and leave every workspace-B row unchanged.
 * The inventory and this registry are compared in both directions, so a new route without a case fails.
 */
const effects = vi.hoisted(() => ({
  enqueue: vi.fn<(...args: unknown[]) => Promise<void>>(),
  publish: vi.fn<(...args: unknown[]) => Promise<void>>(),
  get: vi.fn(),
  put: vi.fn<(...args: unknown[]) => Promise<void>>(),
  remove: vi.fn<(...args: unknown[]) => Promise<void>>(),
}));
vi.mock("./jobs/boss", async (original) => ({
  ...(await original<typeof BossModule>()),
  enqueue: effects.enqueue,
}));
vi.mock("./realtime/bus", async (original) => ({
  ...(await original<typeof BusModule>()),
  publish: effects.publish,
}));
vi.mock("./storage", async (original) => ({
  ...(await original<typeof StorageModule>()),
  storage: () => ({ get: effects.get, put: effects.put, remove: effects.remove }),
}));

type Ids = Record<string, string>;
type Request = {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  key?: string;
};
type Spec = {
  /** Builds the request; `ids` holds both workspaces' identifiers and capabilities. */
  request?: (ids: Ids, helpers: Helpers) => Request | Promise<Request>;
  /** Statuses that count as the established refusal for this route. */
  status: number[];
  /** Runs the case itself when one request cannot show the property. */
  run?: (ids: Ids, helpers: Helpers) => Promise<void>;
  /** Why a generic foreign-id request cannot apply (kept to genuinely public-by-design routes). */
  note?: string;
};
type Helpers = {
  request: (call: Request) => Response | Promise<Response>;
  db: () => ReturnType<typeof createCloudFixture> extends Promise<infer F>
    ? F extends { db: infer D }
      ? D
      : never
    : never;
  snapshot: () => Promise<string>;
};

const origin = "https://customer.test";
const dataUrlBody = (clientId = randomUUID()) => ({
  clientId,
  kind: "bug",
  body: "widget write",
  page: { url: origin + "/page" },
  environment: { userAgent: "fixture", viewport: { w: 100, h: 100 }, dpr: 1 },
});

/** Inbound tracker events that, if mis-routed, would resolve workspace B's linked report. */
const webhookCase = (provider: "github" | "gitlab" | "linear" | "jira"): Spec => ({
  status: [200, 401],
  run: async (ids, { request, db, snapshot }) => {
    const before = await snapshot();
    const { hmacSha256Hex } = await import("./crypto");
    const send = (secret: string) => {
      if (provider === "github") {
        const body = JSON.stringify({
          action: "closed",
          repository: { full_name: "fixture/shared" },
          issue: { number: 1 },
        });
        return request({
          method: "POST",
          path: "/api/integrations/github/webhook",
          headers: {
            "x-hub-signature-256": `sha256=${hmacSha256Hex(secret, body)}`,
            "x-github-event": "issues",
            "x-github-delivery": randomUUID(),
            "content-type": "application/json",
          },
          body: JSON.parse(body) as unknown,
        });
      }
      if (provider === "gitlab")
        return request({
          method: "POST",
          path: "/api/integrations/gitlab/webhook",
          headers: { "x-gitlab-token": secret, "x-gitlab-event-uuid": randomUUID() },
          body: {
            object_kind: "issue",
            project: { path_with_namespace: "fixture/shared" },
            object_attributes: { action: "close", iid: 1 },
          },
        });
      if (provider === "linear") {
        const body = JSON.stringify({
          type: "Issue",
          action: "update",
          webhookTimestamp: Date.now(),
          updatedFrom: { stateId: "x" },
          data: { identifier: "SHARED-1", number: 1, team: { key: "SHARED" }, state: { type: "completed" } },
        });
        return request({
          method: "POST",
          path: "/api/integrations/linear/webhook",
          headers: {
            "linear-signature": hmacSha256Hex(secret, body),
            "linear-delivery": randomUUID(),
            "content-type": "application/json",
          },
          body: JSON.parse(body) as unknown,
        });
      }
      const body = JSON.stringify({
        webhookEvent: "jira:issue_updated",
        changelog: { items: [{ field: "status" }] },
        issue: {
          key: "SHARED-1",
          fields: { project: { key: "SHARED" }, status: { statusCategory: { key: "done" } } },
        },
      });
      return request({
        method: "POST",
        path: "/api/integrations/jira/webhook",
        headers: {
          "x-hub-signature": `sha256=${hmacSha256Hex(secret, body)}`,
          "x-atlassian-webhook-identifier": randomUUID(),
          "content-type": "application/json",
        },
        body: JSON.parse(body) as unknown,
      });
    };
    // A signature that no integration's secret produces is refused and changes nothing.
    expect((await send("not-a-secret")).status).toBe(401);
    expect(await snapshot()).toBe(before);
    // Workspace A's secret verifies only workspace A's integration, even though both share the repository.
    const response = await send(ids[`secret_${provider}_A`] ?? "");
    expect(response.status).toBe(200);
    expect(await db()`select status from feedback where id=${ids[`item_${provider}_A`] ?? ""}`).toMatchObject(
      [provider === "jira" ? { status: "open" } : { status: "resolved" }],
    );
    expect(await snapshot()).toBe(before);
  },
});

const cases: Record<string, Spec> = {
  "DELETE /w/feedback/:id": {
    status: [403, 404],
    request: (ids) => ({
      method: "DELETE",
      path: `/w/feedback/${ids.itemB ?? ""}`,
      key: ids.keyA ?? "",
      headers: { "x-pinwren-reporter-token": ids.reporterB ?? "" },
    }),
  },
  "GET /api/brand-assets/:id": {
    status: [404],
    note: "Logos are public by an unguessable id (shown on customers' sites); an unknown or malformed id is a plain 404.",
    request: () => ({ method: "GET", path: `/api/brand-assets/${randomUUID()}` }),
  },
  "GET /api/email-assets/:token": {
    status: [404],
    request: async (ids) => {
      const { emailImageToken } = await import("./email/links");
      return { method: "GET", path: `/api/email-assets/${emailImageToken(ids.assetB ?? "", 0)}` };
    },
  },
  "GET /api/guest/:key/feedback": {
    status: [200],
    request: (ids) => ({
      method: "GET",
      path: `/api/guest/${ids.keyA ?? ""}/feedback`,
      headers: { "x-pinwren-reporter-tokens": ids.reporterB ?? "" },
    }),
  },
  "GET /api/guest/:key/feedback/:id": {
    status: [404],
    request: (ids) => ({
      method: "GET",
      path: `/api/guest/${ids.keyA ?? ""}/feedback/${ids.itemB ?? ""}`,
      headers: { "x-pinwren-reporter-tokens": ids.reporterB ?? "" },
    }),
  },
  "GET /api/unsubscribe": {
    status: [400],
    request: async (ids) => ({
      method: "GET",
      path: `/api/unsubscribe?token=${encodeURIComponent(await forged(ids))}`,
    }),
  },
  "GET /api/unsubscribe/team": {
    status: [400],
    request: async (ids) => ({
      method: "GET",
      path: `/api/unsubscribe/team?token=${encodeURIComponent(await forgedTeam(ids))}`,
    }),
  },
  "GET /w/config": {
    status: [200],
    request: (ids) => ({ method: "GET", path: "/w/config", key: ids.keyA ?? "" }),
  },
  "GET /w/feedback": {
    status: [200],
    request: (ids) => ({
      method: "GET",
      path: "/w/feedback",
      key: ids.keyA ?? "",
      headers: { "x-pinwren-link-token": ids.linkB ?? "", "x-pinwren-reporter-tokens": ids.reporterB ?? "" },
    }),
  },
  "GET /w/feedback/:id": {
    status: [404],
    request: (ids) => ({
      method: "GET",
      path: `/w/feedback/${ids.itemB ?? ""}`,
      key: ids.keyA ?? "",
      headers: { "x-pinwren-link-token": ids.linkB ?? "" },
    }),
  },
  "GET /w/feedback/:id/comments": {
    status: [200, 404],
    request: (ids) => ({
      method: "GET",
      path: `/w/feedback/${ids.itemB ?? ""}/comments`,
      key: ids.keyA ?? "",
      headers: { "x-pinwren-reporter-tokens": ids.reporterB ?? "" },
    }),
  },
  "GET /w/mine": {
    status: [200],
    request: (ids) => ({
      method: "GET",
      path: "/w/mine",
      key: ids.keyA ?? "",
      headers: { "x-pinwren-reporter-tokens": ids.reporterB ?? "" },
    }),
  },
  "GET /w/review-link": {
    status: [404],
    request: (ids) => ({
      method: "GET",
      path: "/w/review-link",
      key: ids.keyA ?? "",
      headers: { "x-pinwren-review-token": ids.reviewB ?? "" },
    }),
  },
  "PATCH /w/feedback/:id": {
    status: [403, 404],
    request: (ids) => ({
      method: "PATCH",
      path: `/w/feedback/${ids.itemB ?? ""}`,
      key: ids.keyA ?? "",
      headers: { "x-pinwren-reporter-token": ids.reporterB ?? "" },
      body: { status: "resolved" },
    }),
  },
  "PATCH /w/feedback/:id/anchor": {
    status: [403, 404],
    request: async (ids) => {
      const { pageLinkToken } = await import("./services/page-link");
      return {
        method: "PATCH",
        path: `/w/feedback/${ids.itemB ?? ""}/anchor`,
        key: ids.keyA ?? "",
        headers: { "x-pinwren-link-token": pageLinkToken(ids.itemB ?? "", { scope: "repin" }).token },
        body: {
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
        },
      };
    },
  },
  "POST /api/guest/:key/feedback/:id/comments": {
    status: [404],
    request: (ids) => ({
      method: "POST",
      path: `/api/guest/${ids.keyA ?? ""}/feedback/${ids.itemB ?? ""}/comments`,
      headers: { "x-pinwren-reporter-tokens": ids.reporterB ?? "" },
      body: { body: "foreign guest reply" },
    }),
  },
  "POST /api/integrations/github/webhook": webhookCase("github"),
  "POST /api/integrations/gitlab/webhook": webhookCase("gitlab"),
  "POST /api/integrations/jira/webhook": webhookCase("jira"),
  "POST /api/integrations/linear/webhook": webhookCase("linear"),
  "POST /api/unsubscribe": {
    status: [400],
    request: async (ids) => ({
      method: "POST",
      path: `/api/unsubscribe?token=${encodeURIComponent(await forged(ids))}`,
    }),
  },
  "POST /api/unsubscribe/team": {
    status: [400],
    request: async (ids) => ({
      method: "POST",
      path: `/api/unsubscribe/team?token=${encodeURIComponent(await forgedTeam(ids))}`,
    }),
  },
  "POST /w/feedback": {
    status: [201],
    run: async (ids, { request, db, snapshot }) => {
      const before = await snapshot();
      const response = await request({
        method: "POST",
        path: "/w/feedback",
        key: ids.keyA ?? "",
        body: { ...dataUrlBody(), projectId: ids.projectB, orgId: ids.orgB },
      });
      expect(response.status).toBe(201);
      expect(await db()`select org_id from feedback where body='widget write'`).toMatchObject([
        { org_id: ids.orgA },
      ]);
      expect(await snapshot()).toBe(before);
    },
  },
  "POST /w/feedback/:id/comments": {
    status: [404],
    request: (ids) => ({
      method: "POST",
      path: `/w/feedback/${ids.itemB ?? ""}/comments`,
      key: ids.keyA ?? "",
      headers: { "x-pinwren-reporter-tokens": ids.reporterB ?? "" },
      body: { body: "foreign widget reply" },
    }),
  },
};

async function forged(ids: Ids): Promise<string> {
  const { unsubscribeToken } = await import("./email/unsubscribe");
  const token = unsubscribeToken(ids.orgA ?? "", "reporter@test.invalid");
  const [part, mac] = token.split(".");
  const claim = JSON.parse(Buffer.from(part ?? "", "base64url").toString()) as object;
  return `${Buffer.from(JSON.stringify({ ...claim, o: ids.orgB })).toString("base64url")}.${mac ?? ""}`;
}
async function forgedTeam(ids: Ids): Promise<string> {
  const { teamUnsubscribeToken } = await import("./email/links");
  const token = teamUnsubscribeToken({
    kind: "address",
    projectId: ids.projectA ?? "",
    email: "reporter@test.invalid",
  });
  const [part, mac] = token.split(".");
  const claim = JSON.parse(Buffer.from(part ?? "", "base64url").toString()) as Record<string, unknown>;
  const swapped = JSON.stringify(claim).replaceAll(ids.projectA ?? "", ids.projectB ?? "");
  return `${Buffer.from(swapped).toString("base64url")}.${mac ?? ""}`;
}

describe.skipIf(!process.env.PINWREN_ISOLATION_ADMIN_URL)(
  "Cloud public capability route-wide isolation",
  () => {
    let fixture: Awaited<ReturnType<typeof createCloudFixture>> | undefined;
    let api: typeof ApiModule.app;
    const suffix = randomUUID();
    const marker = `MARK-B-${suffix}`;
    const ids: Ids = {};
    const db = () => {
      if (!fixture) throw new Error("Public route fixture is not ready");
      return fixture.db;
    };
    const request: Helpers["request"] = (call) => {
      const headers = new Headers({ "content-type": "application/json", ...call.headers });
      if (call.body !== undefined)
        headers.set("content-length", String(Buffer.byteLength(JSON.stringify(call.body))));
      if (call.key) headers.set("x-pinwren-key", call.key);
      if (call.path.startsWith("/w/")) headers.set("origin", origin);
      return api.request(`http://localhost:3100${call.path}`, {
        method: call.method,
        headers,
        ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
      });
    };
    const snapshot = () => snapshotOrganization(db(), ids.orgB ?? "");
    const helpers = (): Helpers => ({ request, db, snapshot });

    beforeAll(async () => {
      fixture = await createCloudFixture();
      vi.stubEnv("PINWREN_MODE", "cloud");
      vi.stubEnv("DATABASE_URL", fixture.runtimeUrl);
      vi.stubEnv("PINWREN_SERVICE_DATABASE_URL", fixture.serviceUrl);
      vi.stubEnv("PINWREN_URL", "http://localhost:3100");
      vi.stubEnv("PINWREN_SECRET", randomUUID() + randomUUID());
      vi.stubEnv("SMTP_HOST", undefined);
      vi.stubEnv("EMAIL_FROM", undefined);
      const { sha256Hex, encryptSecret } = await import("./crypto");
      const { pageLinkToken } = await import("./services/page-link");
      const database = fixture.db;
      Object.assign(ids, { orgA: `rpub-a-${suffix}`, orgB: `rpub-b-${suffix}`, marker });
      for (const [side, org] of [
        ["A", ids.orgA],
        ["B", ids.orgB],
      ] as const) {
        const mark = side === "B" ? marker : `MARK-A-${suffix}`;
        const projectId = randomUUID(),
          item = randomUUID(),
          key = `pk_${randomUUID()}`,
          reporter = randomUUID().replaceAll("-", ""),
          review = `pwr_${randomUUID()}`,
          asset = randomUUID();
        await database`insert into organization (id,name,slug) values (${org ?? ""},${org ?? ""},${org ?? ""})`;
        await database`insert into project (id,org_id,name,slug,public_key,allowed_origins,public_read,identity_secret,action_secret,notify_emails,feedback_counter) values (${projectId},${org ?? ""},${org ?? ""},${org ?? ""},${key},${database.array([origin])},true,${randomUUID()},${randomUUID()},${database.array(["reporter@test.invalid"])},1)`;
        await database`insert into feedback (id,org_id,project_id,number,kind,body,client_id,reporter_token_hash,reporter_guest) values (${item},${org ?? ""},${projectId},1,'bug',${`public ${mark}`},${randomUUID()},${sha256Hex(reporter)},${database.json({ name: "Reporter", email: `private-${mark}@test.invalid` })})`;
        await database`insert into comment (org_id,feedback_id,body,visibility) values (${org ?? ""},${item},${`INTERNAL ${mark}`},'internal'),(${org ?? ""},${item},${`PUBLIC ${mark}`},'public')`;
        await database`insert into review_link (org_id,project_id,label,token_hash) values (${org ?? ""},${projectId},'fixture',${sha256Hex(review)})`;
        await database`insert into feedback_asset (id,org_id,feedback_id,kind,storage_key,content_type,bytes) values (${asset},${org ?? ""},${item},'screenshot',${`${org ?? ""}/${asset}.png`},'image/png',1)`;
        Object.assign(ids, {
          [`project${side}`]: projectId,
          [`item${side}`]: item,
          [`key${side}`]: key,
          [`reporter${side}`]: reporter,
          [`review${side}`]: review,
          [`asset${side}`]: asset,
          [`link${side}`]: pageLinkToken(item).token,
        });
        // One integration per provider, all sharing a repository / team / project key with the other
        // workspace, each with its own secret and a linked report numbered 1.
        for (const provider of ["github", "gitlab", "linear", "jira"] as const) {
          const secret = randomUUID(),
            integration = randomUUID(),
            linked = randomUUID();
          const repo = provider === "linear" || provider === "jira" ? "SHARED" : "fixture/shared";
          await database`insert into feedback (id,org_id,project_id,number,kind,body,client_id) values (${linked},${org ?? ""},${projectId},${provider === "github" ? 2 : provider === "gitlab" ? 3 : provider === "linear" ? 4 : 5},'bug',${`linked ${provider} ${mark}`},${randomUUID()})`;
          await database`insert into issue_integration (id,org_id,project_id,provider,token,token_hint,repo,webhook_secret) values (${integration},${org ?? ""},${projectId},${provider},${encryptSecret(randomUUID())},'test',${repo},${encryptSecret(secret)})`;
          await database`insert into issue_link (org_id,feedback_id,integration_id,provider,number,url,state) values (${org ?? ""},${linked},${integration},${provider},1,'https://example.test/1','open')`;
          Object.assign(ids, {
            [`secret_${provider}_${side}`]: secret,
            [`item_${provider}_${side}`]: linked,
          });
        }
        await database`update project set feedback_counter=5 where id=${projectId}`;
      }
      api = (await import("./index")).app;
    }, 120_000);
    beforeEach(() => {
      effects.enqueue.mockReset().mockResolvedValue(undefined);
      effects.publish.mockReset().mockResolvedValue(undefined);
      effects.put.mockReset().mockResolvedValue(undefined);
      effects.remove.mockReset().mockResolvedValue(undefined);
      effects.get.mockReset().mockResolvedValue(null);
    });
    afterAll(async () => {
      if (fixture) {
        await closeIdentityDatabase();
        await getRuntimeDb().$client.end();
        await fixture.dispose();
      }
      vi.unstubAllEnvs();
    });

    it("registers exactly one case for every capability inventory route", () => {
      const checks = Object.fromEntries(
        Object.keys(cases).map((key) => [key, { check: expectedCheck(key, "capability") }]),
      );
      expect(coverageGaps(["capability"], checks)).toEqual({ missing: [], stale: [], mismatched: [] });
      expect(Object.keys(inventoryRoutes("capability"))).toHaveLength(Object.keys(cases).length);
    });

    describe.each(Object.entries(cases))("%s", (key, spec) => {
      it("refuses the foreign capability and leaves workspace B untouched", async () => {
        if (spec.run) return spec.run(ids, helpers());
        if (!spec.request) throw new Error(`${key} needs a request or a run`);
        const before = await snapshot();
        const call = await spec.request(ids, helpers());
        const response = await request(call);
        const text = await response.text();
        const label = `${key} -> ${response.status} ${text.slice(0, 200)}`;
        expect(spec.status, label).toContain(response.status);
        expect(text, label).not.toContain(marker);
        expect(text, label).not.toContain(ids.itemB ?? "");
        expect(await snapshot(), `${key} changed workspace B`).toBe(before);
      });
    });
  },
);
