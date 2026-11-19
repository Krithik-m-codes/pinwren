import type { PgBoss } from "pg-boss";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createCloudFixture } from "./test-helpers/cloud-fixture";

describe.skipIf(!process.env.PINWREN_ISOLATION_ADMIN_URL)("Cloud job queue roles", () => {
  let fixture: Awaited<ReturnType<typeof createCloudFixture>> | undefined;
  let boss: PgBoss | undefined;
  let runtime: postgres.Sql | undefined;
  beforeAll(async () => {
    fixture = await createCloudFixture();
    vi.stubEnv("PINWREN_MODE", "cloud");
    vi.stubEnv("DATABASE_URL", fixture.runtimeUrl);
    vi.stubEnv("PINWREN_SERVICE_DATABASE_URL", fixture.serviceUrl);
    vi.stubEnv("PINWREN_URL", "http://localhost:3100");
    vi.stubEnv("PINWREN_SECRET", "queue-integration-secret-0123456789abcdef");
    runtime = postgres(fixture.runtimeUrl, { max: 1 });
    const { provisionCloudJobQueues } = await import("./jobs/provision");
    await provisionCloudJobQueues(fixture.migrationUrl, fixture.runtimeUrl, fixture.serviceUrl);
  }, 120_000);
  afterAll(async () => {
    await boss?.stop({ graceful: false });
    await runtime?.end();
    if (fixture) {
      // Also clean a partially started pg-boss connection when reproducing the original startup failure.
      await fixture.db`select pg_terminate_backend(pid) from pg_stat_activity where datname=current_database() and application_name='pinwren-jobs' and pid<>pg_backend_pid()`;
      await fixture.dispose();
    }
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("starts and consumes a real job without giving the tenant role access to global queue payloads", async () => {
    if (!fixture || !runtime) throw new Error("Queue fixture is not ready");
    const { getBoss, QUEUES } = await import("./jobs/boss");
    boss = await getBoss();
    const id = await boss.send(QUEUES.dispatch, { orgId: "queue-org", feedbackId: "example" });
    expect(id).toBeTypeOf("string");
    const jobs = await boss.fetch<{ orgId: string }>(QUEUES.dispatch);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data.orgId).toBe("queue-org");
    if (!id) throw new Error("No queue job was created");
    await boss.complete(QUEUES.dispatch, id);
    await boss.schedule(QUEUES.retention, "15 3 * * *");
    await boss.supervise();
    await boss.resolveFlow();
    await vi.waitFor(async () => {
      if (!fixture) throw new Error("Queue fixture is not ready");
      const [clock] = await fixture.db`select cron_on from pgboss.version`;
      expect(clock?.cron_on).not.toBeNull();
    });
    await expect(runtime`select data from pgboss.job`).rejects.toMatchObject({ code: "42501" });
    const [privileges] =
      await runtime`select has_database_privilege(current_user,current_database(),'CREATE') creates_database, has_schema_privilege(current_user,'public','CREATE') creates_schema`;
    expect(privileges).toMatchObject({ creates_database: false, creates_schema: false });
  });
  it("does not grant the queue service migration or owner privileges", async () => {
    if (!fixture) throw new Error("Queue fixture is not ready");
    const service = postgres(fixture.serviceUrl, { max: 1 });
    try {
      const [privileges] =
        await service`select has_database_privilege(current_user,current_database(),'CREATE') creates_database, has_schema_privilege(current_user,'pgboss','CREATE') creates_schema`;
      expect(privileges).toMatchObject({ creates_database: false, creates_schema: false });
      await expect(service`delete from pgboss.bam`).rejects.toMatchObject({ code: "42501" });
      await expect(service`update pgboss.version set version=version`).rejects.toMatchObject({
        code: "42501",
      });
      const { assertCloudDatabaseSecurity } = await import("@pinwren/db/cloud-security");
      await expect(assertCloudDatabaseSecurity()).resolves.toBeUndefined();
    } finally {
      await service.end();
    }
  });
  it("can provision again without losing pending jobs or widening grants", async () => {
    if (!fixture || !boss) throw new Error("Queue fixture is not ready");
    const { QUEUES } = await import("./jobs/boss");
    const { provisionCloudJobQueues } = await import("./jobs/provision");
    const id = await boss.send(QUEUES.issues, { marker: "survives-provisioning" });
    await provisionCloudJobQueues(fixture.migrationUrl, fixture.runtimeUrl, fixture.serviceUrl);
    const jobs = await boss.fetch<{ marker: string }>(QUEUES.issues);
    expect(jobs.map((job) => job.id)).toContain(id);
    expect(jobs[0]?.data.marker).toBe("survives-provisioning");
  });
  it("runs the offline CLI with credentials confined to its child environment", () => {
    if (!fixture) throw new Error("Queue fixture is not ready");
    const require = createRequire(new URL("../../db/package.json", import.meta.url));
    const child = spawnSync(
      process.execPath,
      [require.resolve("tsx/cli"), fileURLToPath(new URL("./jobs/provision-cli.ts", import.meta.url))],
      {
        env: {
          ...process.env,
          PINWREN_MIGRATION_DATABASE_URL: fixture.migrationUrl,
          DATABASE_URL: fixture.runtimeUrl,
          PINWREN_SERVICE_DATABASE_URL: fixture.serviceUrl,
        },
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toContain("Cloud queues provisioned offline");
    expect(process.env.PINWREN_MIGRATION_DATABASE_URL).toBeUndefined();
  });
  it("rejects mixed endpoints and shared credentials before provisioning", async () => {
    if (!fixture) throw new Error("Queue fixture is not ready");
    const { provisionCloudJobQueues } = await import("./jobs/provision");
    const foreign = new URL(fixture.serviceUrl);
    foreign.pathname = "/different_database";
    await expect(
      provisionCloudJobQueues(fixture.migrationUrl, fixture.runtimeUrl, foreign.toString()),
    ).rejects.toThrow("same database endpoint");
    await expect(
      provisionCloudJobQueues(fixture.migrationUrl, fixture.runtimeUrl, fixture.runtimeUrl),
    ).rejects.toThrow("distinct");
  });
  it("prevents service metadata poisoning and refuses an unsafe existing topology before owner startup", async () => {
    if (!fixture) throw new Error("Queue fixture is not ready");
    const service = postgres(fixture.serviceUrl, { max: 1 });
    const { provisionCloudJobQueues } = await import("./jobs/provision");
    try {
      await expect(
        service`update pgboss.queue set table_name='unexpected_table' where name='events.dispatch'`,
      ).rejects.toThrow("Unsafe Cloud queue topology");
      await fixture.db`alter table pgboss.queue disable trigger pinwren_queue_topology`;
      await fixture.db`update pgboss.queue set table_name='unexpected_table' where name='events.dispatch'`;
      await fixture.db`alter table pgboss.queue enable trigger pinwren_queue_topology`;
      await expect(
        provisionCloudJobQueues(fixture.migrationUrl, fixture.runtimeUrl, fixture.serviceUrl),
      ).rejects.toThrow("topology");
    } finally {
      await fixture.db`update pgboss.queue set table_name='job_common' where name='events.dispatch'`;
      await service.end();
    }
  });
  it.each([true, false])("rejects queue access through membership (inherit=%s)", async (inherit) => {
    if (!fixture) throw new Error("Queue fixture is not ready");
    const role = `queue_reader_${Date.now()}`;
    const runtimeRole = decodeURIComponent(new URL(fixture.runtimeUrl).username);
    const { provisionCloudJobQueues } = await import("./jobs/provision");
    await fixture.db`create role ${fixture.db(role)}`;
    const client = postgres(fixture.runtimeUrl, { max: 1 });
    try {
      if (!inherit) await fixture.db`alter role ${fixture.db(runtimeRole)} noinherit`;
      await fixture.db`grant usage on schema pgboss to ${fixture.db(role)}`;
      await fixture.db`grant select on pgboss.job to ${fixture.db(role)}`;
      await fixture.db`grant ${fixture.db(role)} to ${fixture.db(runtimeRole)}`;
      if (!inherit) {
        const [ambient] =
          await client`select has_table_privilege(current_user,(select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='pgboss' and c.relname='job'),'SELECT') reads`;
        expect(ambient?.reads).toBe(false);
        await client.begin(async (tx) => {
          await tx`set local role ${tx(role)}`;
          await tx`select data from pgboss.job limit 1`;
        });
      }
      await expect(
        provisionCloudJobQueues(fixture.migrationUrl, fixture.runtimeUrl, fixture.serviceUrl),
      ).rejects.toThrow("unsafe effective queue privileges");
    } finally {
      await client.end();
      await fixture.db`revoke ${fixture.db(role)} from ${fixture.db(runtimeRole)}`;
      await fixture.db`alter role ${fixture.db(runtimeRole)} inherit`;
      await fixture.db`revoke all on schema pgboss from ${fixture.db(role)}`;
      await fixture.db`revoke all on pgboss.job from ${fixture.db(role)}`;
      await fixture.db`drop role ${fixture.db(role)}`;
    }
  });
  it("finishes pending owner index migrations before returning", async () => {
    if (!fixture) throw new Error("Queue fixture is not ready");
    const { provisionCloudJobQueues } = await import("./jobs/provision");
    await fixture.db`update pgboss.version set bam_on=null`;
    await fixture.db`insert into pgboss.bam (name,version,table_name,command) select 'pinwren-test',version,'job_common','CREATE INDEX CONCURRENTLY IF NOT EXISTS pinwren_queue_test_idx ON pgboss.job_common (id)' from pgboss.version`;
    await provisionCloudJobQueues(fixture.migrationUrl, fixture.runtimeUrl, fixture.serviceUrl);
    expect(await fixture.db`select status from pgboss.bam where name='pinwren-test'`).toMatchObject([
      { status: "completed" },
    ]);
    expect(
      await fixture.db`select 1 from pg_indexes where schemaname='pgboss' and indexname='pinwren_queue_test_idx'`,
    ).toHaveLength(1);
  });
  it("fails with an operator action when definitions are missing, then recovers after offline repair", async () => {
    if (!fixture) throw new Error("Queue fixture is not ready");
    await boss?.stop({ graceful: false });
    boss = undefined;
    vi.stubGlobal("__pinwrenBoss", undefined);
    const { getBoss, QUEUES } = await import("./jobs/boss");
    await fixture.db`delete from pgboss.queue where name=${QUEUES.slack}`;
    await expect(getBoss()).rejects.toThrow("scripts/cloud-migrate.sh offline");
    const { provisionCloudJobQueues } = await import("./jobs/provision");
    await provisionCloudJobQueues(fixture.migrationUrl, fixture.runtimeUrl, fixture.serviceUrl);
    boss = await getBoss();
    expect(await boss.getQueue(QUEUES.slack)).toBeDefined();
  });
});
