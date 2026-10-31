import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../db/src/migrate";
import { tenantInventory } from "../../db/src/tenant-inventory";

type Row = Record<string, postgres.ParameterOrJSON<never>>;
const protectedTables = tenantInventory.filter(
  (entry) => entry.ownership === "direct" || entry.ownership === "parent",
);
const adminUrl = process.env.PINWREN_ISOLATION_ADMIN_URL;

describe.skipIf(!adminUrl)("PostgreSQL tenant row security", () => {
  const admin = postgres(adminUrl ?? "postgres://unused", { max: 1, onnotice: () => undefined });
  const suffix = randomUUID().replaceAll("-", "");
  const role = `pinwren_test_${suffix}`;
  const fixturePassword = randomUUID();
  const orgA = `isolation-a-${suffix}`;
  const orgB = `isolation-b-${suffix}`;
  const runtimeUrl = new URL(adminUrl ?? "postgres://unused");
  runtimeUrl.username = role;
  runtimeUrl.password = fixturePassword;
  const runtime = postgres(runtimeUrl.toString(), { max: 2 });
  const fixture: Record<string, Record<string, Row>> = {};

  function idOf(org: string, table: string): string {
    const value = fixture[org]?.[table]?.id;
    if (typeof value !== "string") throw new Error(`Missing fixture id for ${table}`);
    return value;
  }

  async function seed(org: string) {
    const id = () => randomUUID();
    const projectId = id(),
      feedbackId = id(),
      labelId = id(),
      endpointId = id(),
      integrationId = id();
    const userId = `user-${org}`;
    await admin`insert into organization (id, name, slug) values (${org}, ${org}, ${org})`;
    await admin`insert into "user" (id, name, email) values (${userId}, ${userId}, ${`${org}@test.invalid`})`;
    const rows: Record<string, Row> = {
      project: { id: projectId, org_id: org, name: org, slug: org, public_key: org },
      page: { id: id(), org_id: org, project_id: projectId, url: "https://example.invalid/" },
      review_round: { id: id(), org_id: org, project_id: projectId, name: org },
      review_link: { id: id(), org_id: org, project_id: projectId, label: org, token_hash: org },
      feedback: {
        id: feedbackId,
        org_id: org,
        project_id: projectId,
        number: 1,
        kind: "bug",
        body: org,
        client_id: id(),
      },
      diagnostics: { feedback_id: feedbackId },
      feedback_ai: { feedback_id: feedbackId, org_id: org },
      feedback_translation: { id: id(), feedback_id: feedbackId, target_locale: "en", body: org },
      feedback_asset: {
        id: id(),
        org_id: org,
        feedback_id: feedbackId,
        kind: "attachment",
        storage_key: org,
        content_type: "text/plain",
        bytes: 1,
      },
      comment: { id: id(), org_id: org, feedback_id: feedbackId, body: org },
      activity: { id: id(), org_id: org, feedback_id: feedbackId, type: "created" },
      notification_preference: { id: id(), org_id: org, user_id: userId, project_id: projectId },
      notification: { id: id(), org_id: org, user_id: userId, type: "test", feedback_id: feedbackId },
      feedback_watcher: { feedback_id: feedbackId, user_id: userId },
      label: { id: labelId, org_id: org, project_id: projectId, name: org, color: "#000000" },
      feedback_label: { feedback_id: feedbackId, label_id: labelId },
      email_delivery: {
        id: id(),
        org_id: org,
        to_address: `${org}@test.invalid`,
        template_key: "test",
        subject: org,
        status: "sent",
        payload: admin.json({}),
      },
      webhook_endpoint: {
        id: endpointId,
        org_id: org,
        project_id: projectId,
        url: "https://example.invalid/hook",
      },
      webhook_delivery: {
        id: id(),
        org_id: org,
        endpoint_id: endpointId,
        event_id: id(),
        event: "feedback.created",
        payload: admin.json({}),
      },
      api_token: { id: id(), org_id: org, user_id: userId, name: org, prefix: org, hash: org },
      org_setting: { org_id: org, key: "test" },
      brand_asset: { id: id(), org_id: org, storage_key: org, content_type: "text/plain", bytes: 1 },
      email_template: { id: id(), org_id: org, key: "test", subject: org, body: org },
      issue_integration: {
        id: integrationId,
        org_id: org,
        project_id: projectId,
        provider: "github",
        token: org,
        token_hint: org,
        repo: org,
        webhook_secret: org,
      },
      issue_link: {
        id: id(),
        org_id: org,
        feedback_id: feedbackId,
        integration_id: integrationId,
        provider: "github",
        number: 1,
        url: "https://example.invalid/issue",
      },
      saved_view: { id: id(), org_id: org, owner_id: userId, name: org },
      email_suppression: { org_id: org, email: `${org}@test.invalid` },
      billing_subscription: { org_id: org, plan: "pro", status: "active", interval: "monthly" },
      billing_event: { org_id: org, webhook_id: id(), type: "subscription.active" },
    };
    for (const [table, row] of Object.entries(rows)) await admin`insert into ${admin(table)} ${admin(row)}`;
    fixture[org] = rows;
  }

  beforeAll(async () => {
    // This suite activates RLS. Require a deliberately named, disposable integration database.
    const [database] = await admin<{ name: string }[]>`select current_database() as name`;
    if (!database?.name.includes("isolation")) throw new Error("Use a dedicated isolation test database");
    await runMigrations(adminUrl ?? "", fileURLToPath(new URL("../../db/drizzle", import.meta.url)));
    await seed(orgA);
    await seed(orgB);
    await admin`insert into email_delivery (to_address, template_key, subject, status, payload) values ('system@test.invalid', 'test', ${suffix}, 'sent', '{}')`;
    const [createRole] = await admin<
      { statement: string }[]
    >`select format('create role %I login password %L',${role}::text,${fixturePassword}::text) as statement`;
    if (!createRole) throw new Error("Cannot prepare fixture role");
    await admin.unsafe(createRole.statement);
    await admin.unsafe(`grant usage on schema public to "${role}"`);
    for (const { table } of protectedTables) {
      await admin.unsafe(`grant select, insert, update, delete on "${table}" to "${role}"`);
      const policies =
        await admin`select 1 from pg_policies where schemaname='public' and tablename=${table} and policyname='pinwren_tenant'`;
      if (policies.length) {
        await admin.unsafe(`alter table "${table}" enable row level security`);
        await admin.unsafe(`alter table "${table}" force row level security`);
      }
    }
  });

  afterAll(async () => {
    await runtime.end();
    await admin`delete from organization where id in (${orgA},${orgB})`;
    await admin`delete from "user" where id in (${`user-${orgA}`},${`user-${orgB}`})`;
    await admin`delete from email_delivery where subject=${suffix}`;
    await admin.unsafe(`drop owned by "${role}"`).catch(() => undefined);
    await admin.unsafe(`drop role if exists "${role}"`);
    await admin.end();
  });

  async function scoped<T>(org: string, run: (db: postgres.TransactionSql) => Promise<T>) {
    return runtime.begin(async (db) => {
      await db`select set_config('pinwren.org_id',${org},true)`;
      return run(db);
    });
  }

  it("uses a non-owner runtime role without superuser or RLS bypass", async () => {
    const rows = await runtime`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`;
    expect(rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: false });
    expect(
      await runtime`select 1 from pg_tables where schemaname='public' and tableowner=current_user`,
    ).toHaveLength(0);
  });

  it("installs and validates every declared composite tenant relationship", async () => {
    const rows = await admin<
      { name: string; valid: boolean }[]
    >`select conname as name, convalidated as valid from pg_constraint where connamespace = 'public'::regnamespace and conname like '%_tenant_fk'`;
    expect(rows).toHaveLength(21);
    expect(rows.every((row) => row.valid)).toBe(true);
  });

  it("permits local inserts, updates and deletes while preserving foreign content", async () => {
    await scoped(orgA, async (db) => {
      const id = randomUUID();
      const rows =
        await db`insert into project (id,org_id,name,slug,public_key) values (${id},${orgA},'new local',${id},${id}) returning id`;
      expect(rows[0]?.id).toBe(id);
      expect(await db`update project set name='updated local' where id=${id} returning name`).toMatchObject([
        { name: "updated local" },
      ]);
      expect(await db`delete from project where id=${id} returning id`).toHaveLength(1);
    });
    expect(await scoped(orgB, async (db) => db`select name from project`)).toMatchObject([{ name: orgB }]);
  });

  it.each(protectedTables)(
    "scopes unfiltered SELECT on $table and denies missing context",
    async ({ table }) => {
      const rows = await scoped(orgA, async (db) => db`select * from ${db(table)}`);
      expect(rows).toHaveLength(1);
      const foreign = fixture[orgB]?.[table];
      expect(JSON.stringify(rows)).not.toContain(orgB);
      if (foreign?.feedback_id) expect(JSON.stringify(rows)).not.toContain(foreign.feedback_id);
      expect(await runtime`select * from ${runtime(table)}`).toHaveLength(0);
    },
  );

  it.each(protectedTables.filter((entry) => entry.ownership === "direct"))(
    "rejects foreign ownership changes on $table",
    async ({ table }) => {
      await expect(
        scoped(orgA, async (db) => db`update ${db(table)} set org_id=${orgB} where org_id=${orgA}`),
      ).rejects.toMatchObject({ code: "42501" });
      const changed = await scoped(
        orgA,
        async (db) => db`update ${db(table)} set org_id=org_id where org_id=${orgB} returning *`,
      );
      expect(changed).toHaveLength(0);
      expect(
        await scoped(orgA, async (db) => db`delete from ${db(table)} where org_id=${orgB} returning *`),
      ).toHaveLength(0);
    },
  );

  it("rejects inserts claiming another organization", async () => {
    await expect(
      scoped(
        orgA,
        async (db) =>
          db`insert into project (org_id,name,slug,public_key) values (${orgB},'foreign',${suffix},${suffix})`,
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("rejects a local page referencing a foreign project", async () => {
    await expect(
      scoped(
        orgA,
        async (db) =>
          db`insert into page (org_id,project_id,url) values (${orgA},${idOf(orgB, "project")},'https://foreign.invalid/')`,
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("rejects a join across organizations even though both parent ids exist", async () => {
    await expect(
      scoped(
        orgA,
        async (db) =>
          db`insert into feedback_label (feedback_id,label_id) values (${idOf(orgA, "feedback")},${idOf(orgB, "label")})`,
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("rejects a duplicate link pointing to another organization's feedback", async () => {
    await expect(
      scoped(
        orgA,
        async (db) => db`update feedback set duplicate_of_id=${idOf(orgB, "feedback")} where org_id=${orgA}`,
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("rejects a cross-tenant label link even for privileged maintenance", async () => {
    await expect(
      admin`insert into feedback_label (feedback_id,label_id) values (${idOf(orgA, "feedback")},${idOf(orgB, "label")})`,
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("permits a local label link through the restricted role", async () => {
    await scoped(orgA, async (db) => {
      const labelId = randomUUID();
      await db`insert into label (id,org_id,project_id,name,color) values (${labelId},${orgA},${idOf(orgA, "project")},${labelId},'#000000')`;
      expect(
        await db`insert into feedback_label (feedback_id,label_id) values (${idOf(orgA, "feedback")},${labelId}) returning *`,
      ).toHaveLength(1);
      await db`delete from label where id=${labelId}`;
    });
  });

  it("prevents a privileged parent ownership change from invalidating label links", async () => {
    await expect(
      admin`update label set org_id=${orgA},project_id=${idOf(orgA, "project")} where id=${idOf(orgB, "label")}`,
    ).rejects.toMatchObject({ code: "23503" });
  });
});
