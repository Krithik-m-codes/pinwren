import { seed } from "./env";
import { expect, test } from "./fixtures";

// Wave 5 — triage (docs/contracts/wave-5.md §3.4): labels from the item, label filter, rename, due date,
// bulk priority with per-item undo, sort, export, the trash with Undo / Restore, "My work".

test.describe("triage", () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  });

  test("labels an item from the keyboard and filters by the label", async ({ page }) => {
    const { projectId, items } = seed();
    const name = `e2e-${Date.now()}`;
    await page.goto(`/inbox?project=${projectId}&status=all&item=${items.pin.id}`);
    const detail = page.getByTestId("feedback-detail");
    await expect(detail).toBeVisible();

    // l → label picker → create a new label on the spot.
    await page.keyboard.press("l");
    await page.getByRole("combobox", { name: "Find a label" }).fill(name);
    await page.getByRole("option", { name: `Create “${name}”` }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("label-picker")).toContainText(name);
    await expect(page.locator(`[data-row-id="${items.pin.id}"]`)).toContainText(name);

    // Filter › Label narrows the list to that item.
    await page.getByTestId("filter-menu").click();
    await page.getByTestId("label-filter").click();
    await page.getByRole("menuitemradio", { name }).click();
    await expect(page.locator("[data-row-id]")).toHaveCount(1);
    await expect(page.getByRole("list", { name: "Active filters" })).toContainText(`Label: ${name}`);
  });

  test("renames with r, and sets a due date", async ({ page }) => {
    const { projectId, items } = seed();
    await page.goto(`/inbox?project=${projectId}&status=all&item=${items.pin.id}`);
    await expect(page.getByTestId("feedback-detail")).toBeVisible();
    await page.keyboard.press("r");
    const title = page.getByRole("textbox", { name: "Title" });
    await title.fill("Trial length question");
    await title.press("Enter");
    await expect(page.getByTestId("title")).toHaveText("Trial length question");
    await expect(page.getByText("renamed this to")).toBeVisible();

    await page.getByRole("button", { name: "Due date" }).click();
    await page.getByRole("grid").getByRole("button").last().click();
    await expect(page.getByText("set the due date to")).toBeVisible();

    // Put the reported title back: later specs look the item up by it.
    await page.keyboard.press("r");
    await title.fill("Is the trial 14 or 30 days?");
    await title.press("Enter");
    await expect(page.getByTestId("title")).toHaveText("Is the trial 14 or 30 days?");
  });

  test("bulk priority, undone item by item", async ({ page }) => {
    const { projectId } = seed();
    await page.goto(`/inbox?project=${projectId}&status=all`);
    const rows = page.locator("[data-row-id]");
    await expect(page.locator("ul[aria-label=Feedback][data-ready]")).toBeVisible();
    await rows.nth(0).getByRole("checkbox").click();
    await rows.nth(1).getByRole("checkbox").click();
    await page.getByTestId("bulk-priority").click();
    await page.getByRole("menuitem", { name: "Urgent" }).click();
    await expect(page.getByText("2 set to Urgent priority")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("u");
    await expect(page.getByText("Change undone")).toBeVisible();
  });

  test("sorts, exports and shows the total", async ({ page }) => {
    const { projectId } = seed();
    await page.goto(`/inbox?project=${projectId}&status=all`);
    await expect(page.getByTestId("list-footer")).toContainText(/item/);
    await page.getByTestId("sort-menu").click();
    await page.getByRole("menuitemradio", { name: "Highest priority" }).click();
    await expect(page).toHaveURL(/sort=priority/);
    await page.getByTestId("export-menu").click();
    const download = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "CSV (spreadsheet)" }).click();
    expect((await download).suggestedFilename()).toMatch(/feedback-.*\.csv$/);
  });

  test("moves to the trash with Undo, and restores from the trash", async ({ page }) => {
    const { projectId, items } = seed();
    await page.goto(`/inbox?project=${projectId}&status=all&item=${items.pin.id}`);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Move to trash" }).click();
    await page.getByRole("button", { name: "Move to trash" }).click();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("[data-sonner-toast]").getByText("Restored", { exact: true })).toBeVisible();

    await page.goto(`/inbox?project=${projectId}&status=all&item=${items.pin.id}`);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Move to trash" }).click();
    await page.getByRole("button", { name: "Move to trash" }).click();
    await page.getByTestId("trash-toggle").click();
    await expect(page.locator(`[data-row-id="${items.pin.id}"]`)).toBeVisible();
    await page.locator(`[data-row-id="${items.pin.id}"] [data-slot=feedback-row]`).click();
    await expect(page.getByTestId("trash-banner")).toBeVisible();
    await page.getByTestId("trash-banner").getByRole("button", { name: "Restore" }).click();
    await expect(page.locator("[data-sonner-toast]").getByText("Restored", { exact: true })).toBeVisible();
  });

  test("My work lists what is assigned to me (g m)", async ({ page }) => {
    const { projectId } = seed();
    await page.goto(`/inbox?project=${projectId}`);
    await expect(page.locator("ul[aria-label=Feedback][data-ready]")).toBeVisible();
    await page.keyboard.press("g");
    await page.keyboard.press("m");
    await expect(page).toHaveURL(/assignee=me/);
    await expect(page.getByRole("list", { name: "Active filters" })).toContainText("Assigned to me");
  });
});
