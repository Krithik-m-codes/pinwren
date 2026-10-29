import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb, withOrg, afterOrgCommit } from "../../db/src";
import { getRuntimeDb } from "../../db/src/connection";

// Ordinary unit runs need no database. CI and the isolated integration runner supply this URL.
describe.skipIf(!process.env.PINWREN_TEST_DATABASE_URL)("organization context on PostgreSQL", () => {
  beforeAll(() => {
    vi.stubEnv("DATABASE_URL", process.env.PINWREN_TEST_DATABASE_URL);
    vi.stubEnv("DATABASE_POOL_MAX", "1");
    vi.stubEnv("PINWREN_MODE", "cloud");
  });

  afterAll(async () => {
    await getRuntimeDb().$client.end();
    vi.unstubAllEnvs();
  });

  async function setting() {
    const rows = await getDb().execute<{ org: string }>(
      sql`select current_setting('pinwren.org_id', true) as org`,
    );
    return rows[0]?.org;
  }

  it("sets a parameterized identifier and clears it when the connection returns to its pool", async () => {
    const org = "org-a'); select 1; --";
    await withOrg(org, async () => expect(await setting()).toBe(org));
    const rows = await getRuntimeDb().execute<{ org: string | null }>(
      sql`select nullif(current_setting('pinwren.org_id', true), '') as org`,
    );
    expect(rows[0]?.org).toBeNull();
    await withOrg("org-b", async () => expect(await setting()).toBe("org-b"));
  });

  it("rolls back SQL changes and clears context on exceptions", async () => {
    await getRuntimeDb().execute(sql`create temporary table context_rollback_test (value text)`);
    await expect(
      withOrg("org-a", async (db) => {
        await db.execute(sql`insert into context_rollback_test values ('must roll back')`);
        throw new Error("test rollback");
      }),
    ).rejects.toThrow("test rollback");
    const rows = await getRuntimeDb().execute(sql`select * from context_rollback_test`);
    expect(rows).toHaveLength(0);
    await withOrg("org-b", async () => expect(await setting()).toBe("org-b"));
  });

  it("preserves savepoint transactions and restores the enclosing context", async () => {
    await withOrg("org-a", async (db) => {
      await expect(
        db.transaction(async (nested) => {
          await nested.execute(sql`select 1`);
          throw new Error("savepoint rollback");
        }),
      ).rejects.toThrow("savepoint rollback");
      expect(await setting()).toBe("org-a");
    });
  });

  it("preserves identities across concurrently queued transactions on one pooled connection", async () => {
    const identities = Array.from({ length: 12 }, (_, i) => `concurrent-org-${i}`);
    const results = await Promise.all(identities.map((org) => withOrg(org, async () => setting())));
    expect(results).toEqual(identities);
  });

  it("uses the savepoint database in nested services and discards effects from a rolled-back savepoint", async () => {
    const effects: string[] = [];
    await withOrg("org-a", async (db) => {
      await expect(
        db.transaction((nested) => {
          expect(getDb()).toBe(nested);
          afterOrgCommit(() => {
            effects.push("rolled back");
          });
          return Promise.reject(new Error("savepoint rollback"));
        }),
      ).rejects.toThrow("savepoint rollback");
      expect(getDb()).toBe(db);
      await db.transaction(async (nested) => {
        expect(getDb()).toBe(nested);
        await nested.execute(sql`select 1`);
        afterOrgCommit(() => {
          effects.push("committed");
        });
      });
      expect(effects).toEqual([]);
    });
    expect(effects).toEqual(["committed"]);
  });
});
