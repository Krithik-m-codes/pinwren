import { resolve } from "node:path";
import { env, startJobs } from "@annota/api";
import { runMigrations } from "@annota/db/migrate";

// Validate configuration and bring the schema up to date before the first request.
if (process.env.ANNOTA_SKIP_MIGRATIONS !== "true") {
  const { DATABASE_URL } = env();
  // apps/web in development; the Docker image sets ANNOTA_MIGRATIONS_DIR.
  const dir = process.env.ANNOTA_MIGRATIONS_DIR ?? resolve(process.cwd(), "../../packages/db/drizzle");
  await runMigrations(DATABASE_URL, dir);
  console.log("[annota] database migrations applied");
}

// Background jobs (notifications, webhooks, retention) run in every server process; pg-boss hands
// each job to one of them. Not awaited: a queue problem must never keep the server from starting.
void startJobs();
