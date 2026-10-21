import { seed, shoot } from "./env";
import { expect, test } from "./fixtures";

test.describe("board", () => {
  test("drag a card between columns, and move one with the keyboard", async ({ page, request }) => {
    const { projectId, items } = seed();
    await page.goto(`/inbox?project=${projectId}&view=board`);
    const board = page.getByTestId("board");
    const column = (status: string) => board.locator(`[data-column="${status}"]`);
    await expect(board.locator("[data-card]")).toHaveCount(6);
    // Thumbnails load for cards with a screenshot.
    await expect(board.locator(`[data-card="${items.region.id}"] img`)).toBeVisible();
    await shoot(page, "board");

    // Pointer: drag the headline idea from wherever it is to "In review".
    const card = board.locator(`[data-card="${items.headline.id}"]`);
    await card.dragTo(column("in_review"));
    await expect(column("in_review").locator(`[data-card="${items.headline.id}"]`)).toBeVisible();
    await expect(page.getByText("Moved to In review").first()).toBeVisible();

    // Keyboard: focus a card, press m, choose a column.
    const extra = board.locator(`[data-card="${items.extra.id}"]`);
    await extra.getByRole("button", { name: /Press m to move/ }).focus();
    await page.keyboard.press("m");
    await page.getByRole("menuitem", { name: "Won't fix" }).click();
    await expect(column("wont_fix").locator(`[data-card="${items.extra.id}"]`)).toBeVisible();

    await expect
      .poll(async () => {
        const r = await request.get(`/api/feedback/${items.extra.id}`);
        return ((await r.json()) as { feedback: { status: string } }).feedback.status;
      })
      .toBe("wont_fix");

    // Clicking a card opens the detail sheet.
    await card.getByRole("button", { name: /Press m to move/ }).click();
    await expect(page.getByTestId("feedback-detail")).toBeVisible();
    await shoot(page, "board-detail");
  });
});

test.describe("pages", () => {
  test("pages grid and Figma-style review with pins in place", async ({ page }) => {
    const { projectId, items } = seed();
    await page.goto(`/projects/${projectId}/pages`);
    const grid = page.getByRole("list", { name: "Pages" });
    await expect(grid.getByRole("listitem")).toHaveCount(3);
    await expect(grid.getByText("/pricing")).toBeVisible();
    await shoot(page, "pages-grid");

    await grid.getByRole("link", { name: /\/pricing/ }).click();
    await page.waitForURL(/url=/);
    // Show everything (some items were moved to closed statuses by other specs).
    await page.getByRole("group", { name: "Show" }).getByRole("button", { name: /All/ }).click();
    // Same-viewport pins are drawn on the capture; the 390 px one is listed as not on it.
    await expect(page.locator(`[data-marker="${items.region.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-marker="${items.pin.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-marker="${items.headline.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-marker="${items.mobile.id}"]`)).toHaveCount(0);
    const threads = page.getByRole("complementary", { name: "Threads on this page" });
    await expect(threads.getByText("Not on this capture")).toBeVisible();
    await shoot(page, "pages-review");

    // The marker sits over the Start trial button: right-hand half, lower part of the capture.
    const img = page.getByRole("img", { name: /Capture of \/pricing/ });
    const ib = await img.boundingBox();
    const mb = await page.locator(`[data-marker="${items.pin.id}"]`).boundingBox();
    if (!ib || !mb) throw new Error("no boxes");
    const cx = (mb.x + mb.width / 2 - ib.x) / ib.width;
    const cy = (mb.y + mb.height / 2 - ib.y) / ib.height;
    expect(cx).toBeGreaterThan(0.45);
    expect(cx).toBeLessThan(0.65);
    expect(cy).toBeGreaterThan(0.6);
    expect(cy).toBeLessThan(0.8);

    // Clicking a pin opens the item beside the capture.
    await page.locator(`[data-marker="${items.pin.id}"]`).click();
    const detail = page.getByTestId("feedback-detail");
    await expect(detail.getByRole("heading", { name: "Is the trial 14 or 30 days?" })).toBeVisible();
    await shoot(page, "pages-review-open");
    await page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);
  });
});
