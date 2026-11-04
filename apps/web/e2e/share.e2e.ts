import { expect, test, type Page } from "@playwright/test";

// The public share page (report and round), against a mocked API: the token must travel in a header only,
// the fragment must leave the address bar, a password gates the content, and a client can sign off.

test.use({ storageState: { cookies: [], origins: [] } });

const KEY = "pk_share_test";
const TOKEN = "pws_abcdefghijklmnopqrstuvwx0123456789";
const head = {
  project: { name: "Example website", key: KEY },
  branding: { productName: "Pinwren", logoUrl: null, accent: null, hidePoweredBy: false },
  link: { label: "Client review", expiresAt: "2026-12-01T00:00:00Z", canComment: true },
};
const report = {
  kind: "report",
  ...head,
  report: {
    id: "11111111-1111-4111-8111-111111111111",
    number: 7,
    kind: "bug",
    status: "in_progress",
    priority: "high",
    title: "Checkout button is hidden",
    body: "The checkout button is hidden on a small screen.",
    pageUrl: "https://example.com/checkout",
    browser: "Chrome",
    os: "macOS",
    createdAt: "2026-10-27T10:00:00Z",
    screenshot: null,
    replay: null,
    diagnostics: {
      console: {
        errors: 1,
        warnings: 0,
        total: 1,
        entries: [{ level: "error", message: "failed for [email]" }],
      },
      network: {
        total: 2,
        failed: 1,
        entries: [{ method: "POST", url: "https://example.com/pay?…", status: 500, durationMs: 12 }],
      },
    },
  },
  comments: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      body: "We are on it.",
      createdAt: "2026-10-28T10:00:00Z",
      authorName: "Alex",
      team: true,
    },
  ],
};
const round = {
  kind: "round",
  ...head,
  link: { ...head.link, canComment: false },
  round: {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Homepage round 2",
    status: "active",
    dueAt: null,
    counts: { total: 2, open: 1, closed: 1 },
    requireSignoff: true,
  },
  items: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      number: 1,
      kind: "bug",
      status: "resolved",
      priority: "none",
      title: "Logo blurry",
      body: "x",
      pageUrl: null,
    },
  ],
  signoffs: [],
  state: "none",
};

const url = `/share/${KEY}#t=${TOKEN}`;

async function mock(page: Page, body: unknown, opts: { password?: string } = {}) {
  let unlocked = !opts.password;
  await page.route(`**/api/share/${KEY}**`, async (route) => {
    const req = route.request();
    expect(req.url()).not.toContain(TOKEN);
    expect(req.headers()["x-pinwren-share-token"]).toBe(TOKEN);
    const path = new URL(req.url()).pathname;
    if (path.endsWith("/unlock")) {
      const ok = (req.postDataJSON() as { password: string }).password === opts.password;
      unlocked = unlocked || ok;
      return route.fulfill(
        ok
          ? { json: { unlock: "unlock-proof" } }
          : { status: 401, json: { code: "SHARE_PASSWORD_INVALID", title: "That password is not right." } },
      );
    }
    if (path.endsWith("/comments")) {
      const sent = req.postDataJSON() as { body: string; name: string };
      return route.fulfill({
        status: 201,
        json: {
          comment: {
            id: "55555555-5555-4555-8555-555555555555",
            ...sent,
            createdAt: "2026-10-29T10:00:00Z",
            authorName: sent.name,
            team: false,
          },
        },
      });
    }
    if (path.endsWith("/signoff")) {
      const sent = req.postDataJSON() as { decision: string; name: string; note: string };
      expect(sent.decision).toBe("approved");
      return route.fulfill({
        status: 201,
        json: { signoff: { id: "66666666-6666-4666-8666-666666666666", ...sent } },
      });
    }
    if (!unlocked || (opts.password && req.headers()["x-pinwren-share-unlock"] !== "unlock-proof")) {
      return route.fulfill({
        status: 401,
        json: { code: "SHARE_PASSWORD_REQUIRED", title: "This link needs a password." },
      });
    }
    return route.fulfill({ json: body });
  });
}

test("a report opens without signing in and keeps the token out of the address bar", async ({ page }) => {
  await mock(page, report);
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Checkout button is hidden" })).toBeVisible();
  expect(page.url()).not.toContain("pws_");
  await expect(page.getByTestId("share-status")).toContainText("In progress");
  await expect(page.getByTestId("share-console")).toContainText("failed for [email]");
  await expect(page.getByTestId("share-network")).toContainText("500");
  await expect(page.getByTestId("share-comment")).toContainText("We are on it.");
});

test("a visitor can comment when the link allows it", async ({ page }) => {
  await mock(page, report);
  await page.goto(url);
  await page.getByLabel("Your name").fill("Dana");
  await page.getByLabel("Your comment").fill("Looks broken on my phone too.");
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(page.getByText("Thanks, your comment was posted.")).toBeVisible();
});

test("a password-protected link asks for the password first", async ({ page }) => {
  await mock(page, report, { password: "open-sesame" });
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "This link is password protected" })).toBeVisible();
  await page.getByLabel("Password").fill("wrong-one");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText("That password is not right.")).toBeVisible();
  await page.getByLabel("Password").fill("open-sesame");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("heading", { name: "Checkout button is hidden" })).toBeVisible();
});

test("a client approves a round", async ({ page }) => {
  await mock(page, round);
  await page.goto(url);
  await expect(page.getByTestId("share-round")).toContainText("Homepage round 2");
  await expect(page.getByTestId("signoff-badge").first()).toContainText("Awaiting sign-off");
  await page.getByLabel("Your name").fill("Dana Client");
  await page.getByLabel("Your email").fill("dana@client.test");
  await page.getByTestId("signoff-approve").click();
  await expect(page.getByTestId("signoff-sent")).toContainText("you approved this round");
});

test("changes need a note", async ({ page }) => {
  await mock(page, round);
  await page.goto(url);
  await page.getByLabel("Your name").fill("Dana Client");
  await page.getByLabel("Your email").fill("dana@client.test");
  await page.getByTestId("signoff-changes").click();
  await expect(page.getByText("Say what needs to change")).toBeVisible();
});

test("an expired link says so", async ({ page }) => {
  await page.route(`**/api/share/${KEY}**`, (route) =>
    route.fulfill({
      status: 410,
      json: { code: "SHARE_LINK_UNAVAILABLE", title: "This link has expired or was revoked." },
    }),
  );
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "This link is no longer available" })).toBeVisible();
});
