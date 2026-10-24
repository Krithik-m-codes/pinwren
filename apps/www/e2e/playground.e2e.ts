import { expect, type Page, test } from "@playwright/test";
import { collectErrors, openWidgetShadow } from "./helpers";

// The /demo widget playground (wave 5): options re-initialise the real widget live; Local mode keeps
// feedback in this browser; the SitePing-style speed dial, markers, composer and sidebar.

const launcher = (page: Page) => page.locator("pinwren-root .launcher");
const pins = (page: Page) => page.locator("pinwren-root .pin:not(.draft)");
const panel = (page: Page) => page.getByRole("complementary", { name: "Widget playground" });
const sidebar = (page: Page) => page.getByRole("complementary", { name: "Feedback sidebar" });

async function openPlayground(page: Page) {
  await openWidgetShadow(page);
  await page.goto("/demo");
  await expect(launcher(page)).toBeVisible({ timeout: 20_000 });
  await expect(pins(page)).toHaveCount(6);
}

/** Pick an option of a playground segmented control and wait for the widget to come back. */
async function choose(page: Page, group: string, option: string) {
  await panel(page).getByRole("group", { name: group }).getByRole("button", { name: option }).click();
  await expect(launcher(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  // Saved playground options and the Local store are per browser; every test starts clean.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-cleared")) {
      localStorage.clear();
      indexedDB.deleteDatabase("pinwren-playground");
      sessionStorage.setItem("e2e-cleared", "1");
    }
  });
});

test("the speed dial fans out labelled actions and Esc closes it", async ({ page }) => {
  const errors = collectErrors(page);
  await openPlayground(page);
  await expect(launcher(page).locator(".count")).toHaveText("4");
  await launcher(page).click();
  await expect(launcher(page)).toHaveAttribute("aria-expanded", "true");
  for (const name of [/Hide markers/, /Create new annotation/, /Report a bug/, /Show sidebar/])
    await expect(
      page.getByRole("menuitem", { name }).or(page.getByRole("menuitemcheckbox", { name })),
    ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(launcher(page)).toHaveAttribute("aria-expanded", "false");
  await expect(launcher(page)).toBeFocused();

  // The eye hides the markers, and the choice survives a reload.
  await launcher(page).click();
  await page.getByRole("menuitemcheckbox", { name: /Hide markers/ }).click();
  await expect(pins(page).first()).toBeHidden();
  await page.reload();
  await expect(launcher(page)).toBeVisible({ timeout: 20_000 });
  await expect(pins(page).first()).toBeHidden();
  await launcher(page).click();
  await page.getByRole("menuitemcheckbox", { name: /Show markers/ }).click();
  await expect(pins(page)).toHaveCount(6);
  expect(errors).toEqual([]);
});

test("hovering a marker previews it and outlines its element", async ({ page }) => {
  await openPlayground(page);
  const marker = pins(page).filter({ hasText: "4" });
  // The sample site scrolls inside its own pane: scroll the pinned card into view, as a visitor would,
  // and the marker follows it (markers track scrolling containers, not only the window).
  await page.locator('[data-pinwren-anchor="demo-work-vertex"]').scrollIntoViewIfNeeded();
  await expect
    .poll(async () => (await marker.boundingBox())?.y ?? -1)
    .toBeLessThan(page.viewportSize()?.height ?? 900);
  await marker.hover();
  const preview = page.locator("pinwren-root .card.preview");
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("Bug");
  await expect(preview).toContainText("Vertex SaaS card");
  await expect(page.locator("pinwren-root .ring")).toBeVisible();
});

test("theme, position, accent and language re-initialise the widget live", async ({ page }) => {
  await openPlayground(page);
  await choose(page, "Theme", "Dark");
  await expect(page.locator("pinwren-root .root")).toHaveAttribute("data-theme", "dark");

  await choose(page, "Launcher position", "Bottom left");
  const box = await launcher(page).boundingBox();
  expect(box?.x ?? 9999).toBeLessThan(200);

  await panel(page).getByRole("button", { name: "Rose" }).click();
  await expect
    .poll(() => launcher(page).evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe("rgb(225, 29, 72)");

  await panel(page).getByRole("combobox", { name: "Widget language" }).click();
  await page.getByRole("option", { name: "Français" }).click();
  await expect(launcher(page)).toBeVisible();
  await launcher(page).click();
  await expect(page.getByRole("menuitem", { name: /Créer une annotation/ })).toBeVisible();

  // Options are remembered for this visitor.
  await page.reload();
  await expect(launcher(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("pinwren-root .root")).toHaveAttribute("data-theme", "dark");
});

test("Bug reports off removes the action; options toggle features", async ({ page }) => {
  await openPlayground(page);
  await panel(page).getByRole("switch", { name: "Bug reports" }).click();
  await expect(launcher(page)).toBeVisible();
  await launcher(page).click();
  await expect(page.getByRole("menuitem", { name: /Report a bug/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await panel(page).getByRole("button", { name: "Trigger console.error" }).click();
  await expect(panel(page).getByRole("status")).toHaveText("Logged a console error");
});

test("Local mode: feedback stays in this browser and survives a reload", async ({ page }) => {
  const sent: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.url().includes("/demo-api/w/")) sent.push(r.url());
  });
  await openPlayground(page);
  await choose(page, "Mode", "Local (this browser)");
  await expect(pins(page)).toHaveCount(6);

  await launcher(page).click();
  await page.getByRole("menuitem", { name: /Create new annotation/ }).click();
  const target = page.locator('[data-pinwren-anchor="demo-stats"]');
  await target.scrollIntoViewIfNeeded();
  const b = await target.boundingBox();
  if (!b) throw new Error("no box");
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);

  const composer = page.getByRole("dialog", { name: "New comment" });
  await expect(composer).toBeVisible();
  const send = composer.getByRole("button", { name: "Send" });
  await expect(send).toBeDisabled();
  await composer.getByRole("radio", { name: "Question" }).click();
  await expect(composer.getByRole("radio", { name: "Question" })).toHaveAttribute("aria-checked", "true");
  await composer.getByLabel("Your comment").fill("Where do these numbers come from?");
  await expect(composer).toContainText("Ctrl+Enter to send");
  await page.keyboard.press("Control+Enter");
  await expect(page.locator("pinwren-root .toast")).toHaveText("#7 sent");
  await expect(pins(page)).toHaveCount(7);
  expect(sent).toEqual([]);

  await page.reload();
  await expect(launcher(page)).toBeVisible({ timeout: 20_000 });
  await expect(pins(page)).toHaveCount(7);
});

test("the sidebar filters, resolves and deletes your own feedback", async ({ page }) => {
  await openPlayground(page);
  await launcher(page).click();
  await page.getByRole("menuitem", { name: /Show sidebar/ }).click();
  const bar = sidebar(page);
  await expect(bar).toBeVisible();
  await expect(bar.locator(".stats")).toContainText("4Open");
  await expect(bar.locator(".stats")).toContainText("2Resolved");
  await expect(bar.locator(".fcard")).toHaveCount(6);

  await bar.getByRole("button", { name: "Resolved", exact: true }).click();
  await expect(bar.locator(".fcard")).toHaveCount(2);
  await bar.getByRole("button", { name: "All", exact: true }).click();
  await bar.getByRole("button", { name: /Type/ }).click();
  await bar.getByRole("menuitemradio", { name: "Bug" }).click();
  await expect(bar.locator(".fcard")).toHaveCount(2);
  await bar.getByRole("button", { name: /Type/ }).click();
  await bar.getByRole("menuitemradio", { name: "All" }).click();

  // Clicking a card scrolls to its marker, flashes it and opens the thread.
  await bar.locator(".fcard").filter({ hasText: "Vertex SaaS" }).locator(".fmain").click();
  await expect(page.getByRole("dialog", { name: "Bug #4" })).toBeVisible();
  await expect(pins(page).filter({ hasText: "4" })).toHaveClass(/pulse/);
  await page.keyboard.press("Escape");

  // Visitors may resolve in the demo.
  await bar
    .locator(".fcard")
    .filter({ hasText: "Vertex SaaS" })
    .getByRole("button", { name: "Resolve" })
    .click();
  await expect(page.locator("pinwren-root .toast").filter({ hasText: "Resolved #4" })).toBeVisible();
  await expect(bar.locator(".stats")).toContainText("3Open");

  // Seeded items aren't ours: no Delete. Send one, then delete it from the sidebar.
  await expect(bar.getByRole("button", { name: "Delete all" })).toBeHidden();
  await bar.getByRole("button", { name: "Close sidebar" }).click();
  await page.keyboard.press("c");
  const t = page.locator('[data-pinwren-anchor="demo-work-lumen"]');
  await t.scrollIntoViewIfNeeded();
  const b = await t.boundingBox();
  if (!b) throw new Error("no box");
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.getByRole("dialog", { name: "New comment" }).getByLabel("Your comment").fill("Mine to delete");
  await page.getByRole("dialog", { name: "New comment" }).getByRole("button", { name: "Send" }).click();
  // The earlier toast may still be fading out: look for this one.
  await expect(page.locator("pinwren-root .toast").filter({ hasText: /#\d+ sent/ })).toBeVisible();

  await launcher(page).click();
  await page.getByRole("menuitem", { name: /Show sidebar/ }).click();
  const mine = bar.locator(".fcard").filter({ hasText: "Mine to delete" });
  await mine.getByRole("button", { name: "Delete", exact: true }).click();
  const confirm = bar.getByRole("alertdialog");
  await expect(confirm).toContainText("Delete 1 item?");
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(mine).toHaveCount(0);
  await expect(page.locator("pinwren-root .toast")).toHaveText("1 deleted");
});

test("on a phone the playground folds away and opens as a sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPlayground(page);
  await expect(panel(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Playground" }).click();
  await expect(panel(page)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await panel(page).getByRole("button", { name: "Collapse the playground" }).click();
  await expect(panel(page)).toHaveCount(0);
});
