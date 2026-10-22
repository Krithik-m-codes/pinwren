import { expect, test } from "@playwright/test";
import { collectErrors, ROUTES } from "./helpers";

for (const route of ROUTES) {
  test(`${route} renders without console errors`, async ({ page }) => {
    const errors = collectErrors(page);
    const res = await page.goto(route);
    expect(res?.status()).toBe(200);
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page).toHaveTitle(/Pinwren/);
    // Canonical URL and a social image on every page.
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /^https:\/\/pinwren\.dev/);
    await expect(page.locator('meta[property="og:image"]').first()).toHaveAttribute(
      "content",
      /^https?:\/\//,
    );
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });
}

test("unknown pages return the 404 page", async ({ page }) => {
  const res = await page.goto("/no-such-page");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "This page has no pin" })).toBeVisible();
});

test("SEO files: sitemap, robots, OG images, JSON-LD", async ({ page, request }) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("https://pinwren.dev/docs/quickstart");
  expect(sitemap).toContain("https://pinwren.dev/pricing");
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Sitemap: https://pinwren.dev/sitemap.xml");
  for (const img of ["/opengraph-image", "/docs-og/quickstart/image.png", "/docs-og/image.png"]) {
    const r = await request.get(img);
    expect(r.status(), img).toBe(200);
    expect(r.headers()["content-type"]).toContain("image/png");
  }
  await page.goto("/");
  const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
  const types = ld.map((t) => (JSON.parse(t) as { "@type": string })["@type"]);
  expect(types).toEqual(expect.arrayContaining(["SoftwareApplication", "FAQPage"]));
});
