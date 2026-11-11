import type * as ApiModule from "./index";
import type * as BossModule from "./jobs/boss";
import type * as BusModule from "./realtime/bus";
import type * as SafeFetchModule from "./outbound/safe-fetch";
import type * as StorageModule from "./storage";
import { createHmac, randomUUID } from "node:crypto";
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
  /** The tracker APIs Asana / Notion deliveries are read back from (the webhooks carry ids, not values). */
  fetch: vi.fn<(url: string) => Promise<Response>>(),
}));
vi.mock("./outbound/safe-fetch", async (original) => ({
  ...(await original<typeof SafeFetchModule>()),
  safeFetch: effects.fetch,
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
const shareHeaders = (token?: string) => ({ "x-pinwren-share-token": token ?? "" });
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
const WEBHOOK_KEY = `whsec_${Buffer.from("fixture-dodo-webhook-key-0123456789").toString("base64")}`;
/** Board trackers: every workspace's integration shares the same board / project / list / database id. */
const BOARD_REPO = {
  trello: "5f1a2b3c4d5e6f7a8b9c0d1e",
  asana: "1200000001",
  clickup: "9001",
  notion: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
} as const;
type BoardProvider = keyof typeof BOARD_REPO;
const BOARD_PROVIDERS = Object.keys(BOARD_REPO) as BoardProvider[];
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

/**
 * Inbound webhooks of the board trackers. The URL names an integration (`?i=`), so the capability is that id plus
 * the integration's own signing secret. Workspace A's secret must not act on workspace B's integration, an
 * unknown id looks like any bad signature, a one-time handshake is refused unless the integration is waiting
 * for it, and a verified delivery resolves only the delivering integration's own linked item — even though
 * both workspaces' items carry the same tracker id.
 */
const boardWebhookCase = (provider: BoardProvider): Spec => ({
  status: [200, 401],
  run: async (ids, { request, db, snapshot }) => {
    const before = await snapshot();
    const base = "http://localhost:3100/api/integrations/" + provider + "/webhook";
    const send = (integration: string, secret: string) => {
      const external = "ext-" + provider;
      let body: Record<string, unknown>;
      let headers: Record<string, string>;
      if (provider === "trello") {
        body = {
          action: {
            id: randomUUID(),
            type: "updateCard",
            data: { card: { id: external, idShort: 1 }, listAfter: { id: "done" }, listBefore: { id: "l1" } },
          },
        };
        const raw = JSON.stringify(body);
        const sig = createHmac("sha1", secret)
          .update(raw)
          .update(base + "?i=" + integration)
          .digest("base64");
        headers = { "x-trello-webhook": sig };
      } else if (provider === "clickup") {
        body = {
          webhook_id: "wh",
          event: "taskStatusUpdated",
          task_id: external,
          history_items: [
            { id: randomUUID(), field: "status", after: { status: "complete", type: "closed" } },
          ],
        };
        headers = { "x-signature": createHmac("sha256", secret).update(JSON.stringify(body)).digest("hex") };
      } else if (provider === "asana") {
        body = {
          events: [
            {
              action: "changed",
              resource: { gid: external, resource_type: "task" },
              change: { field: "completed", action: "changed" },
              user: randomUUID(),
            },
          ],
        };
        headers = {
          "x-hook-signature": createHmac("sha256", secret).update(JSON.stringify(body)).digest("hex"),
        };
      } else {
        body = {
          id: randomUUID(),
          type: "page.properties_updated",
          entity: { id: external, type: "page" },
          data: { parent: { id: BOARD_REPO.notion, type: "database" } },
        };
        headers = {
          "x-notion-signature":
            "sha256=" + createHmac("sha256", secret).update(JSON.stringify(body)).digest("hex"),
        };
      }
      return request({
        method: "POST",
        path: "/api/integrations/" + provider + "/webhook?i=" + integration,
        headers: { ...headers, "content-type": "application/json" },
        body,
      });
    };
    const mine = ids["integration_" + provider + "_A"] ?? "";
    const theirs = ids["integration_" + provider + "_B"] ?? "";
    const secret = ids["secret_" + provider + "_A"] ?? "";
    // No integration has this id; a bad secret; and workspace A's secret against workspace B's integration.
    expect((await send(randomUUID(), secret)).status).toBe(401);
    expect((await send(mine, "not-a-secret")).status).toBe(401);
    expect((await send(theirs, secret)).status).toBe(401);
    expect(await snapshot()).toBe(before);
    // The handshake is only taken while the integration is waiting for it.
    if (provider === "notion" || provider === "asana") {
      const hello = await request({
        method: "POST",
        path: "/api/integrations/" + provider + "/webhook?i=" + mine,
        headers: provider === "asana" ? { "x-hook-secret": "attacker-chosen-secret" } : {},
        body: provider === "notion" ? { verification_token: "attacker-chosen-secret" } : {},
      });
      expect(hello.status).toBe(401);
      expect(
        await db()`select count(*)::int as n from issue_integration where id=${mine} and webhook_pending`,
      ).toMatchObject([{ n: 0 }]);
    }
    // Workspace A's own integration resolves A's linked item, once; B's is untouched.
    const response = await send(mine, secret);
    expect(response.status).toBe(200);
    expect(
      await db()`select status from feedback where id=${ids["item_" + provider + "_A"] ?? ""}`,
    ).toMatchObject([{ status: "resolved" }]);
    expect(await snapshot()).toBe(before);
  },
});

/**
 * Dodo billing webhook: the capability is the signing key. A forged or unsigned delivery naming
 * workspace B changes nothing; a correctly signed one for A changes only A, once.
 */
const billingWebhookCase = (): Spec => ({
  status: [200, 401],
  run: async (ids, { request, db, snapshot }) => {
    const { createHmac } = await import("node:crypto");
    const before = await snapshot();
    const send = (org: string, id: string, key = WEBHOOK_KEY, type = "subscription.active") => {
      const raw = JSON.stringify({
        type,
        timestamp: new Date().toISOString(),
        data: {
          subscription_id: `sub_${org}`,
          status: "active",
          product_id: "prod_monthly_fixture",
          customer: { customer_id: `cus_${org}` },
          metadata: { pinwren_org_id: org },
        },
      });
      const ts = String(Math.floor(Date.now() / 1000));
      const sig = createHmac("sha256", Buffer.from(key.slice(6), "base64"))
        .update(`${id}.${ts}.${raw}`)
        .digest("base64");
      return request({
        method: "POST",
        path: "/api/billing/webhook",
        headers: { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` },
        body: JSON.parse(raw) as unknown,
      });
    };
    const other = `whsec_${Buffer.from("not-the-endpoint-key-000000000000").toString("base64")}`;
    expect((await send(ids.orgB ?? "", "msg_forged", other)).status).toBe(401);
    expect((await request({ method: "POST", path: "/api/billing/webhook", body: {} })).status).toBe(400);
    expect(await snapshot()).toBe(before);
    const first = await send(ids.orgA ?? "", "msg_a_1");
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ result: "applied" });
    expect(
      await db()`select plan, status from billing_subscription where org_id=${ids.orgA ?? ""}`,
    ).toMatchObject([{ plan: "pro", status: "active" }]);
    // A redelivery of the same webhook-id is acknowledged and applied once.
    expect(
      await (await send(ids.orgA ?? "", "msg_a_1", WEBHOOK_KEY, "subscription.cancelled")).json(),
    ).toMatchObject({
      result: "duplicate",
    });
    expect(await db()`select status from billing_subscription where org_id=${ids.orgA ?? ""}`).toMatchObject([
      { status: "active" },
    ]);
    expect(await db()`select count(*)::int as n from billing_event where org_id=${ids.orgA ?? ""}`).toEqual([
      { n: 1 },
    ]);
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
  // Share links: workspace A's project key with workspace B's link token must find nothing.
  "GET /api/share/:key": {
    status: [404],
    request: (ids) => ({
      method: "GET",
      path: `/api/share/${ids.keyA ?? ""}`,
      headers: shareHeaders(ids.shareB),
    }),
  },
  "POST /api/share/:key/unlock": {
    status: [404],
    request: (ids) => ({
      method: "POST",
      path: `/api/share/${ids.keyA ?? ""}/unlock`,
      headers: shareHeaders(ids.shareB),
      body: { password: "guess" },
    }),
  },
  "GET /api/share/:key/assets/:id": {
    status: [404],
    request: (ids) => ({
      method: "GET",
      path: `/api/share/${ids.keyA ?? ""}/assets/${ids.assetB ?? ""}`,
      headers: shareHeaders(ids.shareA),
    }),
  },
  "POST /api/share/:key/comments": {
    status: [404],
    request: (ids) => ({
      method: "POST",
      path: `/api/share/${ids.keyA ?? ""}/comments`,
      headers: shareHeaders(ids.shareB),
      body: { body: "foreign comment", name: "Eve" },
    }),
  },
  "POST /api/share/:key/signoff": {
    status: [404],
    request: (ids) => ({
      method: "POST",
      path: `/api/share/${ids.keyA ?? ""}/signoff`,
      headers: shareHeaders(ids.shareB),
      body: { decision: "approved", name: "Eve", email: "eve@test.invalid" },
    }),
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
  "POST /api/billing/webhook": billingWebhookCase(),
  "POST /api/integrations/github/webhook": webhookCase("github"),
  "POST /api/integrations/gitlab/webhook": webhookCase("gitlab"),
  "POST /api/integrations/jira/webhook": webhookCase("jira"),
  "POST /api/integrations/linear/webhook": webhookCase("linear"),
  "POST /api/integrations/trello/webhook": boardWebhookCase("trello"),
  "POST /api/integrations/asana/webhook": boardWebhookCase("asana"),
  "POST /api/integrations/clickup/webhook": boardWebhookCase("clickup"),
  "POST /api/integrations/notion/webhook": boardWebhookCase("notion"),
  "GET /api/integrations/trello/webhook": {
    // Trello probes the URL with HEAD when a webhook is created: it answers, and says nothing about anyone.
    status: [200],
    request: () => ({ method: "GET", path: "/api/integrations/trello/webhook" }),
  },
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
      vi.stubEnv("DODO_PAYMENTS_WEBHOOK_KEY", WEBHOOK_KEY);
      vi.stubEnv("DODO_PRO_MONTHLY_PRODUCT_ID", "prod_monthly_fixture");
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
          share = `pws_${randomUUID().replaceAll("-", "")}`,
          asset = randomUUID();
        await database`insert into organization (id,name,slug) values (${org ?? ""},${org ?? ""},${org ?? ""})`;
        await database`insert into project (id,org_id,name,slug,public_key,allowed_origins,public_read,identity_secret,action_secret,notify_emails,feedback_counter) values (${projectId},${org ?? ""},${org ?? ""},${org ?? ""},${key},${database.array([origin])},true,${randomUUID()},${randomUUID()},${database.array(["reporter@test.invalid"])},1)`;
        await database`insert into feedback (id,org_id,project_id,number,kind,body,client_id,reporter_token_hash,reporter_guest) values (${item},${org ?? ""},${projectId},1,'bug',${`public ${mark}`},${randomUUID()},${sha256Hex(reporter)},${database.json({ name: "Reporter", email: `private-${mark}@test.invalid` })})`;
        await database`insert into comment (org_id,feedback_id,body,visibility) values (${org ?? ""},${item},${`INTERNAL ${mark}`},'internal'),(${org ?? ""},${item},${`PUBLIC ${mark}`},'public')`;
        await database`insert into review_link (org_id,project_id,label,token_hash) values (${org ?? ""},${projectId},'fixture',${sha256Hex(review)})`;
        await database`insert into share_link (org_id,project_id,feedback_id,label,token_hash,expires_at) values (${org ?? ""},${projectId},${item},'fixture',${sha256Hex(share)},now() + interval '1 day')`;
        await database`insert into feedback_asset (id,org_id,feedback_id,kind,storage_key,content_type,bytes) values (${asset},${org ?? ""},${item},'screenshot',${`${org ?? ""}/${asset}.png`},'image/png',1)`;
        Object.assign(ids, {
          [`project${side}`]: projectId,
          [`item${side}`]: item,
          [`key${side}`]: key,
          [`reporter${side}`]: reporter,
          [`review${side}`]: review,
          [`share${side}`]: share,
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
        // The board trackers: same repository / tracker id in both workspaces, own integration id and secret.
        for (const provider of BOARD_PROVIDERS) {
          const secret = randomUUID(),
            integration = randomUUID(),
            linked = randomUUID();
          await database`insert into feedback (id,org_id,project_id,number,kind,body,client_id) values (${linked},${org ?? ""},${projectId},${6 + BOARD_PROVIDERS.indexOf(provider)},'bug',${`linked ${provider} ${mark}`},${randomUUID()})`;
          await database`insert into issue_integration (id,org_id,project_id,provider,token,token_hint,repo,webhook_secret,settings) values (${integration},${org ?? ""},${projectId},${provider},${encryptSecret(randomUUID())},'test',${BOARD_REPO[provider]},${encryptSecret(secret)},${database.json({ listId: "l1", doneListId: "done", statusProperty: "Status" })})`;
          await database`insert into issue_link (org_id,feedback_id,integration_id,provider,number,external_id,url,state) values (${org ?? ""},${linked},${integration},${provider},null,${"ext-" + provider},'https://example.test/1','open')`;
          Object.assign(ids, {
            [`secret_${provider}_${side}`]: secret,
            [`item_${provider}_${side}`]: linked,
            [`integration_${provider}_${side}`]: integration,
          });
        }
        await database`update project set feedback_counter=9 where id=${projectId}`;
      }
      api = (await import("./index")).app;
    }, 120_000);
    beforeEach(() => {
      effects.enqueue.mockReset().mockResolvedValue(undefined);
      effects.publish.mockReset().mockResolvedValue(undefined);
      effects.put.mockReset().mockResolvedValue(undefined);
      effects.remove.mockReset().mockResolvedValue(undefined);
      effects.get.mockReset().mockResolvedValue(null);
      // Asana reports a completed task, Notion a page whose status is Done.
      effects.fetch
        .mockReset()
        .mockImplementation((url) =>
          Promise.resolve(
            new Response(
              JSON.stringify(
                url.includes("asana.com")
                  ? { data: { completed: true } }
                  : { properties: { Status: { type: "status", status: { name: "Done" } } } },
              ),
              { status: 200 },
            ),
          ),
        );
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

    it.each([
      ["asana", "x-hook-secret", {}],
      ["notion", "", { verification_token: "secret_handshake_token_1" }],
    ] as const)(
      "takes the %s handshake secret once, while the integration is waiting for it",
      async (provider, header, body) => {
        const { encryptSecret } = await import("./crypto");
        const id = ids[`integration_${provider}_A`] ?? "";
        const original = ids[`secret_${provider}_A`] ?? "";
        const token = provider === "asana" ? "asana-handshake-secret-1" : body.verification_token;
        const post = (secret: string) =>
          request({
            method: "POST",
            path: `/api/integrations/${provider}/webhook?i=${id}`,
            headers: provider === "asana" ? { [header]: secret } : {},
            body: provider === "asana" ? {} : { verification_token: secret },
          });
        try {
          await db()`update issue_integration set webhook_pending=true where id=${id}`;
          const first = await post(token);
          expect(first.status).toBe(200);
          if (provider === "asana") expect(first.headers.get("x-hook-secret")).toBe(token);
          // First write wins: the integration is no longer waiting, so a second token is refused.
          expect((await post("attacker-chosen-secret-2")).status).toBe(401);
          const [row] = await db()<{ secret: string; pending: boolean }[]>`
            select webhook_secret as secret, webhook_pending as pending from issue_integration where id=${id}`;
          expect(row?.pending).toBe(false);
          const { decryptSecret } = await import("./crypto");
          expect(decryptSecret(row?.secret ?? "")).toBe(token);
        } finally {
          await db()`update issue_integration set webhook_pending=false, webhook_secret=${encryptSecret(original)} where id=${id}`;
        }
      },
    );

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
