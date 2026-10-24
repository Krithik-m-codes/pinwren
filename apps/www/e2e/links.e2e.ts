import { expect, test } from "@playwright/test";
import { SITE_URL } from "../src/lib/site";

// Crawls every page in the sitemap, collects each internal link (href="/…") and checks that the target
// answers below 400 and, for links with a #fragment, that the target page has an element with that id.
test("every internal link resolves", async ({ request }) => {
  test.setTimeout(300_000);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  const loc = new RegExp(`<loc>${SITE_URL.replaceAll(".", "\\.")}([^<]*)</loc>`, "g");
  const pages = [...sitemap.matchAll(loc)].map((m) => m[1] || "/");
  expect(pages.length).toBeGreaterThan(30);

  const cache = new Map<string, { status: number; body: string }>();
  const load = async (path: string) => {
    const hit = cache.get(path);
    if (hit) return hit;
    const res = await request.get(path, { maxRedirects: 5 });
    const type = res.headers()["content-type"] ?? "";
    const entry = { status: res.status(), body: type.includes("text/html") ? await res.text() : "" };
    cache.set(path, entry);
    return entry;
  };

  const links = new Map<string, string>(); // href → first page it appears on
  for (const p of pages) {
    const { status, body } = await load(p);
    expect(status, `sitemap page ${p}`).toBeLessThan(400);
    for (const m of body.matchAll(/href="(\/[^"]*)"/g)) {
      const href = (m[1] ?? "").replace(/&amp;/g, "&");
      if (href.startsWith("/_next/") || href.startsWith("//")) continue;
      if (!links.has(href)) links.set(href, p);
    }
  }
  expect(links.size).toBeGreaterThan(50);

  const broken: string[] = [];
  for (const [href, from] of links) {
    const [rawPath = "", hash] = href.split("#");
    const path = rawPath || from;
    const { status, body } = await load(path);
    if (status >= 400) broken.push(`${href} (on ${from}) → ${status}`);
    else if (hash && body && !body.includes(`id="${decodeURIComponent(hash)}"`)) {
      broken.push(`${href} (on ${from}) → no #${hash}`);
    }
  }
  expect(broken).toEqual([]);
});
