import { expect, test, type Page } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });
const access = { reporterTokens: ["guest_reporter_token_123456"], pageTokens: [] };
const item = {
  id: "11111111-1111-4111-8111-111111111111",
  number: 12,
  kind: "bug",
  status: "in_progress",
  priority: "medium",
  title: "Checkout button is hidden",
  body: "The checkout button is hidden on a small screen.",
  createdAt: "2026-10-27T10:00:00Z",
  pageUrl: "https://example.com/checkout",
  replyCount: 1,
};
const portal = {
  project: { name: "Example website", key: "guest-test", canReply: true },
  branding: { productName: "Pinwren", logoUrl: null, accent: null, hidePoweredBy: false },
  items: [item],
};
const url = `/guest/guest-test#access=${encodeURIComponent(JSON.stringify(access))}`;

async function mockPortal(
  page: Page,
  options: { readOnly?: boolean; empty?: boolean; failed?: boolean } = {},
) {
  let expired = false;
  const replies = [
    {
      id: "22222222-2222-4222-8222-222222222222",
      body: "We are working on a fix.",
      createdAt: "2026-10-28T10:00:00Z",
      authorName: "Alex",
      team: true,
    },
  ];
  await page.route("**/api/guest/guest-test/feedback**", async (route) => {
    expect(route.request().url()).not.toContain(access.reporterTokens[0]);
    expect(route.request().headers()["x-pinwren-reporter-tokens"]).toBe(access.reporterTokens[0]);
    if (expired || options.failed) {
      await route.fulfill({
        status: expired ? 401 : 503,
        json: { code: "UNAVAILABLE", title: "Access unavailable" },
      });
    } else if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { body: string };
      expect(Object.keys(body)).toEqual(["body"]);
      const firstReply = replies[0];
      if (!firstReply) throw new Error("Mock reply fixture is missing");
      const reply = {
        ...firstReply,
        id: "33333333-3333-4333-8333-333333333333",
        body: body.body,
        team: false,
        authorName: "You",
      };
      replies.push(reply);
      await route.fulfill({ status: 201, json: { comment: reply } });
    } else if (route.request().url().endsWith(item.id)) {
      await route.fulfill({ json: { item, replies } });
    } else {
      await route.fulfill({
        json: {
          ...portal,
          project: { ...portal.project, canReply: !options.readOnly },
          items: options.empty ? [] : [item],
        },
      });
    }
  });
  return {
    expire: () => {
      expired = true;
    },
  };
}

test("guest follows a report, replies publicly, reloads and forgets browser access", async ({ page }) => {
  await mockPortal(page);
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Example website" })).toBeVisible();
  await expect(page).toHaveURL(/\/guest\/guest-test$/);
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(0);
  await page.getByRole("button", { name: /Checkout button is hidden/ }).click();
  await expect(page.getByText("We are working on a fix.")).toBeVisible();
  await page.getByLabel("Your reply").fill("Thanks, I can test the fix.");
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText("Thanks, I can test the fix.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Example website" })).toBeVisible();
  await page.getByRole("button", { name: "Forget browser access" }).click();
  await expect(page.getByRole("heading", { name: "Your feedback" })).toBeVisible();
  await expect(page.getByText("Checkout button is hidden")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your feedback" })).toBeVisible();
});

test("mobile layout supports keyboard report selection and search without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockPortal(page);
  await page.goto(url);
  await page.getByLabel("Search your feedback").fill("missing result");
  await expect(page.getByText("No matching reports")).toBeVisible();
  await page.getByLabel("Search your feedback").fill("");
  const report = page.getByRole("button", { name: /Checkout button is hidden/ });
  await report.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Your reply")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("expired access hides the previous list and conversation", async ({ page }) => {
  const mocked = await mockPortal(page);
  await page.goto(url);
  await page.getByRole("button", { name: /Checkout button is hidden/ }).click();
  await expect(page.getByText("We are working on a fix.")).toBeVisible();
  mocked.expire();
  await page.getByLabel("Your reply").fill("This access has expired");
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByRole("heading", { name: "Access unavailable" })).toBeVisible();
  await expect(page.getByText("We are working on a fix.")).toHaveCount(0);
  await expect(page.getByText("Checkout button is hidden")).toHaveCount(0);
});

test("read-only projects explain why replies are unavailable", async ({ page }) => {
  await mockPortal(page, { readOnly: true });
  await page.goto(url);
  await page.getByRole("button", { name: /Checkout button is hidden/ }).click();
  await expect(page.getByText("Replies are disabled for this project.")).toBeVisible();
  await expect(page.getByLabel("Your reply")).toHaveCount(0);
});

test("empty projects and temporary errors have recovery states", async ({ page }) => {
  await mockPortal(page, { empty: true });
  await page.goto(url);
  await expect(page.getByText("No reports yet")).toBeVisible();
});

test("temporary request errors offer a retry without showing private content", async ({ page }) => {
  await mockPortal(page, { failed: true });
  await page.goto(url);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByText("Checkout button is hidden")).toHaveCount(0);
});
