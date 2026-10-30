import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../../db/src/migrate";
import { assertCloudDatabaseSecurity } from "../../db/src/cloud-security";
import { provisionCloudDatabase } from "../../db/src/provision-cloud";

describe.skipIf(!process.env.PINWREN_ISOLATION_ADMIN_URL)("Cloud provisioning and startup boundary", () => {
  const source = process.env.PINWREN_ISOLATION_ADMIN_URL ?? "postgres://unused";
  const suffix = randomUUID().replaceAll("-", "");
  const database = `pinwren_isolation_security_${suffix}`;
  const runtimeRole = `runtime_${suffix}`,
    serviceRole = `service_${suffix}`;
  const runtimePassword = randomUUID(),
    servicePassword = randomUUID();
  const admin = postgres(source, { max: 1, onnotice: () => undefined });
  const databaseUrl = new URL(source);
  databaseUrl.pathname = `/${database}`;
  const fixture = postgres(databaseUrl.toString(), { max: 1, onnotice: () => undefined });
  const runtimeUrl = new URL(databaseUrl);
  runtimeUrl.username = runtimeRole;
  runtimeUrl.password = runtimePassword;
  const serviceUrl = new URL(databaseUrl);
  serviceUrl.username = serviceRole;
  serviceUrl.password = servicePassword;
  const options = { runtimeRole, serviceRole };

  beforeAll(async () => {
    const [current] = await admin<{ name: string }[]>`select current_database() as name`;
    if (!current?.name.includes("isolation")) throw new Error("Use a dedicated isolation test database");
    await admin.unsafe(`create database "${database}"`);
    for (const [role, password] of [
      [runtimeRole, runtimePassword],
      [serviceRole, servicePassword],
    ] as const) {
      const [createRole] = await admin<
        { statement: string }[]
      >`select format('create role %I login password %L',${role}::text,${password}::text) as statement`;
      if (!createRole) throw new Error("Cannot prepare fixture role");
      await admin.unsafe(createRole.statement);
    }
    await runMigrations(databaseUrl.toString(), fileURLToPath(new URL("../../db/drizzle", import.meta.url)));
    vi.stubEnv("PINWREN_MODE", "cloud");
    vi.stubEnv("DATABASE_URL", runtimeUrl.toString());
    vi.stubEnv("PINWREN_SERVICE_DATABASE_URL", serviceUrl.toString());
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await fixture.end();
    await admin.unsafe(`drop database if exists "${database}"`);
    await admin.unsafe(`drop role if exists "${runtimeRole}"`);
    await admin.unsafe(`drop role if exists "${serviceRole}"`);
    await admin.end();
  });

  it("refuses startup before provisioning, then accepts idempotent provisioning", async () => {
    await expect(assertCloudDatabaseSecurity()).rejects.toThrow(/Cloud|security|RLS|privilege/i);
    await fixture`revoke connect on database ${fixture(database)} from public`;
    await provisionCloudDatabase(databaseUrl.toString(), options);
    await expect(assertCloudDatabaseSecurity()).resolves.toBeUndefined();
    await provisionCloudDatabase(databaseUrl.toString(), options);
    await expect(assertCloudDatabaseSecurity()).resolves.toBeUndefined();
  });

  it.each(["BYPASSRLS", "CREATEROLE", "CREATEDB", "REPLICATION", "SUPERUSER"])(
    "refuses runtime role attribute %s",
    async (attribute) => {
      await fixture.unsafe(`alter role "${runtimeRole}" ${attribute}`);
      try {
        await expect(assertCloudDatabaseSecurity()).rejects.toThrow(/role|privilege/i);
      } finally {
        await fixture.unsafe(`alter role "${runtimeRole}" NO${attribute}`);
      }
    },
  );

  it("refuses privileged inherited memberships", async () => {
    await fixture.unsafe(`grant pg_read_all_data to "${runtimeRole}"`);
    try {
      await expect(assertCloudDatabaseSecurity()).rejects.toThrow(/role|membership/i);
    } finally {
      await fixture.unsafe(`revoke pg_read_all_data from "${runtimeRole}"`);
    }
  });

  it("refuses RLS-bypassing TRUNCATE grants", async () => {
    await fixture.unsafe(`grant truncate on public.project to "${runtimeRole}"`);
    try {
      await expect(assertCloudDatabaseSecurity()).rejects.toThrow(/TRUNCATE|privilege/i);
    } finally {
      await fixture.unsafe(`revoke truncate on public.project from "${runtimeRole}"`);
    }
  });

  it("refuses policy modification through table ownership", async () => {
    const [original] = await fixture<{ owner: string }[]>`select current_user as owner`;
    if (!original) throw new Error("Missing fixture owner");
    await fixture.unsafe(`alter table public.project owner to "${runtimeRole}"`);
    try {
      await expect(assertCloudDatabaseSecurity()).rejects.toThrow(/owner|role/i);
    } finally {
      await fixture`alter table public.project owner to ${fixture(original.owner)}`;
      // ALTER OWNER rewrites ACLs as well as ownership; restore the complete fixture grants.
      await provisionCloudDatabase(databaseUrl.toString(), options);
    }
  });

  it("refuses a new unclassified database table", async () => {
    await fixture`create table public.unclassified_cloud_data (id text)`;
    try {
      await expect(assertCloudDatabaseSecurity()).rejects.toThrow(/inventory|unclassified/i);
    } finally {
      await fixture`drop table public.unclassified_cloud_data`;
    }
  });

  it("refuses missing FORCE RLS", async () => {
    await fixture`alter table public.project no force row level security`;
    try {
      await expect(assertCloudDatabaseSecurity()).rejects.toThrow(/RLS|force/i);
    } finally {
      await fixture`alter table public.project force row level security`;
    }
  });

  it("refuses permissive policy drift and rolls back failed provisioning atomically", async () => {
    await fixture`create policy unreviewed_cloud_access on public.project using (true)`;
    await fixture.unsafe(`grant truncate on public.project to "${runtimeRole}"`);
    try {
      await expect(assertCloudDatabaseSecurity()).rejects.toThrow();
      await expect(provisionCloudDatabase(databaseUrl.toString(), options)).rejects.toThrow(/policy/i);
      const [row] = await fixture<
        { allowed: boolean }[]
      >`select has_table_privilege(${runtimeRole},'public.project','TRUNCATE') as allowed`;
      expect(row?.allowed).toBe(true);
    } finally {
      await fixture`drop policy unreviewed_cloud_access on public.project`;
      await fixture.unsafe(`revoke truncate on public.project from "${runtimeRole}"`);
    }
  });

  it("refuses service credentials that read tenant tables directly", async () => {
    await fixture.unsafe(`grant select on public.project to "${serviceRole}"`);
    try {
      await expect(assertCloudDatabaseSecurity()).rejects.toThrow(/service|tenant/i);
    } finally {
      await fixture.unsafe(`revoke select on public.project from "${serviceRole}"`);
    }
  });

  it("refuses disabled integrity triggers", async () => {
    await fixture`alter table public.feedback_label disable trigger feedback_label_tenant_check`;
    try {
      await expect(assertCloudDatabaseSecurity()).rejects.toThrow(/trigger|integrity/i);
    } finally {
      await fixture`alter table public.feedback_label enable trigger feedback_label_tenant_check`;
    }
  });

  it("requires distinct runtime/service credentials for the same database", async () => {
    vi.stubEnv("PINWREN_SERVICE_DATABASE_URL", runtimeUrl.toString());
    try {
      await expect(assertCloudDatabaseSecurity()).rejects.toThrow(/distinct|different/i);
    } finally {
      vi.stubEnv("PINWREN_SERVICE_DATABASE_URL", serviceUrl.toString());
    }
  });

  it("refuses database CREATE grants", async () => {
    await fixture`grant create on database ${fixture(database)} to ${fixture(runtimeRole)}`;
    try {
      await expect(assertCloudDatabaseSecurity()).rejects.toThrow(/privilege|role/i);
    } finally {
      await fixture`revoke create on database ${fixture(database)} from ${fixture(runtimeRole)}`;
    }
  });

  it("refuses runtime access to unrestricted identity rows", async () => {
    await fixture`grant select on public.session to ${fixture(runtimeRole)}`;
    try {
      await expect(assertCloudDatabaseSecurity()).rejects.toThrow(/identity|privilege/i);
    } finally {
      await fixture`revoke select on public.session from ${fixture(runtimeRole)}`;
    }
  });

  it("refuses an integrity trigger weakened with WHEN false", async () => {
    await fixture`drop trigger feedback_label_tenant_check on public.feedback_label`;
    await fixture`create trigger feedback_label_tenant_check before insert or update on public.feedback_label for each row when (false) execute function public.pinwren_check_feedback_label_tenant()`;
    try {
      await expect(assertCloudDatabaseSecurity()).rejects.toThrow(/trigger|integrity/i);
    } finally {
      await fixture`drop trigger feedback_label_tenant_check on public.feedback_label`;
      await fixture`create trigger feedback_label_tenant_check before insert or update on public.feedback_label for each row execute function public.pinwren_check_feedback_label_tenant()`;
    }
  });

  it("refuses a missing runtime SELECT grant", async () => {
    await fixture`revoke select on public.project from ${fixture(runtimeRole)}`;
    try {
      await expect(assertCloudDatabaseSecurity()).rejects.toThrow(/grant|privilege/i);
    } finally {
      await fixture`grant select on public.project to ${fixture(runtimeRole)}`;
    }
  });

  it("refuses an unreviewed callable security definer function", async () => {
    await fixture`create function public.unreviewed_bypass() returns int language sql security definer as 'select 1'`;
    try {
      await expect(assertCloudDatabaseSecurity()).rejects.toThrow(/definer|privilege/i);
    } finally {
      await fixture`drop function public.unreviewed_bypass()`;
    }
  });

  it("refuses a missing tenant policy", async () => {
    await fixture`drop policy pinwren_tenant on public.org_setting`;
    try {
      await expect(assertCloudDatabaseSecurity()).rejects.toThrow(/policy/i);
    } finally {
      await fixture`create policy pinwren_tenant on public.org_setting for all to public using (org_id=nullif(current_setting('pinwren.org_id',true),'')) with check (org_id=nullif(current_setting('pinwren.org_id',true),''))`;
    }
  });

  it("refuses disabled RLS even when FORCE remains set", async () => {
    await fixture`alter table public.project disable row level security`;
    try {
      await expect(assertCloudDatabaseSecurity()).rejects.toThrow(/RLS/i);
    } finally {
      await fixture`alter table public.project enable row level security`;
    }
  });

  it("refuses runtime membership in the authentication service role", async () => {
    await fixture`grant ${fixture(serviceRole)} to ${fixture(runtimeRole)}`;
    try {
      await expect(assertCloudDatabaseSecurity()).rejects.toThrow(/membership/i);
    } finally {
      await fixture`revoke ${fixture(serviceRole)} from ${fixture(runtimeRole)}`;
    }
  });

  it("refuses broadening the service's token-verification column projection", async () => {
    await fixture`grant select on public.api_token to ${fixture(serviceRole)}`;
    try {
      await expect(assertCloudDatabaseSecurity()).rejects.toThrow(/projection|privilege/i);
    } finally {
      await fixture`revoke select on public.api_token from ${fixture(serviceRole)}`;
    }
  });

  it("refuses tenant access to private authentication profile columns", async () => {
    await fixture`grant select on public."user" to ${fixture(runtimeRole)}`;
    try {
      await expect(assertCloudDatabaseSecurity()).rejects.toThrow(/projection|privilege/i);
    } finally {
      await fixture`revoke select on public."user" from ${fixture(runtimeRole)}`;
    }
  });

  it("refuses broadening the token bootstrap policy to PUBLIC", async () => {
    await fixture`alter policy pinwren_bootstrap_service on public.api_token to public`;
    try {
      await expect(assertCloudDatabaseSecurity()).rejects.toThrow(/policy/i);
    } finally {
      await fixture`alter policy pinwren_bootstrap_service on public.api_token to ${fixture(serviceRole)}`;
    }
  });
});
