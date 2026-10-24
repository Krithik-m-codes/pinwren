import { randomUUID } from "node:crypto";
import { SITE_ORIGIN, seed, shoot } from "./env";
import { expect, test } from "./fixtures";

// Wave 5 — review links / guest review (docs/contracts/wave-5.md §3.5): project settings › Review links,
// a guest's report sent through a link, its source on the item, and the inbox filter by link.

test.describe("review links", () => {
  test("a guest's report shows its link as the source, and the inbox filters by it", async ({
    page,
    request,
  }) => {
    const { projectId, publicKey } = seed();
    const name = `Guest round ${Date.now()}`;

    // Make the link from the Review links tab; the full URL is shown once.
    await page.goto(`/projects/${projectId}?tab=review`);
    await page.getByTestId("new-review-link").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel("Page").fill(`${SITE_ORIGIN}/pricing`);
    await dialog.getByRole("button", { name: "Create link" }).click();
    const made = page.getByTestId("review-link-made");
    await expect(made).toContainText(name);
    const url = (await made.locator("pre").textContent()) ?? "";
    const token = new URL(url).searchParams.get("pinwren_review") ?? "";
    expect(token).toMatch(/^pwr_/);

    // A guest sends a comment through it, as the widget does (the token rides in a header).
    const body = `Guest review e2e ${Date.now()}: the price is cut off`;
    const res = await request.post("/w/feedback", {
      headers: { "x-pinwren-key": publicKey, origin: SITE_ORIGIN, "x-pinwren-review-token": token },
      data: {
        clientId: randomUUID(),
        kind: "comment",
        body,
        page: { url: `${SITE_ORIGIN}/pricing`, title: "Pricing" },
        environment: { userAgent: "e2e", browser: "Chrome 140", viewport: { w: 1280, h: 800 }, dpr: 1 },
        reporter: { name: "Gina Guest", email: "gina@client.example" },
      },
    });
    expect(res.status()).toBe(201);
    const { feedback } = (await res.json()) as { feedback: { id: string } };

    // The tab counts it and opens the filtered inbox.
    await page.reload();
    const row = page.getByTestId("review-links").getByRole("listitem").filter({ hasText: name });
    await expect(row.getByRole("link", { name: "1 item" })).toBeVisible();
    await shoot(page, "project-review-links");
    await row.getByRole("link", { name: "1 item" }).click();
    await page.waitForURL(/\/inbox\?.*review=/);
    await expect(page.locator("[data-row-id]")).toHaveCount(1);
    await expect(page.locator(`[data-row-id="${feedback.id}"]`)).toBeVisible();
    await expect(page.getByRole("list", { name: "Active filters" })).toContainText(`Review link: ${name}`);

    // The item says where it came from, in the Details tab and the timeline.
    await page.locator(`[data-row-id="${feedback.id}"]`).click();
    const detail = page.getByTestId("feedback-detail");
    await expect(detail.getByTestId("review-link-source")).toContainText(name);
    await expect(detail).toContainText(`via review link ${name}`);

    // Filter › Review link lists it too.
    await page.goto(`/inbox?project=${projectId}&status=all`);
    await page.getByTestId("filter-menu").click();
    await page.getByTestId("review-link-filter").click();
    await expect(page.getByRole("menuitemradio", { name })).toBeVisible();
    await page.keyboard.press("Escape");

    // Revoke: the link stops working, and what came through it keeps its source.
    await page.goto(`/projects/${projectId}?tab=review`);
    await row.getByRole("button", { name: "Revoke" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Revoke" }).click();
    await expect(row.getByText("Revoked")).toBeVisible();
    const check = await request.get("/w/review-link", {
      headers: { "x-pinwren-key": publicKey, origin: SITE_ORIGIN, "x-pinwren-review-token": token },
    });
    expect(check.status()).toBe(404);
    const item = (await (await request.get(`/api/feedback/${feedback.id}`)).json()) as {
      feedback: { reviewLink: { label: string } | null };
    };
    expect(item.feedback.reviewLink?.label).toBe(name);
  });
});
