import { test as base, expect } from "@playwright/test";

// Dev-only noise that isn't ours to fix here: Next's instant-navigation validator flags every route
// behind the client-side session gate (AppShell renders children only after the session loads).
const IGNORED = [
  /Could not validate that a segment in your UI has instant navigation/,
  /Download the React DevTools/,
];

/** Every test fails on a browser console error or uncaught exception (e.g. Base UI misuse warnings). */
export const test = base.extend<{ consoleErrors: string[] }>({
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
