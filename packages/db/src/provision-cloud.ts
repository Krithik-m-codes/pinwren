import postgres from "postgres";
import { validateCloudCatalog } from "./cloud-security";
import { tenantInventory } from "./tenant-inventory";
import { parseCloudDatabaseUrl } from "./cloud-database-url";

export async function provisionCloudDatabase(
  url: string,
  options: { runtimeRole: string; serviceRole: string },
): Promise<void> {
  parseCloudDatabaseUrl(url);
  if (options.runtimeRole === options.serviceRole) throw new Error("Cloud roles must be distinct");
  const db = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await db.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(72000021)`;
      const [database] = await tx<{ name: string }[]>`select current_database() as name`;
      if (!database) throw new Error("Cannot resolve provisioning database");
      for (const role of [options.runtimeRole, options.serviceRole]) {
        const [entry] = await tx<
          { unsafe: boolean }[]
        >`select (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication) as unsafe from pg_roles where rolname=${role}`;
        if (!entry || entry.unsafe)
          throw new Error("Provisioning requires existing unprivileged runtime and service roles");
      }
      await tx`revoke create on schema public from public`;
      for (const role of [options.runtimeRole, options.serviceRole]) {
        await tx`revoke all on all tables in schema public from ${tx(role)}`;
        await tx`revoke create on schema public from ${tx(role)}`;
        await tx`grant usage on schema public to ${tx(role)}`;
        await tx`grant connect on database ${tx(database.name)} to ${tx(role)}`;
      }
      await tx`revoke all on all tables in schema public from public`;
      for (const entry of tenantInventory) {
        if (entry.ownership === "direct" || entry.ownership === "parent") {
          await tx`alter table public.${tx(entry.table)} enable row level security`;
          await tx`alter table public.${tx(entry.table)} force row level security`;
          await tx`grant select,insert,update,delete on public.${tx(entry.table)} to ${tx(options.runtimeRole)}`;
        } else {
          await tx`grant select,insert,update,delete on public.${tx(entry.table)} to ${tx(options.serviceRole)}`;
        }
      }
      // Validate under each actual role before committing any grant or activation changes.
      for (const [role, kind] of [
        [options.runtimeRole, "runtime"],
        [options.serviceRole, "service"],
      ] as const) {
        await tx`set local role ${tx(role)}`;
        await validateCloudCatalog(tx, kind);
        await tx`reset role`;
      }
    });
  } finally {
    await db.end();
  }
}
