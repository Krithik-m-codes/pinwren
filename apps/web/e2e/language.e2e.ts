import { expect, test } from "./fixtures";

// Dashboard language: the choice is saved on the account, the server renders in it, and "Automatic" goes
// back to the browser's language. The suite shares one account, so every test puts it back.
// Switching re-renders the page on the server, which `next dev` does slowly: give those checks more time.
const SLOW = { timeout: 30_000 };

test.afterEach(async ({ request }) => {
  await request.patch("/api/me/preferences", { data: { locale: null } });
});

test("choosing a language translates the dashboard and survives a reload", async ({ page }) => {
  await page.goto("/settings");
  // A cold dev server streams the page in: wait for the one real sidebar link before reading it.
  await expect(page.getByTestId("my-work")).toHaveCount(1, { timeout: 60_000 });
  await expect(page.getByTestId("my-work")).toHaveText("My work", SLOW);

  await page.getByRole("combobox", { name: "Language" }).click();
  await page.getByRole("option", { name: "Deutsch" }).click();

  await expect(page.getByTestId("my-work")).toHaveText("Meine Aufgaben", SLOW);
  await expect(page.getByRole("combobox", { name: "Sprache" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "de", SLOW);

  await page.reload();
  await expect(page.getByTestId("my-work")).toHaveText("Meine Aufgaben", SLOW);

  await page.getByRole("combobox", { name: "Sprache" }).click();
  await page.getByRole("option", { name: "Automatisch (Browser)" }).click();
  await expect(page.getByTestId("my-work")).toHaveText("My work", SLOW);
  await expect(page.locator("html")).toHaveAttribute("lang", "en", SLOW);
});

test("an account with no choice follows the browser's language", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    storageState: "e2e/.auth/admin.json",
    locale: "es-ES",
    extraHTTPHeaders: { origin: new URL(baseURL ?? "http://localhost:3100").origin },
  });
  const page = await context.newPage();
  await page.goto("/inbox");
  await expect(page.getByTestId("my-work")).toHaveText("Mi trabajo", SLOW);
  await context.close();
});
