import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { createCloudFixture } from "./test-helpers/cloud-fixture";
import { closeIdentityDatabase } from "../../db/src/identity";
import { membershipFor, firstOrganizationFor, accountProfileFor, tokenForVerification } from "./db/identity";

describe.skipIf(!process.env.PINWREN_ISOLATION_ADMIN_URL)(
  "Cloud identity and authentication projections",
  () => {
    let fixture: Awaited<ReturnType<typeof createCloudFixture>> | undefined;
    let runtime: postgres.Sql | undefined, service: postgres.Sql | undefined;
    const suffix = randomUUID();
    const orgA = `identity-a-${suffix}`,
      orgB = `identity-b-${suffix}`;
    const userA = `user-a-${suffix}`,
      userB = `user-b-${suffix}`;
    const prefixA = randomUUID(),
      prefixB = randomUUID();
    const client = (kind: "runtime" | "service") => {
      const db = kind === "runtime" ? runtime : service;
      if (!db) throw new Error("Cloud identity fixture is not ready");
      return db;
    };
    async function scoped<T>(org: string, run: (db: postgres.TransactionSql) => Promise<T>) {
      return client("runtime").begin(async (db) => {
        await db`select set_config('pinwren.org_id',${org},true)`;
        return run(db);
      });
    }
    beforeAll(async () => {
      fixture = await createCloudFixture();
      vi.stubEnv("PINWREN_MODE", "cloud");
      vi.stubEnv("DATABASE_URL", fixture.runtimeUrl);
      vi.stubEnv("PINWREN_SERVICE_DATABASE_URL", fixture.serviceUrl);
      runtime = postgres(fixture.runtimeUrl, { max: 1 });
      service = postgres(fixture.serviceUrl, { max: 1 });
      for (const [org, user] of [
        [orgA, userA],
        [orgB, userB],
      ] as const) {
        await fixture.db`insert into organization (id,name,slug) values (${org},${org},${org})`;
        await fixture.db`insert into "user" (id,name,email) values (${user},${user},${`${user}@test.invalid`})`;
        await fixture.db`insert into member (id,organization_id,user_id,role) values (${randomUUID()},${org},${user},'owner')`;
        await fixture.db`insert into invitation (id,organization_id,email,expires_at,inviter_id) values (${randomUUID()},${org},${`invite-${user}@test.invalid`},now()+interval '1 day',${user})`;
        await fixture.db`insert into api_token (org_id,user_id,name,prefix,hash) values (${org},${user},'fixture',${org === orgA ? prefixA : prefixB},${randomUUID()})`;
      }
    });
    afterAll(async () => {
      if (fixture) await closeIdentityDatabase();
      await runtime?.end();
      await service?.end();
      await fixture?.dispose();
      vi.unstubAllEnvs();
    });

    it.each(["organization", "member", "invitation"])(
      "isolates unfiltered tenant reads on %s while preserving global authentication access",
      async (table) => {
        const own = await scoped(orgA, async (db) => db`select * from ${db(table)}`);
        expect(own).toHaveLength(1);
        expect(JSON.stringify(own)).not.toContain(orgB);
        expect(await client("runtime")`select * from ${client("runtime")(table)}`).toHaveLength(0);
        expect(await client("service")`select * from ${client("service")(table)}`).toHaveLength(2);
      },
    );

    it("permits own membership updates and rejects moving a membership to another organization", async () => {
      expect(
        await scoped(
          orgA,
          async (db) => db`update member set role='admin' where user_id=${userA} returning role`,
        ),
      ).toMatchObject([{ role: "admin" }]);
      await expect(
        scoped(orgA, async (db) => db`update member set organization_id=${orgB} where user_id=${userA}`),
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("exposes only participating users' display columns to tenant queries", async () => {
      expect(await scoped(orgA, async (db) => db`select id,name,email,image from "user"`)).toMatchObject([
        { id: userA },
      ]);
      expect(await client("runtime")`select id,name from "user"`).toHaveLength(0);
      await expect(scoped(orgA, async (db) => db`select email_verified from "user"`)).rejects.toMatchObject({
        code: "42501",
      });
      expect(await client("service")`select email_verified,two_factor_enabled from "user"`).toHaveLength(2);
    });

    it("permits only the fixed token-verification projection before tenant context exists", async () => {
      const rows = await client(
        "service",
      )`select id,org_id,user_id,prefix,hash,scopes,expires_at,last_used_at from api_token`;
      expect(rows).toHaveLength(2);
      await expect(client("service")`select name from api_token`).rejects.toMatchObject({ code: "42501" });
      await expect(client("service")`select body from feedback`).rejects.toMatchObject({ code: "42501" });
    });

    it("resolves fixed authentication projections before tenant context without granting tenant content access", async () => {
      expect(await membershipFor(orgA, userA)).toMatchObject({ organizationId: orgA, userId: userA });
      expect(await membershipFor(orgA, userB)).toBeUndefined();
      expect(await firstOrganizationFor(userA)).toBe(orgA);
      expect(await accountProfileFor(userA)).toMatchObject({
        id: userA,
        emailVerified: false,
        twoFactorEnabled: false,
      });
      const token = await tokenForVerification(prefixA);
      expect(token).toMatchObject({ orgId: orgA, userId: userA, prefix: prefixA });
      expect(token).not.toHaveProperty("name");
      expect(token).not.toHaveProperty("createdAt");
    });

    it("publishes committed realtime messages outside a tenant transaction", async () => {
      vi.stubEnv("PINWREN_URL", "http://localhost:3100");
      vi.stubEnv("PINWREN_SECRET", randomUUID() + randomUUID());
      const received = vi.fn();
      const listener = await client("service").listen("pinwren_events", received);
      try {
        const { publish } = await import("./realtime/bus");
        await publish({
          t: "e",
          orgId: orgA,
          projectId: randomUUID(),
          event: "feedback.updated",
          data: { id: randomUUID() },
        });
        await vi.waitFor(() => expect(received).toHaveBeenCalled());
      } finally {
        await listener.unlisten();
      }
    });

    it("preserves the display identity of a contributor linked to the organization's content", async () => {
      if (!fixture) throw new Error("Fixture not ready");
      const projectId = randomUUID(),
        feedbackId = randomUUID();
      await fixture.db`insert into project (id,org_id,name,slug,public_key) values (${projectId},${orgA},'identity','identity',${projectId})`;
      await fixture.db`insert into feedback (id,org_id,project_id,number,kind,body,client_id,reporter_id) values (${feedbackId},${orgA},${projectId},1,'bug','identity fixture',${randomUUID()},${userB})`;
      const rows = await scoped(orgA, async (db) => db`select id,name from "user" where id=${userB}`);
      expect(rows).toMatchObject([{ id: userB }]);
    });
  },
);
