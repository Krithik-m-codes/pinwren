import { expect, test } from "@playwright/test";
import { mockApi } from "./mock";

test("saved reporter access opens the guest portal by keyboard with credentials only in its fragment", async ({
  page,
  context,
}) => {
  await mockApi(page, { widget: { readOnly: true } });
  await context.route("**/guest/pk_test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<title>Guest feedback</title>" }),
  );
  await page.addInitScript(() => {
    localStorage.setItem(
      "pinwren:mine:pk_test",
      JSON.stringify([{ id: "saved-feedback", token: "reporter_token_0123456789" }]),
    );
  });
  await page.goto("/");
  await page.locator("pinwren-root .launcher").click();
  await page.getByRole("menuitem", { name: /Show sidebar/ }).click();
  const link = page.getByRole("link", { name: "Open my feedback" });
  await expect(link).toBeVisible();
  await link.focus();
  const popupPromise = page.waitForEvent("popup");
  await page.keyboard.press("Enter");
  const popup = await popupPromise;
  await popup.waitForURL("**/guest/pk_test#access=*");
  const url = new URL(popup.url());
  expect(url.origin + url.pathname).toBe("http://localhost:5180/guest/pk_test");
  expect(url.search).toBe("");
  expect(JSON.parse(decodeURIComponent(url.hash.slice(8)))).toEqual({
    reporterTokens: ["reporter_token_0123456789"],
    pageTokens: [],
  });
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);
});
