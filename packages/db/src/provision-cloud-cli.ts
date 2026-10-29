import { provisionCloudDatabase } from "./provision-cloud";
import { parseCloudDatabaseUrl, sameDatabaseEndpoint } from "./cloud-database-url";

const migrationUrl = process.env.PINWREN_MIGRATION_DATABASE_URL;
const runtimeUrl = process.env.DATABASE_URL;
const serviceUrl = process.env.PINWREN_SERVICE_DATABASE_URL;
if (!migrationUrl || !runtimeUrl || !serviceUrl) {
  throw new Error(
    "Cloud provisioning requires PINWREN_MIGRATION_DATABASE_URL, DATABASE_URL and PINWREN_SERVICE_DATABASE_URL",
  );
}
const migration = parseCloudDatabaseUrl(migrationUrl),
  runtime = parseCloudDatabaseUrl(runtimeUrl),
  service = parseCloudDatabaseUrl(serviceUrl);
for (const target of [runtime, service]) {
  if (!sameDatabaseEndpoint(target, migration)) {
    throw new Error("Provisioning connections must name the same database endpoint");
  }
}
const runtimeRole = decodeURIComponent(runtime.username),
  serviceRole = decodeURIComponent(service.username);
if (!runtimeRole || !serviceRole)
  throw new Error("Provisioning URLs must name existing runtime and service roles");
await provisionCloudDatabase(migrationUrl, { runtimeRole, serviceRole });
console.info(
  "Cloud database isolation provisioned. Remove migration credentials from the runtime environment.",
);
