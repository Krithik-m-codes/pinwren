import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { seed, shoot, SITE_ORIGIN } from "./env";
import { expect, test } from "./fixtures";

// Page Review, wave 5 (docs/contracts/wave-5.md §2, §3.3): captures placed by their own geometry (bug reports
// and comments carry `capture`), the reporter's annotations switchable over the capture, pages grouped despite
// tracking parameters and trailing slashes, "Open on page" / "Re-pin on page" signed links, URL grouping.

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const ENV = {
  userAgent: "Mozilla/5.0 (e2e) Chrome/140",
  browser: "Chrome 140",
  os: "Windows 11",
  viewport: { w: 1280, h: 800 },
  dpr: 1,
};

async function send(request: APIRequestContext, body: Record<string, unknown>) {
  const { publicKey } = seed();
  const r = await request.post("/w/feedback", {
    headers: { "x-pinwren-key": publicKey, origin: SITE_ORIGIN },
    data: { clientId: randomUUID(), environment: ENV, ...body },
  });
  expect(r.ok(), await r.text()).toBe(true);
  return ((await r.json()) as { feedback: { id: string; number: number } }).feedback;
}

test.describe("page review (wave 5)", () => {
  test("captures from bug reports, annotations on and off, one page despite tracking parameters", async ({
    page,
    request,
  }) => {
    const { projectId } = seed();
    const path = `/w5-review-${Date.now().toString(36)}`;
    const bug = await send(request, {
      kind: "bug",
      title: "Pricing table overlaps",
      body: "The table runs into the footer.",
      page: { url: `${SITE_ORIGIN}${path}?utm_source=newsletter` },
      screenshot: PNG,
      capture: { vw: 1280, vh: 800, scrollY: 0, mode: "visible" },
      annotations: {
        v: 1,
        width: 1,
        height: 1,
        shapes: [
          { tool: "rect", color: "#e5484d", size: "m", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } },
          { tool: "step", color: "#0090ff", size: "m", at: { x: 0.5, y: 0.5 }, n: 1 },
        ],
      },
    });
    const comment = await send(request, {
      kind: "comment",
      body: "Make this heading bigger",
      page: { url: `${SITE_ORIGIN}${path}/` },
      anchor: {
        v: 1,
        css: "#headline",
        xpath: '//*[@id="headline"]',
        text: { content: "Heading", prefix: "", suffix: "" },
        tag: "h1",
        structure: { depth: 3, siblingIndex: 0, childTagsHash: "e2e" },
        rect: { x: 100, y: 100, w: 400, h: 60, vw: 1280, vh: 800, scrollY: 0 },
        pin: { xPct: 50, yPct: 50 },
      },
    });

    await page.goto(`/projects/${projectId}/pages`);
    const grid = page.getByRole("list", { name: "Pages" });
    // `?utm_source=…` and the trailing slash land on the same page.
    await expect(grid.getByRole("link", { name: new RegExp(path) })).toHaveCount(1);
    await grid.getByRole("link", { name: new RegExp(path) }).click();
    await page.waitForURL(/url=/);

    // The bug report's screenshot is the capture (its own geometry), and the comment is placed on it.
    await expect(page.getByText(new RegExp(`Capture from #${bug.number}`))).toBeVisible();
    await expect(page.locator(`[data-marker="${comment.id}"]`)).toBeVisible();
    // The bug report has no anchor: listed as a whole-page thread.
    const threads = page.getByRole("complementary", { name: "Threads on this page" });
    await expect(threads.getByText("Whole page")).toBeVisible();

    const overlay = page.locator("svg[data-annotations]");
    await expect(overlay).toHaveAttribute("data-annotations", "2");
    await shoot(page, "page-review-annotations");
    await page.getByTestId("annotations-toggle").click();
    await expect(overlay).toHaveCount(0);
    await page.getByTestId("annotations-toggle").click();
    await expect(overlay).toHaveCount(1);
  });

  test("open on page and re-pin on page hand out signed links", async ({ page, request, context }) => {
    const { projectId } = seed();
    const path = `/w5-links-${Date.now().toString(36)}`;
    const item = await send(request, {
      kind: "comment",
      body: "Pinned in the wrong place",
      page: { url: `${SITE_ORIGIN}${path}` },
      anchor: {
        v: 1,
        css: "#cta",
        xpath: '//*[@id="cta"]',
        text: { content: "Buy", prefix: "", suffix: "" },
        tag: "button",
        structure: { depth: 3, siblingIndex: 0, childTagsHash: "e2e" },
        rect: { x: 10, y: 10, w: 100, h: 40, vw: 1280, vh: 800, scrollY: 0 },
        pin: { xPct: 50, yPct: 50 },
      },
    });
    // The customer's site isn't reachable from the test runner: answer it locally.
    await context.route(`${SITE_ORIGIN}/**`, (r) =>
      r.fulfill({ contentType: "text/html", body: "<p>site</p>" }),
    );

    await page.goto(
      `/projects/${projectId}/pages?url=${encodeURIComponent(`${SITE_ORIGIN}${path}`)}&item=${item.id}`,
    );
    const [tab] = await Promise.all([
      context.waitForEvent("page"),
      page.getByTestId("review-open-on-page").click(),
    ]);
    await tab.waitForURL(/pwt=/);
    const opened = new URL(tab.url());
    expect(opened.searchParams.get("pinwren")).toBe(item.id);
    await tab.close();

    const [repin] = await Promise.all([
      context.waitForEvent("page"),
      page.getByTestId("review-repin").click(),
    ]);
    await repin.waitForURL(/pwt=/);
    const token = new URL(repin.url()).searchParams.get("pwt") ?? "";
    // The clear-text part names the scope the widget enters.
    expect(Buffer.from(token.split(".")[0] ?? "", "base64url").toString()).toMatch(/\.repin$/);
    await repin.close();
  });

  test("URL grouping: an Admin adds an ignored parameter and pages re-group", async ({ page, request }) => {
    const { projectId } = seed();
    const path = `/w5-group-${Date.now().toString(36)}`;
    await send(request, { kind: "comment", body: "A", page: { url: `${SITE_ORIGIN}${path}?sid=1` } });
    await send(request, { kind: "comment", body: "B", page: { url: `${SITE_ORIGIN}${path}?sid=2` } });

    await page.goto(`/projects/${projectId}/pages`);
    const grid = page.getByRole("list", { name: "Pages" });
    await expect(grid.getByRole("link", { name: new RegExp(path) })).toHaveCount(2);

    await page.getByTestId("url-grouping").click();
    const dialog = page.getByRole("dialog", { name: "URL grouping" });
    await dialog.getByRole("textbox", { name: "Add a parameter" }).fill("not valid!");
    await dialog.getByRole("button", { name: "Add" }).click();
    await expect(dialog.getByText(/Use a parameter name/)).toBeVisible();
    await dialog.getByRole("textbox", { name: "Add a parameter" }).fill("sid");
    await dialog.getByRole("button", { name: "Add" }).click();
    await expect(dialog.getByRole("list", { name: "Ignored parameters" })).toContainText("sid");
    await shoot(page, "page-review-url-grouping");
    await dialog.getByTestId("url-grouping-save").click();
    await expect(page.getByText(/re-grouped/).first()).toBeVisible();
    await expect(grid.getByRole("link", { name: new RegExp(path) })).toHaveCount(1);

    // Clean up for other specs: the project's rule set goes back to empty.
    await request.patch(`/api/projects/${projectId}`, { data: { widgetConfig: { ignoredQueryParams: [] } } });
  });
});
