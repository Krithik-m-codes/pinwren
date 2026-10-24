import { defineConfig, devices } from "@playwright/test";

// The owner's journey on a FRESH instance (e2e/journey.e2e.ts): first account, workspace, project, the
// install snippet on a real customer page, SMTP settings, widget feedback, live inbox and bell, users and
// password reset. Start the server yourself against an empty database, with no PINWREN_ADMIN_EMAILS and
// sign-up left at its default, so it behaves like a self-hoster's first boot:
//   DATABASE_URL=postgres://…/pinwren_journey PINWREN_URL=http://localhost:3100 pnpm exec next dev -p 3100
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "journey.e2e.ts",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Outside the app: `next dev` watches apps/web, and trace files written there recompile and refresh the
  // pages under test.
  outputDir: "../../node_modules/.cache/journey-results",
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: BASE,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
});
