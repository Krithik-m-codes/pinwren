import { clearAuthRateLimits } from "@pinwren/db";
import { test as base, expect } from "@playwright/test";
import { E2E_DATABASE_URL } from "./env";

// Dev-only noise that isn't ours to fix here: Next's instant-navigation validator flags every route
// behind the client-side session gate (AppShell renders children only after the session loads).
const IGNORED = [
  /Could not validate that a segment in your UI has instant navigation/,
  /Download the React DevTools/,
  // The email preview is an iframe with `sandbox=""` (no scripts, by design). Playwright instruments
  // every frame it sees, and Chrome reports that blocked attempt; the page itself runs nothing there.
  /^Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed/,
  // The session replay plays in rrweb's sandboxed iframe (no scripts, by design); Chrome reports every
  // script element of the recorded page it refuses to run.
  /^Blocked script execution in '[^']*' because the document's frame is sandboxed and the 'allow-scripts' permission is not set/,
];

/** Every test fails on a browser console error or uncaught exception (e.g. Base UI misuse warnings). */
export const test = base.extend<{ consoleErrors: string[]; authLimits: undefined }>({
  // The suite signs up and signs in far more often than the auth rate limiter allows one address (20
  // sign-ups per 10 minutes): start every test with a clean allowance instead of loosening the limits.
  authLimits: [
    // eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure their first argument.
    async ({}, use) => {
      await clearAuthRateLimits(E2E_DATABASE_URL);
      await use(undefined);
    },
    { auto: true },
  ],
  // The API refuses cookie-authenticated writes without a same-origin Origin header (CSRF, ADR 0021).
  // Browsers always send it; Playwright's API client doesn't, so the tests' direct API calls add it.
  request: async ({ playwright, baseURL, storageState }, provide) => {
    const origin = new URL(baseURL ?? "http://localhost:3100").origin;
    const ctx = await playwright.request.newContext({
      baseURL: origin,
      ...(storageState ? { storageState } : {}),
      extraHTTPHeaders: { origin },
    });
    await provide(ctx);
    await ctx.dispose();
  },
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("console", (m) => {
        if (m.type() !== "error") return;
        const text = m.text();
        // Expected failures the UI handles (e.g. a 403 for a non-admin screen) still log as resource errors.
        if (text.startsWith("Failed to load resource")) return;
        if (IGNORED.some((r) => r.test(text))) return;
        errors.push(text.slice(0, 500));
      });
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
      await use(errors);
      expect(errors, "browser console errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
