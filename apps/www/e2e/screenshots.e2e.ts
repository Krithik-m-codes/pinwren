import { expect, test } from "@playwright/test";
import { openWidgetShadow, setTheme, SHOTS } from "./helpers";

// Full-page captures for visual review (untracked): e2e/__screenshots__/<page>-<width>-<theme>.png.
const PAGES = [
  { name: "landing", path: "/" },
  { name: "docs", path: "/docs/widget/configuration" },
  { name: "docs-index", path: "/docs" },
  { name: "demo", path: "/demo" },
  { name: "inbox", path: "/demo/inbox" },
  { name: "pricing", path: "/pricing" },
  { name: "changelog", path: "/changelog" },
];

for (const width of [1440, 375]) {
  for (const theme of ["light", "dark"] as const) {
    for (const p of PAGES) {
      test(`${p.name} ${width} ${theme}`, async ({ page }) => {
        await setTheme(page, theme);
        await openWidgetShadow(page);
        await page.setViewportSize({ width, height: width > 400 ? 900 : 812 });
        await page.goto(p.path);
        await page.waitForLoadState("networkidle");
        if (p.path === "/demo") await expect(page.locator("pinwren-root .launcher")).toBeVisible();
        // No horizontal page scroll at any width.
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        await page.screenshot({
          path: `${SHOTS}${p.name}-${width}-${theme}.png`,
          fullPage: true,
          animations: "disabled",
        });
      });
    }
  }
}
