import { defineConfig, devices } from "@playwright/test";

// Dashboard E2E against the real app + API on :3100 and the dev Postgres (127.0.0.1:5433).
// `e2e/seed.ts` signs up an admin, creates a fresh workspace + project and posts feedback through the
// widget API; every spec reuses that session. Screens are captured light and dark into
// e2e/__screenshots__/ for visual review.
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.e2e.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // One workspace is shared, and some flows (board moves, bulk edits) change the same items.
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./e2e/seed.ts",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: BASE,
    viewport: { width: 1440, height: 900 },
    storageState: "e2e/.auth/admin.json",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm exec next dev -p 3100",
    url: `${BASE}/api/health`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { PINWREN_ADMIN_EMAILS: "smoke-admin@example.com,e2e-admin@example.com" },
  },
});
