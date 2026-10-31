import postgres from "postgres";
import { validateCloudCatalog } from "./cloud-security";
import { tenantInventory, isTenantProtected } from "./tenant-inventory";
import { expectedTenantPolicies } from "./tenant-policies";
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
        if (isTenantProtected(entry)) {
          await tx`alter table public.${tx(entry.table)} enable row level security`;
          await tx`alter table public.${tx(entry.table)} force row level security`;
          if (entry.runtimeColumns) {
            await tx`grant select (${tx([...entry.runtimeColumns])}) on public.${tx(entry.table)} to ${tx(options.runtimeRole)}`;
          } else {
            await tx`grant select,insert,update,delete on public.${tx(entry.table)} to ${tx(options.runtimeRole)}`;
          }
          for (const policy of expectedTenantPolicies(entry, options.serviceRole).filter(
            (value) => value.name !== "pinwren_tenant",
          )) {
            const existing =
              await tx`select 1 from pg_policies where schemaname='public' and tablename=${entry.table} and policyname=${policy.name}`;
            if (existing.length) continue;
            if (policy.command === "ALL") {
              if (entry.systemNull) {
                await tx`create policy ${tx(policy.name)} on public.${tx(entry.table)} for all to ${tx(options.serviceRole)} using (org_id is null) with check (org_id is null)`;
              } else {
                await tx`create policy ${tx(policy.name)} on public.${tx(entry.table)} for all to ${tx(options.serviceRole)} using (true) with check (true)`;
              }
            } else {
              await tx`create policy ${tx(policy.name)} on public.${tx(entry.table)} for select to ${tx(options.serviceRole)} using (true)`;
            }
          }
          if (entry.ownership === "identity" || entry.systemNull) {
            await tx`grant select,insert,update,delete on public.${tx(entry.table)} to ${tx(options.serviceRole)}`;
          } else if (entry.bootstrapColumns) {
            await tx`grant select (${tx([...entry.bootstrapColumns])}) on public.${tx(entry.table)} to ${tx(options.serviceRole)}`;
          }
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
        await validateCloudCatalog(tx, kind, options.serviceRole);
        await tx`reset role`;
      }
    });
  } finally {
    await db.end();
  }
}
