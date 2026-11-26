import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { currentOrgId, withOrg } from "../../db/src";
import { getRuntimeDb } from "../../db/src/connection";
import { closeIdentityDatabase } from "../../db/src/identity";
import { createCloudFixture } from "./test-helpers/cloud-fixture";

const effects = vi.hoisted(() => ({ remove: vi.fn<(key: string) => Promise<void>>() }));
vi.mock("./storage", () => ({ storage: () => ({ remove: effects.remove }) }));

describe.skipIf(!process.env.PINWREN_ISOLATION_ADMIN_URL)("Cloud maintenance budgets", () => {
  let fixture: Awaited<ReturnType<typeof createCloudFixture>> | undefined;
  const orgA = randomUUID(),
    orgB = randomUUID();
  const projectA = randomUUID(),
    projectB = randomUUID();
  const db = () => {
    if (!fixture) throw new Error("Maintenance fixture is not ready");
    return fixture.db;
  };
  beforeAll(async () => {
    fixture = await createCloudFixture();
    vi.stubEnv("PINWREN_MODE", "cloud");
    vi.stubEnv("DATABASE_URL", fixture.runtimeUrl);
    vi.stubEnv("PINWREN_SERVICE_DATABASE_URL", fixture.serviceUrl);
    vi.stubEnv("PINWREN_URL", "http://localhost:3100");
    vi.stubEnv("PINWREN_SECRET", randomUUID() + randomUUID());
    for (const [org, project] of [
      [orgA, projectA],
      [orgB, projectB],
    ] as const) {
      await db()`insert into organization (id,name,slug) values (${org},${org},${org})`;
      await db()`insert into project (id,org_id,name,slug,public_key,allowed_origins,identity_secret,action_secret,retention_days) values (${project},${org},'Project',${project},${randomUUID()},${["https://example.test"]},${randomUUID()},${randomUUID()},1)`;
    }
    // Record actual transaction boundaries and settings, rather than mocking withOrg.
    await db()`create schema maintenance_audit`;
    await db()`create table maintenance_audit.deleted (org_id text, tx bigint, timeout text, lock_timeout text)`;
    await db()`create function maintenance_audit.record_delete() returns trigger language plpgsql as $$
      begin insert into maintenance_audit.deleted values (old.org_id,txid_current(),current_setting('statement_timeout'),current_setting('lock_timeout')); return old; end $$`;
    await db()`create trigger maintenance_deleted after delete on feedback for each row execute function maintenance_audit.record_delete()`;
    const runtimeRole = new URL(fixture.runtimeUrl).username;
    await db().unsafe(`grant usage on schema maintenance_audit to "${runtimeRole}"`);
    await db().unsafe(`grant insert on maintenance_audit.deleted to "${runtimeRole}"`);
  }, 120_000);
  afterAll(async () => {
    if (fixture) {
      await getRuntimeDb().$client.end();
      await closeIdentityDatabase();
      await fixture.dispose();
    }
    vi.unstubAllEnvs();
  });
  it("commits at most 500 deletes per batch, caps each workspace and resumes later", async () => {
    for (const [org, project, count] of [
      [orgA, projectA, 5105],
      [orgB, projectB, 23],
    ] as const) {
      await db()`insert into feedback (org_id,project_id,number,kind,body,client_id,created_at) select ${org},${project},n,'bug','Expired',gen_random_uuid(),now()-interval '2 days' from generate_series(1,${count}::int) n`;
    }
    const { applyRetention } = await import("./jobs/maintenance");
    expect(await applyRetention()).toMatchObject({ feedback: 5023 });
    expect(await db()`select count(*)::int as n from feedback where org_id=${orgA}`).toEqual([{ n: 105 }]);
    expect(await db()`select count(*)::int as n from feedback where org_id=${orgB}`).toEqual([{ n: 0 }]);
    const batches =
      await db()`select tx,count(*)::int as n from maintenance_audit.deleted where org_id=${orgA} group by tx`;
    expect(batches).toHaveLength(10);
    expect(batches.every((row) => row.n === 500)).toBe(true);
    expect(await db()`select distinct timeout,lock_timeout from maintenance_audit.deleted`).toEqual([
      { timeout: "15s", lock_timeout: "2s" },
    ]);
    expect(await applyRetention()).toMatchObject({ feedback: 105 });
  }, 120_000);
  it("commits trash in separate transactions and preserves fresh reports", async () => {
    await db()`truncate maintenance_audit.deleted`;
    await db()`insert into feedback (org_id,project_id,number,kind,body,client_id,deleted_at) select ${orgA},${projectA},n,'bug','Trash',gen_random_uuid(),now()-interval '31 days' from generate_series(6000,7000) n`;
    await db()`insert into feedback (org_id,project_id,number,kind,body,client_id) values (${orgA},${projectA},8000,'bug','Fresh',${randomUUID()})`;
    const { cleanupTrash } = await import("./jobs/maintenance");
    expect(await cleanupTrash()).toBe(1001);
    expect(await db()`select count(*)::int as n from feedback`).toEqual([{ n: 1 }]);
    const batches =
      await db()`select count(*)::int as n from maintenance_audit.deleted group by tx order by n`;
    expect(batches.map((row) => Number(row.n))).toEqual([1, 500, 500]);
  }, 120_000);
  it("rejects nested global maintenance rather than reusing a tenant transaction", async () => {
    const { applyRetention, cleanupTrash } = await import("./jobs/maintenance");
    await expect(withOrg(orgA, () => applyRetention())).rejects.toThrow(/outside.*tenant/i);
    await expect(withOrg(orgA, () => cleanupTrash())).rejects.toThrow(/outside.*tenant/i);
  });
  it("bounds system counters and prunes instance email without crossing tenant scope", async () => {
    await db()`insert into rate_limit (key,count,reset_at) select 'old-'||n,1,now()-interval '2 hours' from generate_series(1,5001) n`;
    await db()`insert into auth_rate_limit (id,key,count,last_request) select 'old-'||n,'old-'||n,1,0 from generate_series(1,5001) n`;
    await db()`insert into email_delivery (to_address,template_key,subject,status,payload,created_at) select 'test@example.test','test','Test','sent','{}'::jsonb,now()-interval '31 days' from generate_series(1,5001)`;
    const { applyRetention } = await import("./jobs/maintenance");
    expect(await applyRetention()).toMatchObject({ emails: 5000, feedback: 0 });
    expect(await db()`select count(*)::int as n from rate_limit`).toEqual([{ n: 1 }]);
    expect(await db()`select count(*)::int as n from auth_rate_limit`).toEqual([{ n: 1 }]);
    expect(await db()`select count(*)::int as n from email_delivery`).toEqual([{ n: 1 }]);
    expect(await applyRetention()).toMatchObject({ emails: 1 });
  }, 120_000);
  it("bounds each tenant log independently and preserves recent and unread records", async () => {
    await db()`truncate maintenance_audit.deleted`;
    for (const table of ["webhook_delivery", "email_delivery", "notification", "automation_run"]) {
      await db().unsafe(
        `create trigger maintenance_deleted after delete on ${table} for each row execute function maintenance_audit.record_delete()`,
      );
    }
    for (const [org, project, count] of [
      [orgA, projectA, 5001],
      [orgB, projectB, 1],
    ] as const) {
      const user = randomUUID(),
        endpoint = randomUUID(),
        rule = randomUUID();
      await db()`insert into "user" (id,name,email) values (${user},'Member',${`${user}@test.invalid`})`;
      await db()`insert into member (id,organization_id,user_id,role) values (${randomUUID()},${org},${user},'owner')`;
      await db()`insert into webhook_endpoint (id,org_id,url) values (${endpoint},${org},'https://example.test')`;
      await db()`insert into automation_rule (id,org_id,project_id,name,trigger,actions) values (${rule},${org},${project},'Rule','{}'::jsonb,'[]'::jsonb)`;
      await db()`insert into webhook_delivery (org_id,endpoint_id,event_id,event,payload,created_at) select ${org},${endpoint},gen_random_uuid(),'test','{}'::jsonb,now()-interval '31 days' from generate_series(1,${count}::int)`;
      await db()`insert into email_delivery (org_id,to_address,template_key,subject,status,payload,created_at) select ${org},'test@example.test','test','Test','sent','{}'::jsonb,now()-interval '31 days' from generate_series(1,${count}::int)`;
      await db()`insert into notification (org_id,user_id,type,read_at) select ${org},${user},'test',now()-interval '91 days' from generate_series(1,${count}::int)`;
      await db()`insert into automation_run (org_id,rule_id,project_id,event,status,created_at) select ${org},${rule},${project},'test','success',now()-interval '31 days' from generate_series(1,${count}::int)`;
      await db()`insert into notification (org_id,user_id,type,created_at) values (${org},${user},'unread',now()-interval '100 days')`;
      await db()`insert into email_delivery (org_id,to_address,template_key,subject,status,payload) values (${org},'test@example.test','test','Recent','sent','{}'::jsonb)`;
    }
    const { applyRetention } = await import("./jobs/maintenance");
    expect(await applyRetention()).toMatchObject({ deliveries: 5001, emails: 5001 });
    for (const table of ["webhook_delivery", "email_delivery", "notification", "automation_run"]) {
      const [row] = await db().unsafe<{ n: number }[]>(
        `select count(*)::int as n from ${table} where org_id=$1`,
        [orgA],
      );
      expect(row?.n).toBe(table === "notification" || table === "email_delivery" ? 2 : 1);
    }
    const batches =
      await db()`select count(*)::int as n from maintenance_audit.deleted where org_id=${orgA} group by tx`;
    expect(batches).toHaveLength(40);
    expect(batches.every((row) => row.n === 500)).toBe(true);
    expect(await applyRetention()).toMatchObject({ deliveries: 1, emails: 1 });
    expect(await db()`select count(*)::int as n from notification`).toEqual([{ n: 2 }]);
    expect(await db()`select count(*)::int as n from email_delivery`).toEqual([{ n: 2 }]);
  }, 120_000);
  it("removes assets only after commit, drops effects on rollback and refuses foreign reports", async () => {
    const { purgeFeedback } = await import("./jobs/maintenance");
    const report = randomUUID(),
      foreign = randomUUID();
    for (const [id, org, project] of [
      [report, orgA, projectA],
      [foreign, orgB, projectB],
    ] as const) {
      await db()`insert into feedback (id,org_id,project_id,number,kind,body,client_id) values (${id},${org},${project},9000,'bug','Fresh',${randomUUID()})`;
      await db()`insert into feedback_asset (org_id,feedback_id,kind,storage_key,content_type,bytes) values (${org},${id},'screenshot',${id},'image/png',1)`;
    }
    effects.remove.mockReset();
    await expect(
      withOrg(orgA, async () => {
        expect(await purgeFeedback([report])).toBe(1);
        throw new Error("rollback purge");
      }),
    ).rejects.toThrow("rollback purge");
    expect(effects.remove).not.toHaveBeenCalled();
    expect(await db()`select id from feedback where id=${report}`).toHaveLength(1);
    expect(await withOrg(orgA, () => purgeFeedback([foreign]))).toBe(0);
    expect(effects.remove).not.toHaveBeenCalled();
    let committed = false;
    effects.remove.mockImplementation(async (key) => {
      expect(currentOrgId()).toBeUndefined();
      expect(await db()`select id from feedback where id=${key}`).toHaveLength(0);
      committed = true;
    });
    await withOrg(orgA, async () => {
      expect(await purgeFeedback([report])).toBe(1);
      expect(effects.remove).not.toHaveBeenCalled();
    });
    await vi.waitFor(() => expect(committed).toBe(true));
    expect(effects.remove).toHaveBeenCalledExactlyOnceWith(report);
    expect(await db()`select id from feedback where id=${foreign}`).toHaveLength(1);
  });
  it("times out blocked cleanup, rolls back the batch and succeeds on a later run", async () => {
    const id = randomUUID();
    await db()`insert into feedback (org_id,project_id,number,kind,body,client_id,deleted_at) select ${orgA},${projectA},n,'bug','Earlier batch',gen_random_uuid(),now()-interval '32 days' from generate_series(16000,16499) n`;
    await db()`insert into feedback (id,org_id,project_id,number,kind,body,client_id,deleted_at) values (${id},${orgA},${projectA},9100,'bug','Locked trash',${randomUUID()},now()-interval '31 days')`;
    await db()`truncate maintenance_audit.deleted`;
    const { cleanupTrash } = await import("./jobs/maintenance");
    await db().begin(async (locked) => {
      await locked`select id from feedback where id=${id} for update`;
      await expect(cleanupTrash()).rejects.toThrow();
      expect(await locked`select id from feedback where id=${id}`).toHaveLength(1);
      // The first committed batch survives the next batch's timeout.
      expect(await locked`select * from maintenance_audit.deleted`).toHaveLength(500);
    });
    expect(await cleanupTrash()).toBe(1);
    // A later ordinary tenant transaction must not inherit the maintenance timeout.
    await withOrg(orgA, async (tx) => {
      const { sql } = await import("drizzle-orm");
      const settings = await tx.execute(sql`select current_setting('lock_timeout') as lock_timeout`);
      expect(settings[0]?.lock_timeout).toBe("0");
    });
  }, 30_000);
  it("preserves rate counters refreshed concurrently after candidate selection", async () => {
    const { pruneSystemRateLimits } = await import("./db/system");
    await pruneSystemRateLimits();
    for (const table of ["rate_limit", "auth_rate_limit"] as const) {
      const key = randomUUID();
      if (table === "rate_limit") {
        await db()`insert into rate_limit (key,count,reset_at) values (${key},1,now()-interval '2 hours')`;
      } else {
        await db()`insert into auth_rate_limit (id,key,count,last_request) values (${key},${key},1,0)`;
      }
      let pending: Promise<void> | undefined;
      await db().begin(async (locked) => {
        if (table === "rate_limit") {
          await locked`update rate_limit set reset_at=now()+interval '1 hour', count=2 where key=${key}`;
        } else {
          await locked`update auth_rate_limit set last_request=extract(epoch from now())*1000, count=2 where key=${key}`;
        }
        pending = pruneSystemRateLimits();
        void pending.catch(() => undefined);
        await vi.waitFor(
          async () => {
            await locked`select pg_stat_clear_snapshot()`;
            const waiting =
              await locked`select pid from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like ${`delete from "${table}"%`}`;
            expect(waiting.length).toBeGreaterThan(0);
          },
          { timeout: 1500, interval: 20 },
        );
      });
      await pending;
      expect(await db().unsafe(`select count from ${table} where key=$1`, [key])).toEqual([{ count: 2 }]);
    }
  }, 30_000);
  it("keeps per-workspace caps when row security is absent as on selfhost", async () => {
    await db()`alter table feedback disable row level security`;
    await db()`alter table project disable row level security`;
    try {
      for (const [org, project, count] of [
        [orgA, projectA, 5105],
        [orgB, projectB, 23],
      ] as const) {
        await db()`insert into feedback (org_id,project_id,number,kind,body,client_id,created_at) select ${org},${project},n+20000,'bug','Unprotected expired',gen_random_uuid(),now()-interval '2 days' from generate_series(1,${count}::int) n`;
      }
      const { applyRetention } = await import("./jobs/maintenance");
      expect(await applyRetention()).toMatchObject({ feedback: 5023 });
      expect(
        await db()`select count(*)::int as n from feedback where org_id=${orgA} and body='Unprotected expired'`,
      ).toEqual([{ n: 105 }]);
      expect(
        await db()`select count(*)::int as n from feedback where org_id=${orgB} and body='Unprotected expired'`,
      ).toEqual([{ n: 0 }]);
      expect(await applyRetention()).toMatchObject({ feedback: 105 });
    } finally {
      await db()`alter table feedback enable row level security`;
      await db()`alter table project enable row level security`;
    }
  }, 120_000);
});
