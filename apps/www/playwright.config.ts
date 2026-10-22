import { defineConfig, devices } from "@playwright/test";

// Website E2E on :3200 against a production build (`next build && next start`), or an already running
// `pnpm dev` on the same port. No database and no Docker: the demo API is in memory.
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3200";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.e2e.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 3,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: BASE,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm build && pnpm start",
    url: `${BASE}/robots.txt`,
    reuseExistingServer: true,
    timeout: 300_000,
  },
});
