import { provisionCloudJobQueues } from "./provision";

const migration = process.env.PINWREN_MIGRATION_DATABASE_URL;
const runtime = process.env.DATABASE_URL;
const service = process.env.PINWREN_SERVICE_DATABASE_URL;
if (!migration || !runtime || !service) {
  throw new Error(
    "Queue provisioning requires PINWREN_MIGRATION_DATABASE_URL, DATABASE_URL and PINWREN_SERVICE_DATABASE_URL",
  );
}
await provisionCloudJobQueues(migration, runtime, service);
console.info(
  "Cloud queues provisioned offline. Keep migration credentials out of the application environment.",
);
