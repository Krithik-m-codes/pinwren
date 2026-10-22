import { expect, test } from "@playwright/test";

test("sidebar navigation and next-page link", async ({ page }) => {
  await page.goto("/docs");
  await expect(page.getByRole("heading", { level: 1, name: "Introduction" })).toBeVisible();
  const sidebar = page.locator("#nd-sidebar");
  await sidebar.getByRole("link", { name: "Quickstart", exact: true }).click();
  await expect(page).toHaveURL(/\/docs\/quickstart$/);
  await expect(page.getByRole("heading", { level: 1, name: "Quickstart" })).toBeVisible();

  // The page footer links on to the next page in the sidebar order.
  const footerNext = page.locator("a[href='/docs/self-hosting']:visible").last();
  await expect(footerNext).toBeVisible();
  await footerNext.click();
  await expect(page).toHaveURL(/\/docs\/self-hosting$/);
});

test("search finds pages from the static index", async ({ page }) => {
  await page.goto("/docs");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox", { name: "Search" }).fill("webhook signature");
  const result = dialog.getByRole("option", { name: /Webhooks/ }).first();
  await expect(result).toBeVisible();
  await result.click();
  await expect(page).toHaveURL(/\/docs\/integrations\/webhooks/);
});

test("search opens from the marketing header", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Search docs/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("the environment reference is generated from the server's schema", async ({ page }) => {
  await page.goto("/docs/self-hosting/environment");
  for (const name of [
    "PINWREN_URL",
    "PINWREN_SECRET",
    "DATABASE_URL",
    "STORAGE_DRIVER",
    "SMTP_HOST",
    "PINWREN_WORKERS",
  ]) {
    await expect(page.locator(`#env-${name}`)).toBeVisible();
  }
});
