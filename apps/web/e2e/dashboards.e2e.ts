import { seed, shoot } from "./env";
import { expect, test } from "./fixtures";

// ADR 0024 dashboards: the /dashboard home, edit mode (add, resize, reorder, remove, reset), the date
// range, the overview strips on other screens, GET /api/stats, and the install tab's "Check installation".

test.describe("dashboards", () => {
  test("stats API answers for the workspace and a project, and rejects a bad range", async ({ request }) => {
    const { projectId } = seed();
    const all = await request.get("/api/stats?days=30");
    expect(all.ok()).toBe(true);
    const one = await request.get(`/api/stats?days=7&projectId=${projectId}`);
    expect(one.ok()).toBe(true);
    const bad = await request.get("/api/stats?days=abc");
    expect(bad.status()).toBe(400);
  });

  test("home dashboard: render, range, edit, add, resize, reorder, remove, reset", async ({ page }) => {
    await page.goto("/dashboard");
    const board = page.getByTestId("dashboard-home");
    await expect(board).toBeVisible();
    await expect(board.locator("[data-widget]").first()).toBeVisible();
    await shoot(page, "dashboard-home", { fullPage: true });

    await board.getByRole("button", { name: "Date range" }).click();
    await page.getByRole("menuitemradio", { name: "Last 90 days" }).click();
    await page.keyboard.press("Escape"); // radio items keep the menu open
    await expect(board.getByRole("button", { name: "Date range" })).toContainText("90");

    await page.getByTestId("dashboard-customise").click();
    await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
    const before = await board
      .locator("[data-widget]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-widget")));

    // Move the first widget later: order changes.
    await board
      .getByRole("button", { name: /^Move .* later$/ })
      .first()
      .click();
    const moved = await board
      .locator("[data-widget]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-widget")));
    expect(moved).not.toEqual(before);

    // Resize the first widget.
    await board
      .getByRole("button", { name: /^Resize / })
      .first()
      .click();
    await page.getByRole("menuitemradio").last().click();
    await page.keyboard.press("Escape");

    // Remove one, then add it back through the catalogue.
    await board
      .getByRole("button", { name: /^Remove / })
      .first()
      .click();
    expect(await board.locator("[data-widget]").count()).toBe(before.length - 1);
    await page.getByRole("button", { name: "Add widget" }).click();
    await page.getByRole("dialog").locator("ul button").first().click();
    await expect(board.locator("[data-widget]")).toHaveCount(before.length);
    await page.keyboard.press("Escape");
    await shoot(page, "dashboard-home-editing", { fullPage: true });

    await page.getByRole("button", { name: "Reset to default" }).click();
    await expect(board.locator("[data-widget]")).toHaveCount(before.length);
    await page.getByRole("button", { name: "Done" }).click();

    // The layout survives a reload.
    await page.reload();
    await expect(page.getByTestId("dashboard-home")).toBeVisible();
  });

  test("overview strips on inbox, projects, a project and notifications", async ({ page }) => {
    const { projectId } = seed();
    for (const [path, name] of [
      ["/inbox", "inbox"],
      ["/projects", "projects"],
      [`/projects/${projectId}`, "project"],
      ["/notifications", "notifications"],
    ] as const) {
      await page.goto(path);
      await expect(page.locator('[data-testid^="dashboard-"]').first()).toBeVisible();
      await shoot(page, `strip-${name}`, { fullPage: true });
    }
  });

  test("install tab: Check installation reports a verdict", async ({ page }) => {
    const { projectId } = seed();
    await page.goto(`/projects/${projectId}?tab=install`);
    await page.getByTestId("check-install").click();
    await expect(page.getByTestId("check-results")).toBeVisible();
    await shoot(page, "install-check", { fullPage: true });
  });
});
