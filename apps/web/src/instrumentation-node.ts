import http from "node:http";
import { resolve } from "node:path";
import {
  checkReleaseKeys,
  ensureInstanceAdmin,
  env,
  installPeerStamp,
  runStartupFixes,
  startJobs,
  assertCloudDatabaseSecurity,
} from "@pinwren/api";
import { runMigrations } from "@pinwren/db/migrate";

// Every request carries its TCP peer address under a per-process secret header name, so rate limits can
// use the real socket address when no trusted proxy is configured (ADR 0021). Runs before the server
// accepts requests.
installPeerStamp(http);

// Validate configuration and bring the schema up to date before the first request.
const configuration = env();
if (configuration.PINWREN_MODE === "cloud") {
  // Cloud migrations and provisioning run separately with credentials absent from this process.
  // This guard is awaited even when PINWREN_SKIP_MIGRATIONS is set.
  await assertCloudDatabaseSecurity();
} else if (process.env.PINWREN_SKIP_MIGRATIONS !== "true") {
  const { DATABASE_URL } = env();
  // apps/web in development; the Docker image sets PINWREN_MIGRATIONS_DIR.
  const dir = process.env.PINWREN_MIGRATIONS_DIR ?? resolve(process.cwd(), "../../packages/db/drizzle");
  await runMigrations(DATABASE_URL, dir);
  console.log("[pinwren] database migrations applied");
}

checkReleaseKeys();
// Not awaited: neither may hold up the first request.
void runStartupFixes();
void ensureInstanceAdmin();

// Background jobs (notifications, webhooks, retention) run in every server process; pg-boss hands
// each job to one of them. Not awaited: a queue problem must never keep the server from starting.
void startJobs();
