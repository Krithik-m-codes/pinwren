import { defineConfig, devices } from "@playwright/test";

// One end-to-end check of @pinwren/react in a real browser: a tiny React app (e2e/fixture/app.tsx, bundled
// with esbuild by the test) loads the built widget. Everything — the page, the bundle, widget.js and the
// mocked /w API — is served through page.route on a fake origin, so no server or port is needed.
// Run `pnpm --filter @pinwren/widget build` first.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.e2e.ts",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, trace: "retain-on-failure" },
});
