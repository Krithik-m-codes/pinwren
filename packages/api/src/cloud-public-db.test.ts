import type * as ApiModule from "./index";
import type * as BossModule from "./jobs/boss";
import type * as BusModule from "./realtime/bus";
import type * as StorageModule from "./storage";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { currentOrgId } from "../../db/src";
import { getRuntimeDb } from "../../db/src/connection";
import { closeIdentityDatabase } from "../../db/src/identity";
import { createCloudFixture } from "./test-helpers/cloud-fixture";

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

describe.skipIf(!process.env.PINWREN_ISOLATION_ADMIN_URL)("Cloud public capability HTTP isolation", () => {
  let fixture: Awaited<ReturnType<typeof createCloudFixture>> | undefined;
  let api: typeof ApiModule.app;
  const suffix = randomUUID(),
    orgA = `public-a-${suffix}`,
    orgB = `public-b-${suffix}`;
  const projectA = randomUUID(),
    projectB = randomUUID(),
    itemA = randomUUID(),
    itemB = randomUUID(),
    assetA = randomUUID(),
    assetB = randomUUID(),
    brandA = randomUUID();
  const keyA = `pk_${randomUUID()}`,
    keyB = `pk_${randomUUID()}`,
    reporterA = randomUUID().replaceAll("-", ""),
    reporterB = randomUUID().replaceAll("-", "");
  const reviewA = `pwr_${randomUUID()}`,
    reviewB = `pwr_${randomUUID()}`,
    reviewExpired = `pwr_${randomUUID()}`,
    reviewRevoked = `pwr_${randomUUID()}`;
  const origin = "https://customer.test",
    secretA = randomUUID(),
    secretB = randomUUID(),
    integrationA = randomUUID(),
    integrationB = randomUUID();
  const ioContexts: (string | undefined)[] = [];
  const db = () => {
    if (!fixture) throw new Error("Public fixture is not ready");
    return fixture.db;
  };
  function request(
    path: string,
    options: {
      method?: string;
      key?: string;
      origin?: string;
      headers?: Record<string, string>;
      body?: unknown;
    } = {},
  ) {
    const headers = new Headers({ "content-type": "application/json", ...options.headers });
    if (options.body !== undefined)
      headers.set("content-length", String(Buffer.byteLength(JSON.stringify(options.body))));
    if (options.key) headers.set("x-pinwren-key", options.key);
    if (options.origin !== undefined) headers.set("origin", options.origin);
    return api.request(`http://localhost:3100${path}`, {
      method: options.method ?? "GET",
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  }
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
    for (const [org, projectId, key, item, reporter, integration, secret] of [
      [orgA, projectA, keyA, itemA, reporterA, integrationA, secretA],
      [orgB, projectB, keyB, itemB, reporterB, integrationB, secretB],
    ] as const) {
      await db()`insert into organization (id,name,slug) values (${org},${org},${org})`;
      await db()`insert into project (id,org_id,name,slug,public_key,allowed_origins,public_read,identity_secret,action_secret,notify_emails) values (${projectId},${org},${org},${org},${key},${db().array([origin])},true,${randomUUID()},${randomUUID()},${db().array(["reporter@test.invalid"])})`;
      await db()`insert into feedback (id,org_id,project_id,number,kind,body,client_id,reporter_token_hash,reporter_guest) values (${item},${org},${projectId},1,'bug',${`public ${org}`},${randomUUID()},${sha256Hex(reporter)},${db().json({ name: "Reporter", email: `private-${org}@test.invalid` })})`;
      await db()`insert into comment (org_id,feedback_id,body,visibility) values (${org},${item},${`INTERNAL ${org}`},'internal'),(${org},${item},${`PUBLIC ${org}`},'public')`;
      await db()`insert into issue_integration (id,org_id,project_id,provider,token,token_hint,repo,webhook_secret) values (${integration},${org},${projectId},'github',${encryptSecret(randomUUID())},'test','fixture/shared',${encryptSecret(secret)})`;
      await db()`insert into issue_link (org_id,feedback_id,integration_id,provider,number,url,state) values (${org},${item},${integration},'github',1,'https://example.test/1','open')`;
    }
    for (const [org, projectId, token, expired, revoked] of [
      [orgA, projectA, reviewA, false, false],
      [orgB, projectB, reviewB, false, false],
      [orgA, projectA, reviewExpired, true, false],
      [orgA, projectA, reviewRevoked, false, true],
    ] as const) {
      await db()`insert into review_link (org_id,project_id,label,token_hash,expires_at,revoked_at) values (${org},${projectId},'fixture',${sha256Hex(token)},${expired ? new Date(0) : null},${revoked ? new Date() : null})`;
    }
    for (const [asset, org, item] of [
      [assetA, orgA, itemA],
      [assetB, orgB, itemB],
    ] as const)
      await db()`insert into feedback_asset (id,org_id,feedback_id,kind,storage_key,content_type,bytes) values (${asset},${org},${item},'screenshot',${`${org}/${asset}.png`},'image/png',1)`;
    await db()`insert into brand_asset (id,org_id,storage_key,content_type,bytes) values (${brandA},${orgA},${`branding/${brandA}.png`},'image/png',1)`;
    await db()`update project set feedback_counter=1 where id in (${projectA},${projectB})`;
    api = (await import("./index")).app;
  }, 120_000);
  beforeEach(() => {
    effects.enqueue.mockReset().mockResolvedValue(undefined);
    effects.publish.mockReset().mockResolvedValue(undefined);
    ioContexts.length = 0;
    effects.put.mockReset().mockImplementation(() => {
      ioContexts.push(currentOrgId());
      return Promise.resolve();
    });
    effects.remove.mockReset().mockImplementation(() => {
      ioContexts.push(currentOrgId());
      return Promise.resolve();
    });
    effects.get.mockReset().mockImplementation(() => {
      ioContexts.push(currentOrgId());
      return Promise.resolve({
        body: new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("fixture image"));
            c.close();
          },
        }),
        bytes: 13,
      });
    });
  });
  afterAll(async () => {
    if (fixture) {
      await closeIdentityDatabase();
      await getRuntimeDb().$client.end();
      await fixture.dispose();
    }
    vi.unstubAllEnvs();
  });

  it("serves widget config and public pins only for the key's organization", async () => {
    const response = await request("/w/config", { key: keyA, origin });
    expect(response.status).toBe(200);
    const config = await response.text();
    expect(config).not.toMatch(/identitySecret|actionSecret|tokenHash|private-/);
    const pins = await request("/w/feedback", { key: keyA, origin });
    expect(pins.status).toBe(200);
    const text = await pins.text();
    expect(text).toContain(itemA);
    expect(text).not.toContain(itemB);
    expect(text).not.toContain("private-");
  });
  it("rejects wrong Origin before serving or writing tenant content", async () => {
    expect((await request("/w/config", { key: keyA, origin: "https://foreign.test" })).status).toBe(403);
    expect(effects.enqueue).not.toHaveBeenCalled();
  });
  it("keeps a signed foreign item capability out of another project's widget", async () => {
    const { pageLinkToken } = await import("./services/page-link");
    const own = await request(`/w/feedback/${itemA}`, {
      key: keyA,
      origin,
      headers: { "x-pinwren-link-token": pageLinkToken(itemA).token },
    });
    expect(own.status).toBe(200);
    const text = await own.text();
    expect(text).toContain(`PUBLIC ${orgA}`);
    expect(text).not.toContain("INTERNAL");
    expect(
      (
        await request(`/w/feedback/${itemB}`, {
          key: keyA,
          origin,
          headers: { "x-pinwren-link-token": pageLinkToken(itemB).token },
        })
      ).status,
    ).toBe(404);
  });
  it("restricts reporter and page capabilities to their project and public replies", async () => {
    const response = await request(`/api/guest/${keyA}/feedback/${itemA}`, {
      headers: { "x-pinwren-reporter-tokens": reporterA },
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain(`PUBLIC ${orgA}`);
    expect(text).not.toMatch(/INTERNAL|private-|tokenHash/);
    expect(
      (
        await request(`/api/guest/${keyA}/feedback/${itemB}`, {
          headers: { "x-pinwren-reporter-tokens": reporterB },
        })
      ).status,
    ).toBe(404);
  });
  it("rejects expired or forged signed guest tokens and revoked reporter tokens", async () => {
    const { pageLinkToken } = await import("./services/page-link");
    for (const token of [pageLinkToken(itemA, { ttlMs: -1000 }).token, "Zm9yZ2Vk.Zm9yZ2Vk"])
      expect(
        (await request(`/api/guest/${keyA}/feedback`, { headers: { "x-pinwren-link-tokens": token } }))
          .status,
      ).toBe(401);
    await db()`update feedback set reporter_token_hash=null where id=${itemA}`;
    try {
      const r = await request(`/api/guest/${keyA}/feedback`, {
        headers: { "x-pinwren-reporter-tokens": reporterA },
      });
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ items: [] });
    } finally {
      const { sha256Hex } = await import("./crypto");
      await db()`update feedback set reporter_token_hash=${sha256Hex(reporterA)} where id=${itemA}`;
    }
  });
  it("validates review token project, expiration and revocation", async () => {
    expect(
      (await request("/w/review-link", { key: keyA, origin, headers: { "x-pinwren-review-token": reviewA } }))
        .status,
    ).toBe(200);
    for (const token of [reviewB, reviewExpired, reviewRevoked, "pwr_forged1234567890"])
      expect(
        (await request("/w/review-link", { key: keyA, origin, headers: { "x-pinwren-review-token": token } }))
          .status,
      ).toBe(404);
  });
  it("uses signed unsubscribe claims without accepting a caller-selected organization", async () => {
    const { unsubscribeToken } = await import("./email/unsubscribe");
    const token = unsubscribeToken(orgA, "reporter@test.invalid");
    expect(
      (await request(`/api/unsubscribe?token=${encodeURIComponent(token)}&orgId=${orgB}`, { method: "POST" }))
        .status,
    ).toBe(200);
    expect(await db()`select org_id from email_suppression`).toMatchObject([{ org_id: orgA }]);
    const [part, mac] = token.split(".");
    if (!part || !mac) throw new Error("Expected a complete minted token");
    const forged =
      Buffer.from(
        JSON.stringify({
          ...(JSON.parse(Buffer.from(part, "base64url").toString()) as object),
          o: orgB,
        }),
      ).toString("base64url") +
      "." +
      mac;
    expect(
      (await request(`/api/unsubscribe?token=${encodeURIComponent(forged)}`, { method: "POST" })).status,
    ).toBe(400);
    expect(await db()`select org_id from email_suppression where org_id=${orgB}`).toHaveLength(0);
  });
  it("applies team unsubscribe only to its signed project", async () => {
    const { teamUnsubscribeToken } = await import("./email/links");
    const token = teamUnsubscribeToken({
      kind: "address",
      projectId: projectA,
      email: "reporter@test.invalid",
    });
    expect(
      (await request(`/api/unsubscribe/team?token=${encodeURIComponent(token)}`, { method: "POST" })).status,
    ).toBe(200);
    expect(await db()`select notify_emails from project where id=${projectA}`).toMatchObject([
      { notify_emails: [] },
    ]);
    expect(await db()`select notify_emails from project where id=${projectB}`).toMatchObject([
      { notify_emails: ["reporter@test.invalid"] },
    ]);
  });
  it("streams only a signed image capability or public brand asset outside the transaction", async () => {
    const { emailImageToken } = await import("./email/links");
    for (const path of [`/api/email-assets/${emailImageToken(assetA)}`, `/api/brand-assets/${brandA}`]) {
      const response = await request(path);
      expect(response.status).toBe(200);
      await response.text();
    }
    expect(ioContexts).toEqual([undefined, undefined]);
    expect((await request(`/api/email-assets/${emailImageToken(assetB, 0)}`)).status).toBe(404);
  });
  it("returns established misses for malformed public identifiers", async () => {
    expect((await request("/api/brand-assets/not-a-uuid")).status).toBe(404);
    expect(
      (
        await request(`/api/guest/${keyA}/feedback/not-a-uuid`, {
          headers: { "x-pinwren-reporter-tokens": reporterA },
        })
      ).status,
    ).toBe(404);
  });
  it("verifies inbound signatures before changing only the matching tenant's issue", async () => {
    const body = { action: "closed", repository: { full_name: "fixture/shared" }, issue: { number: 1 } };
    const { hmacSha256Hex } = await import("./crypto");
    const response = await request("/api/integrations/github/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": `sha256=${hmacSha256Hex(secretA, JSON.stringify(body))}`,
        "x-github-event": "issues",
        "x-github-delivery": randomUUID(),
      },
      body,
    });
    expect(response.status).toBe(200);
    expect(await db()`select status from feedback where id=${itemA}`).toMatchObject([{ status: "resolved" }]);
    expect(await db()`select status from feedback where id=${itemB}`).toMatchObject([{ status: "open" }]);
    expect(
      (
        await request("/api/integrations/github/webhook", {
          method: "POST",
          headers: { "x-hub-signature-256": `sha256=${"0".repeat(64)}`, "x-github-event": "issues" },
          body,
        })
      ).status,
    ).toBe(401);
  });
  const report = () => ({
    clientId: randomUUID(),
    kind: "bug",
    body: "widget write",
    page: { url: origin + "/page" },
    environment: { userAgent: "fixture", viewport: { w: 100, h: 100 }, dpr: 1 },
  });
  it("stores a report and screenshot without holding a tenant transaction during upload", async () => {
    const response = await request("/w/feedback", {
      method: "POST",
      key: keyA,
      origin,
      body: {
        ...report(),
        orgId: orgB,
        projectId: projectB,
        screenshot:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jHnQAAAAASUVORK5CYII=",
      },
    });
    expect(response.status).toBe(201);
    expect(ioContexts).toEqual([undefined]);
    const body = (await response.json()) as { feedback: { id: string } };
    expect(await db()`select org_id from feedback_asset where feedback_id=${body.feedback.id}`).toMatchObject(
      [{ org_id: orgA }],
    );
  });
  it("inserts parent-derived diagnostics under runtime RLS in the same successful report transaction", async () => {
    const response = await request("/w/feedback", {
      method: "POST",
      key: keyA,
      origin,
      body: { ...report(), diagnostics: { console: [{ level: "error", message: "fixture error", at: 1 }] } },
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { feedback: { id: string } };
    expect(
      await db()`select feedback_id from diagnostics where feedback_id=${body.feedback.id}`,
    ).toHaveLength(1);
  });
  it("leaves no writes, uploads or success events after rejecting a report capability", async () => {
    const input = report();
    expect(
      (
        await request("/w/feedback", {
          method: "POST",
          key: keyA,
          origin: "https://foreign.test",
          body: input,
        })
      ).status,
    ).toBe(403);
    expect(await db()`select id from feedback where client_id=${input.clientId}`).toHaveLength(0);
    expect(effects.put).not.toHaveBeenCalled();
    expect(effects.enqueue).not.toHaveBeenCalled();
  });
  it("rechecks a project key rotated between bootstrap and content access", async () => {
    const bootstrap = await import("./db/bootstrap");
    const original = bootstrap.projectForPublicKey;
    const spy = vi.spyOn(bootstrap, "projectForPublicKey").mockImplementationOnce(async (key) => {
      const row = await original(key);
      await db()`update project set public_key=${`pk_${randomUUID()}`} where id=${projectA}`;
      return row;
    });
    try {
      expect((await request("/w/config", { key: keyA, origin })).status).toBe(401);
    } finally {
      spy.mockRestore();
      await db()`update project set public_key=${keyA} where id=${projectA}`;
    }
  });
  it("rechecks image ownership visibility when a report is trashed after bootstrap", async () => {
    const bootstrap = await import("./db/bootstrap");
    const original = bootstrap.imageAssetOwner;
    const spy = vi.spyOn(bootstrap, "imageAssetOwner").mockImplementationOnce(async (id) => {
      const row = await original(id);
      await db()`update feedback set deleted_at=now() where id=${itemA}`;
      return row;
    });
    try {
      const { emailImageToken } = await import("./email/links");
      expect((await request(`/api/email-assets/${emailImageToken(assetA)}`)).status).toBe(404);
      expect(effects.get).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      await db()`update feedback set deleted_at=null where id=${itemA}`;
    }
  });
  it("rechecks integration revocation after signature bootstrap and emits nothing", async () => {
    const bootstrap = await import("./db/bootstrap");
    const original = bootstrap.integrationSignatureCandidates;
    const spy = vi
      .spyOn(bootstrap, "integrationSignatureCandidates")
      .mockImplementationOnce(async (provider, repo) => {
        const rows = await original(provider, repo);
        await db()`update issue_integration set active=false where id=${integrationA}`;
        return rows;
      });
    try {
      const { hmacSha256Hex } = await import("./crypto");
      const body = { action: "reopened", repository: { full_name: "fixture/shared" }, issue: { number: 1 } };
      const response = await request("/api/integrations/github/webhook", {
        method: "POST",
        headers: {
          "x-hub-signature-256": `sha256=${hmacSha256Hex(secretA, JSON.stringify(body))}`,
          "x-github-event": "issues",
          "x-github-delivery": randomUUID(),
        },
        body,
      });
      expect(response.status).toBe(401);
      expect(effects.enqueue).not.toHaveBeenCalled();
      expect(await db()`select status from feedback where id=${itemA}`).toMatchObject([
        { status: "resolved" },
      ]);
    } finally {
      spy.mockRestore();
      await db()`update issue_integration set active=true where id=${integrationA}`;
    }
  });
  it("does not let a signed integration change another project within the same organization", async () => {
    const projectC = randomUUID(),
      itemC = randomUUID(),
      link = randomUUID();
    await db()`insert into project (id,org_id,name,slug,public_key) values (${projectC},${orgA},'other','other',${`pk_${randomUUID()}`})`;
    await db()`insert into feedback (id,org_id,project_id,number,kind,body,client_id) values (${itemC},${orgA},${projectC},1,'bug','other project',${randomUUID()})`;
    await db()`insert into issue_link (id,org_id,feedback_id,integration_id,provider,number,url,state) values (${link},${orgA},${itemC},${integrationA},'github',2,'https://example.test/2','open')`;
    const { hmacSha256Hex } = await import("./crypto");
    const body = { action: "closed", repository: { full_name: "fixture/shared" }, issue: { number: 2 } };
    const response = await request("/api/integrations/github/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": `sha256=${hmacSha256Hex(secretA, JSON.stringify(body))}`,
        "x-github-event": "issues",
        "x-github-delivery": randomUUID(),
      },
      body,
    });
    expect(response.status).toBe(200);
    expect(await db()`select status from feedback where id=${itemC}`).toMatchObject([{ status: "open" }]);
    expect(await db()`select state from issue_link where id=${link}`).toMatchObject([{ state: "open" }]);
    expect(effects.enqueue).not.toHaveBeenCalled();
  });
  it("grants only the bootstrap authority projection and no project configuration or integration access token", async () => {
    const { projectForPublicKey } = await import("./db/bootstrap");
    const row = await projectForPublicKey(keyA);
    expect(Object.keys(row ?? {}).sort()).toEqual(
      ["id", "orgId", "publicKey", "allowedOrigins", "archivedAt"].sort(),
    );
    const { identityDatabase } = await import("../../db/src/identity");
    for (const query of [
      "select widget_config from project",
      "select identity_secret from project",
      "select token from issue_integration",
      "select storage_key from feedback_asset",
      "select body from feedback",
    ])
      await expect(identityDatabase().$client.unsafe(query)).rejects.toMatchObject({ code: "42501" });
  });
  it("rolls back rejected report writes and removes uploads when its key is revoked during storage I/O", async () => {
    const input = {
      ...report(),
      page: { url: origin + "/upload-race-" + randomUUID() },
      screenshot:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jHnQAAAAASUVORK5CYII=",
    };
    effects.put.mockImplementationOnce(async () => {
      ioContexts.push(currentOrgId());
      await db()`update project set public_key=${`pk_${randomUUID()}`} where id=${projectA}`;
    });
    try {
      const response = await request("/w/feedback", { method: "POST", key: keyA, origin, body: input });
      expect(response.status).toBe(401);
      expect(await db()`select id from feedback where client_id=${input.clientId}`).toHaveLength(0);
      expect(
        await db()`select id from page where project_id=${projectA} and url=${input.page.url}`,
      ).toHaveLength(0);
      expect(effects.remove).toHaveBeenCalledOnce();
      expect(ioContexts).toEqual([undefined, undefined]);
      expect(effects.enqueue).not.toHaveBeenCalled();
    } finally {
      await db()`update project set public_key=${keyA} where id=${projectA}`;
    }
  });
  it("preserves idempotency when two report retries race through separate runtime transactions", async () => {
    const input = report();
    const responses = await Promise.all([
      request("/w/feedback", { method: "POST", key: keyA, origin, body: input }),
      request("/w/feedback", { method: "POST", key: keyA, origin, body: input }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    const bodies = await Promise.all(responses.map((r) => r.json() as Promise<{ feedback: { id: string } }>));
    expect(bodies[0]?.feedback.id).toBe(bodies[1]?.feedback.id);
    expect(await db()`select id from feedback where client_id=${input.clientId}`).toHaveLength(1);
    expect(effects.enqueue).toHaveBeenCalledOnce();
  });
  it("leaves no database rows when storing a screenshot fails", async () => {
    const input = {
      ...report(),
      page: { url: origin + "/failed-upload-" + randomUUID() },
      screenshot:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jHnQAAAAASUVORK5CYII=",
    };
    effects.put.mockRejectedValueOnce(new Error("Fixture storage unavailable"));
    expect((await request("/w/feedback", { method: "POST", key: keyA, origin, body: input })).status).toBe(
      500,
    );
    expect(await db()`select id from feedback where client_id=${input.clientId}`).toHaveLength(0);
    expect(
      await db()`select id from page where project_id=${projectA} and url=${input.page.url}`,
    ).toHaveLength(0);
    expect(effects.enqueue).not.toHaveBeenCalled();
  });
  it("rejects a signed image token tampered to name another project's asset", async () => {
    const { emailImageToken } = await import("./email/links");
    const [part, mac] = emailImageToken(assetA).split(".");
    if (!part || !mac) throw new Error("Expected a complete minted token");
    const original = JSON.parse(Buffer.from(part, "base64url").toString()) as Record<string, unknown>;
    const forged = Buffer.from(JSON.stringify({ ...original, a: assetB })).toString("base64url") + "." + mac;
    expect((await request(`/api/email-assets/${forged}`)).status).toBe(404);
    expect(effects.get).not.toHaveBeenCalled();
  });
  it("rolls back unsubscribe state when a later database step fails", async () => {
    if (!fixture) throw new Error("Fixture not ready");
    const client = db(),
      role = new URL(fixture.runtimeUrl).username;
    const email = `failed-${randomUUID()}@test.invalid`;
    const { unsubscribeToken } = await import("./email/unsubscribe");
    await client`revoke select on public.organization from ${client(role)}`;
    try {
      expect(
        (
          await request(`/api/unsubscribe?token=${encodeURIComponent(unsubscribeToken(orgA, email))}`, {
            method: "POST",
          })
        ).status,
      ).toBe(500);
      expect(
        await db()`select email from email_suppression where org_id=${orgA} and email=${email}`,
      ).toHaveLength(0);
    } finally {
      await client`grant select on public.organization to ${client(role)}`;
    }
  });
  it("keeps issue-link state current for a trashed report without changing its feedback or emitting events", async () => {
    await db()`update feedback set deleted_at=now() where id=${itemA}`;
    try {
      const { hmacSha256Hex } = await import("./crypto");
      const body = { action: "reopened", repository: { full_name: "fixture/shared" }, issue: { number: 1 } };
      const response = await request("/api/integrations/github/webhook", {
        method: "POST",
        headers: {
          "x-hub-signature-256": `sha256=${hmacSha256Hex(secretA, JSON.stringify(body))}`,
          "x-github-event": "issues",
          "x-github-delivery": randomUUID(),
        },
        body,
      });
      expect(response.status).toBe(200);
      expect(
        await db()`select state from issue_link where integration_id=${integrationA} and number=1`,
      ).toMatchObject([{ state: "open" }]);
      expect(await db()`select status from feedback where id=${itemA}`).toMatchObject([
        { status: "resolved" },
      ]);
      expect(effects.enqueue).not.toHaveBeenCalled();
    } finally {
      await db()`update feedback set deleted_at=null where id=${itemA}`;
      await db()`update issue_link set state='closed' where integration_id=${integrationA} and number=1`;
    }
  });
});
