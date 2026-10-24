import { expect, type Page, test } from "@playwright/test";
import { anchorFor, linkToken, mockApi, seed } from "./mock";

// Wave 5, widget data (docs/contracts/wave-5.md §3.3): private pins for their reporter, signed page links,
// re-pin mode, page-level comments, host metadata, visibility modes, screenshot with every comment, error
// texts and the network log. Driven through the public API where the launcher UI isn't the subject.

type Api = {
  open: (mode?: string) => void;
  show: () => void;
  hide: () => void;
  setMetadata: (m: Record<string, unknown> | null) => void;
};

async function ready(page: Page, url = "/") {
  await page.goto(url);
  await expect(page.locator("pinwren-root")).toBeAttached();
  await page.waitForFunction(() => !!(window as unknown as { Pinwren?: unknown }).Pinwren);
}

const call = (page: Page, fn: (api: Api) => void) => page.evaluate(`(${fn.toString()})(window.Pinwren)`);

const composer = (page: Page) => page.getByRole("dialog", { name: "New comment" });
const hero = anchorFor("hero-title", "h1", "Small-batch coffee", { xPct: 50, yPct: 50 });

/** The reporter tokens this browser holds, as the widget stores them. */
const remember = (page: Page, mine: { id: string; token: string }[]) =>
  page.addInitScript((m) => localStorage.setItem("pinwren:mine:pk_test", JSON.stringify(m)), mine);

test("private pins: the reporter still sees their own item and its replies", async ({ page }) => {
  const own = seed({ number: 7, body: "My own note", anchor: hero, token: "tok_7" });
  own.replies.push({
    id: "c1",
    body: "Thanks, fixed",
    createdAt: new Date().toISOString(),
    authorName: "Team",
    team: true,
  });
  own.replyCount = 1;
  const other = seed({ number: 8, body: "Someone else's", anchor: hero, token: "tok_8" });
  const mock = await mockApi(page, { publicRead: false, items: [own, other] });
  await remember(page, [{ id: own.id, token: "tok_7" }]);
  await ready(page);

  await expect
    .poll(() => mock.requests.find((r) => r.path.startsWith("/mine"))?.headers["x-pinwren-reporter-tokens"])
    .toBe("tok_7");
  await call(page, (api) => api.open("panel"));
  await expect(page.locator("pinwren-root").getByText("My own note").first()).toBeVisible();
  await expect(page.locator("pinwren-root").getByText("Someone else's")).toHaveCount(0);

  await page.locator("pinwren-root").getByText("My own note").first().click();
  await expect(page.locator("pinwren-root").getByText("Thanks, fixed")).toBeVisible();
  const replies = mock.requests.find((r) => r.path === `/feedback/${own.id}/comments`);
  expect(replies?.headers["x-pinwren-reporter-token"]).toBe("tok_7");
});

test("a signed page link opens a private item's thread; an expired one says so", async ({ page }) => {
  const item = seed({ number: 3, body: "Logo is blurry", anchor: hero });
  await mockApi(page, { publicRead: false, items: [item] });
  await ready(page, `/?pinwren=${item.id}&pwt=${linkToken(item.id)}`);
  await expect(page.locator("pinwren-root .card.thread")).toBeVisible();
  await expect(page.locator("pinwren-root .card.thread")).toContainText("Logo is blurry");

  await ready(page, `/?pinwren=${item.id}&pwt=forged`);
  await expect(page.locator("pinwren-root .toast")).toContainText("expired");
});

test("re-pin link: the next click moves the pin and the old anchor is replaced", async ({ page }) => {
  const item = seed({ number: 3, body: "Wrong spot", anchor: hero });
  const mock = await mockApi(page, { publicRead: false, items: [item] });
  await ready(page, `/?pinwren=${item.id}&pwt=${linkToken(item.id, "repin")}`);
  await expect(page.locator("pinwren-root .repin")).toContainText("#3");

  const b = await page.getByTestId("guji").boundingBox();
  if (!b) throw new Error("no box");
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect
    .poll(() => mock.requests.find((r) => r.method === "PATCH" && r.path.endsWith("/anchor")))
    .toBeTruthy();
  const sent = mock.requests.find((r) => r.method === "PATCH" && r.path.endsWith("/anchor"));
  expect(sent?.headers["x-pinwren-link-token"]).toBe(linkToken(item.id, "repin"));
  // The click lands on the card's text, so the new anchor is that element, found under the card.
  expect((sent?.body as { anchor: { css?: string } }).anchor.css).toMatch(/^\[data-testid="guji"\] /);
  await expect(page.locator("pinwren-root .repin")).toHaveCount(0);
});

test("comment on the whole page, with host metadata, lists as page-level", async ({ page }) => {
  const mock = await mockApi(page);
  await ready(page);
  await call(page, (api) => api.setMetadata({ plan: "pro", accountId: 42 }));
  await call(page, (api) => api.open("page"));
  await composer(page).getByRole("textbox", { name: "Your comment" }).fill("The whole page feels slow");
  await composer(page).getByRole("button", { name: "Send" }).click();
  await expect.poll(() => mock.items.length).toBe(1);
  const payload = mock.items[0]?.payload as {
    anchor?: unknown;
    metadata?: Record<string, unknown>;
    page: { url: string };
  };
  expect(payload.anchor).toBeUndefined();
  expect(payload.metadata).toMatchObject({ plan: "pro", accountId: 42 });
  expect(payload.page.url).not.toContain("pwt=");

  await call(page, (api) => api.setMetadata(null));
  await call(page, (api) => api.open("page"));
  await composer(page).getByRole("textbox", { name: "Your comment" }).fill("Second");
  await composer(page).getByRole("button", { name: "Send" }).click();
  await expect.poll(() => mock.items.length).toBe(2);
  expect((mock.items[1]?.payload as { metadata?: unknown }).metadata).toBeUndefined();
});

test("visibility mode manual: hidden until Pinwren.show(), hidden again by hide()", async ({ page }) => {
  const mock = await mockApi(page, { widget: { visibility: { mode: "manual" } } });
  await ready(page);
  const host = page.locator("pinwren-root");
  await expect(host).toHaveCSS("display", "none");
  // Hidden: no pin requests at all.
  expect(mock.requests.some((r) => r.path.startsWith("/feedback"))).toBe(false);
  await call(page, (api) => api.show());
  await expect(host).toHaveCSS("display", "block");
  await expect.poll(() => mock.requests.some((r) => r.path.startsWith("/feedback"))).toBe(true);
  await call(page, (api) => api.hide());
  await expect(host).toHaveCSS("display", "none");
});

test("visibility mode queryParam: ?pinwren shows the widget for the session", async ({ page }) => {
  await mockApi(page, { widget: { visibility: { mode: "queryParam", queryParam: "review" } } });
  await ready(page);
  await expect(page.locator("pinwren-root")).toHaveCSS("display", "none");
  await ready(page, "/?review");
  await expect(page.locator("pinwren-root")).toHaveCSS("display", "block");
  await ready(page, "/");
  await expect(page.locator("pinwren-root")).toHaveCSS("display", "block");
});

test("screenshot with every comment: a masked capture and its viewport go with the comment", async ({
  page,
}) => {
  const mock = await mockApi(page, { capture: { screenshotOnComment: true } });
  await ready(page);
  await call(page, (api) => api.open("page"));
  await composer(page).getByRole("textbox", { name: "Your comment" }).fill("With a picture");
  await composer(page).getByRole("button", { name: "Send" }).click();
  await expect.poll(() => mock.items.length, { timeout: 15_000 }).toBe(1);
  const payload = mock.items[0]?.payload as { screenshot?: string; capture?: { mode: string; vw: number } };
  expect(payload.screenshot).toMatch(/^data:image\/(webp|jpeg|png);base64,/);
  expect(payload.capture).toMatchObject({ mode: "visible", vw: 1280 });
});

test("errors read as plain language, and a comment sent offline waits in the outbox", async ({ page }) => {
  const mock = await mockApi(page);
  await ready(page);
  mock.postStatus = 413;
  await call(page, (api) => api.open("page"));
  await composer(page).getByRole("textbox", { name: "Your comment" }).fill("Too big?");
  await composer(page).getByRole("button", { name: "Send" }).click();
  await expect(composer(page).getByRole("alert")).toContainText("too large");

  mock.postStatus = 503;
  await composer(page).getByRole("button", { name: "Send" }).click();
  await expect(page.locator("pinwren-root .toast")).toContainText("saved");
  mock.postStatus = null;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => mock.items.length, { timeout: 15_000 }).toBe(1);
});

test("the network log keeps the host's own /w/ paths and leaves out only the widget's API", async ({
  page,
}) => {
  const mock = await mockApi(page);
  await ready(page);
  await page.evaluate(() => fetch("/shop/w/orders").catch(() => undefined));
  await call(page, (api) => api.open("bug"));
  await page.getByRole("textbox", { name: "Describe the bug" }).fill("Orders fail");
  await page.getByRole("button", { name: "Send report" }).click();
  await expect.poll(() => mock.items.length, { timeout: 15_000 }).toBe(1);
  const network =
    (mock.items[0]?.payload as { diagnostics?: { network?: { url: string }[] } }).diagnostics?.network ?? [];
  expect(network.some((n) => n.url.includes("/shop/w/orders"))).toBe(true);
  expect(network.some((n) => n.url.startsWith("http://localhost:5180/w/"))).toBe(false);
});
