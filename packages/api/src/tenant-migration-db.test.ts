import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { expect, it } from "vitest";
import { runMigrations } from "../../db/src/migrate";

it.skipIf(!process.env.PINWREN_ISOLATION_ADMIN_URL).each(["page", "feedback_label"])(
  "aborts a tenant migration with inconsistent legacy %s relationships without changing data",
  async (relationship) => {
    const source = process.env.PINWREN_ISOLATION_ADMIN_URL;
    if (!source) throw new Error("Isolation fixture URL is required");
    const admin = postgres(source, { max: 1, onnotice: () => undefined });
    const database = `pinwren_isolation_legacy_${randomUUID().replaceAll("-", "")}`;
    const folder = await mkdtemp(join(tmpdir(), "pinwren-isolation-migration-"));
    if (!basename(folder).startsWith("pinwren-isolation-migration-")) {
      await admin.end();
      throw new Error("Unexpected fixture directory");
    }
    const migrations = fileURLToPath(new URL("../../db/drizzle", import.meta.url));
    let fixture: postgres.Sql | undefined;
    try {
      const [databaseInfo] = await admin<{ name: string }[]>`select current_database() as name`;
      if (!databaseInfo?.name.includes("isolation"))
        throw new Error("Use a dedicated isolation test database");
      await admin.unsafe(`create database "${database}"`);
      const url = new URL(source);
      url.pathname = `/${database}`;
      const fixtureUrl = url.toString();
      const journal = JSON.parse(await readFile(join(migrations, "meta/_journal.json"), "utf8")) as {
        version: string;
        dialect: string;
        entries: { idx: number; tag: string }[];
      };
      const legacy = { ...journal, entries: journal.entries.filter((entry) => entry.idx < 8) };
      await mkdir(join(folder, "meta"));
      await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(legacy));
      for (const entry of legacy.entries)
        await copyFile(join(migrations, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
      await runMigrations(fixtureUrl, folder);
      fixture = postgres(fixtureUrl, { max: 1, onnotice: () => undefined });
      await fixture`insert into organization (id,name,slug) values ('legacy-a','A','legacy-a'),('legacy-b','B','legacy-b')`;
      const projectId = randomUUID();
      await fixture`insert into project (id,org_id,name,slug,public_key) values (${projectId},'legacy-b','B','b','legacy-b')`;
      if (relationship === "page") {
        await fixture`insert into page (org_id,project_id,url) values ('legacy-a',${projectId},'https://legacy.invalid/')`;
        await expect(runMigrations(fixtureUrl, migrations)).rejects.toThrow(/page_project_tenant_fk/);
        expect(await fixture`select org_id from page`).toMatchObject([{ org_id: "legacy-a" }]);
      } else {
        const localProject = randomUUID(),
          feedbackId = randomUUID(),
          labelId = randomUUID();
        await fixture`insert into project (id,org_id,name,slug,public_key) values (${localProject},'legacy-a','A','a','legacy-a')`;
        await fixture`insert into feedback (id,org_id,project_id,number,kind,body,client_id) values (${feedbackId},'legacy-a',${localProject},1,'bug','legacy',${randomUUID()})`;
        await fixture`insert into label (id,org_id,project_id,name,color) values (${labelId},'legacy-b',${projectId},'foreign','#000000')`;
        await fixture`insert into feedback_label (feedback_id,label_id) values (${feedbackId},${labelId})`;
        await expect(runMigrations(fixtureUrl, migrations)).rejects.toThrow(/feedback_label_tenant_fk/);
        expect(await fixture`select * from feedback_label`).toHaveLength(1);
      }
      expect(await fixture`select 1 from pg_indexes where indexname='project_id_org_uq'`).toHaveLength(0);
    } finally {
      await fixture?.end();
      await admin.unsafe(`drop database if exists "${database}"`);
      await admin.end();
      await rm(folder, { recursive: true, force: true });
    }
  },
);
