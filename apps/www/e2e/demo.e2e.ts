import { expect, type Page, test } from "@playwright/test";
import { collectErrors, openWidgetShadow } from "./helpers";

const launcher = (page: Page) => page.locator("pinwren-root .launcher");
const pins = (page: Page) => page.locator("pinwren-root .pin:not(.draft)");
const feedbackRows = (page: Page) => page.getByRole("list", { name: "Feedback list" }).getByRole("listitem");

async function openDemo(page: Page) {
  await openWidgetShadow(page);
  await page.goto("/demo");
  await expect(launcher(page)).toBeVisible({ timeout: 20_000 });
}

test("seeded feedback is pinned on the sample page, resolved items as checks", async ({ page }) => {
  const errors = collectErrors(page);
  await openDemo(page);
  await expect(pins(page)).toHaveCount(6);
  await expect(page.locator("pinwren-root .pin.resolved")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("drag a region, send a comment, find it in the demo inbox", async ({ page }) => {
  await openDemo(page);
  await expect(pins(page)).toHaveCount(6);
  await launcher(page).click();
  await page.getByRole("menuitem", { name: /Create new annotation/ }).click();

  const target = page.locator('[data-pinwren-anchor="demo-services"]');
  await target.scrollIntoViewIfNeeded();
  const b = await target.boundingBox();
  if (!b) throw new Error("no box");
  const x1 = b.x + b.width * 0.15;
  const y1 = b.y + b.height * 0.6;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 60, y1 + 30, { steps: 8 });
  await page.mouse.move(x1 + 140, y1 + 60, { steps: 8 });
  await page.mouse.up();

  const composer = page.getByRole("dialog", { name: "New comment" });
  await expect(composer).toBeVisible();
  const text = `Crop the mountains a little tighter (e2e ${Date.now()})`;
  await composer.getByLabel("Your comment").fill(text);
  const name = composer.getByLabel("Your name");
  if (await name.isVisible()) await name.fill("Playwright");
  await composer.getByRole("button", { name: "Send" }).click();
  await expect(page.locator("pinwren-root .toast")).toHaveText(/#\d+ sent/);
  await expect(pins(page)).toHaveCount(7);

  await page.getByRole("link", { name: "Open your inbox" }).click();
  await expect(page).toHaveURL(/\/demo\/inbox/);
  // Client-side navigation away from /demo takes the widget down.
  await expect(page.locator("pinwren-root")).toHaveCount(0);
  const row = feedbackRows(page).filter({ hasText: text });
  await expect(row).toBeVisible();
  await row.getByRole("button").click();
  const detail = page.getByRole("region", { name: "Details" });
  await expect(detail.getByText(text)).toBeVisible();
  await expect(detail.getByText(/Region on/)).toBeVisible();
});

test("each visitor gets a private sandbox, and reset starts over", async ({ browser }) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pa = await a.newPage();
  const pb = await b.newPage();
  await openDemo(pa);
  await openDemo(pb);
  const keyA = (await a.cookies()).find((c) => c.name === "pinwren_demo")?.value;
  const keyB = (await b.cookies()).find((c) => c.name === "pinwren_demo")?.value;
  expect(keyA).toBeTruthy();
  expect(keyA).not.toBe(keyB);

  const res = await pa.request.post("/demo-api/w/feedback", {
    headers: { "x-pinwren-key": decodeURIComponent(keyA ?? "") },
    data: {
      clientId: crypto.randomUUID(),
      kind: "comment",
      body: "Only visitor A can see this",
      page: { url: "http://localhost:3200/demo" },
      environment: { userAgent: "e2e", viewport: { w: 1440, h: 900 }, dpr: 1 },
    },
  });
  expect(res.status()).toBe(201);

  await pa.goto("/demo/inbox");
  // The inbox opens on active items: the 4 open seeds (2 more are resolved), plus A's report.
  await expect(feedbackRows(pa)).toHaveCount(5);
  await pb.goto("/demo/inbox");
  await expect(feedbackRows(pb)).toHaveCount(4);

  await pa.getByRole("button", { name: "Reset demo" }).click();
  await expect(feedbackRows(pa)).toHaveCount(4);
  await a.close();
  await b.close();
});

test("the demo API follows the widget contract and rate-limits writes", async ({ request }) => {
  const key = `pk_demo_${"r".repeat(22)}`;
  const headers = { "x-pinwren-key": key };
  const config = await request.get("/demo-api/w/config", { headers });
  expect(config.status()).toBe(200);
  const cfg = (await config.json()) as { project: { publicRead: boolean }; widget: { modes: unknown } };
  expect(cfg.project.publicRead).toBe(true);
  expect(cfg.widget.modes).toEqual({ comment: true, bug: true });

  expect((await request.get("/demo-api/w/config")).status()).toBe(401);
  const wrongKey = await request.get("/demo-api/w/config", { headers: { "x-pinwren-key": "pk_live_nope" } });
  expect(wrongKey.status()).toBe(401);
  const foreign = await request.get("/demo-api/w/config", {
    headers: { ...headers, origin: "https://evil.example" },
  });
  expect(foreign.status()).toBe(403);

  const bad = await request.post("/demo-api/w/feedback", { headers, data: { body: "" } });
  expect(bad.status()).toBe(400);
  expect(bad.headers()["content-type"]).toContain("application/problem+json");

  const report = () => ({
    clientId: crypto.randomUUID(),
    kind: "comment",
    body: "Rate limit check",
    page: { url: "http://localhost:3200/demo" },
    environment: { userAgent: "e2e", viewport: { w: 1440, h: 900 }, dpr: 1 },
  });
  const first = await request.post("/demo-api/w/feedback", { headers, data: report() });
  expect(first.status()).toBe(201);
  const created = (await first.json()) as { feedback: { id: string; reporterToken?: string } };
  expect(created.feedback.reporterToken).toBeTruthy();

  const pinsRes = await request.get(`/demo-api/w/feedback?url=${encodeURIComponent("https://x.test/demo")}`, {
    headers,
  });
  const pinList = (await pinsRes.json()) as { items: { id: string }[] };
  expect(pinList.items.map((i) => i.id)).toContain(created.feedback.id);

  const statuses: number[] = [];
  for (let i = 0; i < 12; i++) {
    statuses.push((await request.post("/demo-api/w/feedback", { headers, data: report() })).status());
  }
  expect(statuses).toContain(429);
});
