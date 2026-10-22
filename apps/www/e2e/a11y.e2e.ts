import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { setTheme } from "./helpers";

const PAGES = [
  "/",
  "/demo",
  "/demo/inbox",
  "/pricing",
  "/changelog",
  "/docs",
  "/docs/widget/configuration",
  "/docs/self-hosting/environment",
  "/legal/privacy",
];

for (const theme of ["light", "dark"] as const) {
  for (const path of PAGES) {
    test(`${path} has no serious accessibility violations (${theme})`, async ({ page }) => {
      await setTheme(page, theme);
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const results = await new AxeBuilder({ page })
        // The demo widget lives in a closed Shadow DOM and has its own accessibility tests in packages/widget.
        .exclude("pinwren-root")
        .analyze();
      const serious = results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map(
          (v) =>
            `${v.id}: ${v.help} — ${v.nodes
              .slice(0, 5)
              .map((n) => n.target.join(" "))
              .join(", ")}`,
        );
      expect(serious).toEqual([]);
    });
  }
}
