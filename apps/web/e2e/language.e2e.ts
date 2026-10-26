import { expect, test } from "./fixtures";

// Dashboard language: the choice is saved on the account, the server renders in it, and "Automatic" goes
// back to the browser's language. The suite shares one account, so every test puts it back.

test.afterEach(async ({ request }) => {
  await request.patch("/api/me/preferences", { data: { locale: null } });
});

test("choosing a language translates the dashboard and survives a reload", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByTestId("my-work")).toHaveText("My work");

  await page.getByRole("combobox", { name: "Language" }).click();
  await page.getByRole("option", { name: "Deutsch" }).click();

  await expect(page.getByTestId("my-work")).toHaveText("Meine Aufgaben");
  await expect(page.getByRole("combobox", { name: "Sprache" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");

  await page.reload();
  await expect(page.getByTestId("my-work")).toHaveText("Meine Aufgaben");

  await page.getByRole("combobox", { name: "Sprache" }).click();
  await page.getByRole("option", { name: "Automatisch (Browser)" }).click();
  await expect(page.getByTestId("my-work")).toHaveText("My work");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("an account with no choice follows the browser's language", async ({ browser }) => {
  const context = await browser.newContext({
    storageState: "e2e/.auth/admin.json",
    locale: "es-ES",
    extraHTTPHeaders: { origin: "http://localhost:3100" },
  });
  const page = await context.newPage();
  await page.goto("/inbox");
  await expect(page.getByTestId("my-work")).toHaveText("Mi trabajo");
  await context.close();
});
