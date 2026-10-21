import { defineConfig, devices } from "@playwright/test";

// Widget E2E: a static fixture page on :5180 loads the built widget.js; the API is mocked per test with
// page.route (e2e/mock.ts). Run `node build.mjs` first.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.e2e.ts",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  workers: 3,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:5180",
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node e2e/server.mjs",
    url: "http://localhost:5180/",
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});
