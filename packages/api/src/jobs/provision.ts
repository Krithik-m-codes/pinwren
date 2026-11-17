import { PgBoss } from "pg-boss";
import postgres from "postgres";
import { parseCloudDatabaseUrl, sameDatabaseEndpoint } from "@pinwren/db/cloud-database-url";
import { validateCloudCatalog } from "@pinwren/db/cloud-security";
import { QUEUES, QUEUE_OPTIONS } from "./definitions";
import { CRON_QUEUE, protectQueueTopology, validateQueueCatalog } from "./queue-security";

/** Offline only. Queue payloads are global infrastructure data, never exposed to the tenant role. */
export async function provisionCloudJobQueues(migrationUrl: string, runtimeUrl: string, serviceUrl: string) {
  const owner = parseCloudDatabaseUrl(migrationUrl);
  const runtime = parseCloudDatabaseUrl(runtimeUrl);
  const service = parseCloudDatabaseUrl(serviceUrl);
  if (![runtime, service].every((url) => sameDatabaseEndpoint(owner, url))) {
    throw new Error("Queue provisioning connections must name the same database endpoint");
  }
  const ownerRole = decodeURIComponent(owner.username);
  const runtimeRole = decodeURIComponent(runtime.username);
  const serviceRole = decodeURIComponent(service.username);
  if (
    !ownerRole ||
    !runtimeRole ||
    !serviceRole ||
    new Set([ownerRole, runtimeRole, serviceRole]).size !== 3
  ) {
    throw new Error("Queue provisioning requires distinct owner, runtime and service roles");
  }
  const db = postgres(migrationUrl, { max: 1, onnotice: () => undefined });
  const installer = new PgBoss({
    connectionString: migrationUrl,
    schema: "pgboss",
    supervise: false,
    schedule: false,
  });
  installer.on("error", (error) => console.error("[pinwren] queue provisioning error", error));
  try {
    for (const role of [runtimeRole, serviceRole]) {
      const [entry] =
        await db`select (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication) unsafe from pg_roles where rolname=${role}`;
      if (!entry || entry.unsafe)
        throw new Error("Queue provisioning requires existing unprivileged application roles");
    }
    await db`select pg_advisory_lock(72000022)`;
    try {
      // Refuse inherited or historical dangerous grants before the owner can run queued migration SQL.
      for (const [role, kind] of [
        [runtimeRole, "runtime"],
        [serviceRole, "service"],
      ] as const) {
        await db.begin(async (tx) => {
          await tx`set local role ${tx(role)}`;
          await validateCloudCatalog(tx, kind, serviceRole);
          await validateQueueCatalog(tx, kind);
        });
      }
      await protectQueueTopology(db);
      await installer.start();
      for (const name of Object.values(QUEUES)) await installer.createQueue(name, QUEUE_OPTIONS[name]);
      await installer.createQueue(CRON_QUEUE);
      // Upgrades enqueue concurrent index builds in BAM. Only the offline owner runs them.
      const deadline = Date.now() + 600_000;
      for (;;) {
        const status = await installer.getBamStatus();
        if (!installer.isBamWorking() && status.some((s) => s.status === "failed" && s.count > 0)) {
          throw new Error("Cloud queue index migration failed; inspect pg-boss BAM offline");
        }
        if (
          !installer.isBamWorking() &&
          !status.some((s) => (s.status === "pending" || s.status === "in_progress") && s.count > 0)
        )
          break;
        if (Date.now() >= deadline)
          throw new Error("Cloud queue index migration timed out; inspect pg-boss BAM offline");
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
      }
      await protectQueueTopology(db);
      await db.begin(async (tx) => {
        await tx`revoke all on schema pgboss from public`;
        await tx`revoke all on all tables in schema pgboss from public`;
        await tx`revoke all on all functions in schema pgboss from public`;
        for (const role of [runtimeRole, serviceRole]) {
          await tx`revoke all on schema pgboss from ${tx(role)}`;
          await tx`revoke all on all tables in schema pgboss from ${tx(role)}`;
          await tx`revoke all on all functions in schema pgboss from ${tx(role)}`;
        }
        await tx`grant usage on schema pgboss to ${tx(serviceRole)}`;
        await tx`grant select,insert,update,delete on all tables in schema pgboss to ${tx(serviceRole)}`;
        await tx`grant execute on all functions in schema pgboss to ${tx(serviceRole)}`;
        // The offline migration worker executes commands from bam as the schema owner. Application
        // credentials must never be able to submit DDL there, or rewrite the schema version marker.
        await tx`revoke all on pgboss.bam,pgboss.version from ${tx(serviceRole)}`;
        await tx`grant select on pgboss.version to ${tx(serviceRole)}`;
        await tx`grant update (cron_on,flow_on,monitor_backoff_on) on pgboss.version to ${tx(serviceRole)}`;
        for (const [role, kind] of [
          [runtimeRole, "runtime"],
          [serviceRole, "service"],
        ] as const) {
          await tx`set local role ${tx(role)}`;
          await validateCloudCatalog(tx, kind, serviceRole);
          await validateQueueCatalog(tx, kind);
          await tx`reset role`;
        }
      });
    } finally {
      await db`select pg_advisory_unlock(72000022)`;
    }
  } finally {
    await installer.stop({ graceful: false });
    await db.end();
  }
}
