import { expect, type Page, test } from "@playwright/test";
import { mockApi } from "./mock";

// Screenshot quality: the project's setting decides how big the sent screenshot is, and the reporter's
// "Reduce capture quality" switch sends one report small whatever the setting.

const report = (page: Page) => page.getByRole("dialog", { name: "Report a bug" });
const toast = (page: Page) => page.locator("pinwren-root .toast").last();

async function openReport(page: Page) {
  await page.goto("/");
  await expect(page.locator("pinwren-root .launcher")).toBeVisible();
  await page.locator("pinwren-root .launcher").click();
  await page.getByRole("menuitem", { name: /Report a bug/ }).click();
  await expect(report(page)).toBeVisible();
  await expect(page.locator("pinwren-root .ed canvas")).toBeVisible();
}

/** Send one report and return the decoded size of its screenshot. */
async function send(page: Page, mock: Awaited<ReturnType<typeof mockApi>>) {
  await report(page).getByLabel("Describe the bug").fill("Quality check");
  await report(page).getByRole("button", { name: "Send report" }).click();
  await expect(toast(page)).toContainText("#1 sent");
  const dataUrl = mock.items[0]?.payload?.screenshot as string;
  expect(dataUrl).toMatch(/^data:image\/(webp|jpeg);base64,/);
  return page.evaluate(
    (u) =>
      new Promise<{ w: number; bytes: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, bytes: u.length });
        img.onerror = () => reject(new Error("screenshot did not decode"));
        img.src = u;
      }),
    dataUrl,
  );
}

test.use({ viewport: { width: 1600, height: 900 } });

test("the switch is offered by default and sends a smaller screenshot", async ({ page }) => {
  const mock = await mockApi(page, {});
  await openReport(page);
  const sw = report(page).getByRole("switch", { name: "Reduce capture quality" });
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "true");
  const small = await send(page, mock);
  expect(small.w).toBeLessThanOrEqual(1280);
});

test("without the switch the screenshot keeps the project's size", async ({ page }) => {
  const mock = await mockApi(page, {});
  await openReport(page);
  const big = await send(page, mock);
  expect(big.w).toBeGreaterThan(1280);
});

test("a project can turn the switch off, and a low project quality shrinks every screenshot", async ({
  page,
}) => {
  const mock = await mockApi(page, { capture: { allowReduceQuality: false, quality: "low" } });
  await openReport(page);
  await expect(report(page).getByRole("switch", { name: "Reduce capture quality" })).toHaveCount(0);
  const low = await send(page, mock);
  expect(low.w).toBeLessThanOrEqual(1280);
});
