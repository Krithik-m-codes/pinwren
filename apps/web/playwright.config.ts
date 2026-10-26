import { defineConfig, devices } from "@playwright/test";

// Dashboard E2E against the real app + API on :3100 and the dev Postgres (127.0.0.1:5433).
// `e2e/seed.ts` signs up an admin, creates a fresh workspace + project and posts feedback through the
// widget API; every spec reuses that session. Screens are captured light and dark into
// e2e/__screenshots__/ for visual review.
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.e2e.ts",
  // The fresh-install journey wipes and restarts its own server: run it with -c playwright.journey.config.ts.
  testIgnore: "journey.e2e.ts",
  timeout: 60_000,
  // CI: fail with a summary instead of being cancelled silently by the job timeout if anything hangs.
  // `next dev` compiles each route on first visit, which is slow on a shared runner: allow it more time
  // and one more go (a retried pass is reported as flaky, so it stays visible).
  ...(process.env.CI ? { globalTimeout: 40 * 60_000, retries: 2 } : {}),
  expect: { timeout: process.env.CI ? 20_000 : 10_000 },
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
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    // The same flags as the API smoke (CLAUDE.md), so a server Playwright starts itself (CI) behaves like
    // the one developers usually reuse locally.
    env: {
      PINWREN_ADMIN_EMAILS: "smoke-admin@example.com,e2e-admin@example.com",
      // The seed signs up fresh accounts; sign-up is otherwise closed after the first one (ADR 0021).
      PINWREN_DISABLE_SIGNUP: "false",
      // Webhook, panel-action and tracker specs post to receivers on 127.0.0.1, which the outbound guard
      // refuses unless allowed.
      PINWREN_OUTBOUND_ALLOWLIST: "127.0.0.1",
      PINWREN_TRUST_PROXY: "1",
    },
  },
});
