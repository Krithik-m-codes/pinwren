import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const url = process.env.PINWREN_ISOLATION_ADMIN_URL;
if (!url || !new URL(url).pathname.includes("isolation")) {
  console.error("Set PINWREN_ISOLATION_ADMIN_URL to a disposable PostgreSQL isolation database.");
  process.exit(1);
}
const require = createRequire(new URL("../packages/api/package.json", import.meta.url));
const vitest = resolve(dirname(require.resolve("vitest/package.json")), "vitest.mjs");
const result = spawnSync(
  process.execPath,
  [
    vitest,
    "run",
    "--root",
    "packages/api",
    "--no-file-parallelism",
    "--hookTimeout",
    "120000",
    "src/tenant-entrypoints.test.ts",
    "src/tenant-context.test.ts",
    "src/tenant-context-db.test.ts",
    "src/tenant-request-db.test.ts",
    "src/tenant-isolation.test.ts",
    "src/tenant-migration-db.test.ts",
    "src/cloud-configuration.test.ts",
    "src/cloud-startup.test.ts",
    "src/cloud-security-db.test.ts",
    "src/cloud-identity-db.test.ts",
    "src/cloud-api-db.test.ts",
    "src/cloud-public-db.test.ts",
    "src/cloud-routes-db.test.ts",
    "src/cloud-routes-public-db.test.ts",
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PINWREN_TEST_DATABASE_URL: url },
  },
);
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
