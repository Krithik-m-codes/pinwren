import { seed, shoot } from "./env";
import { expect, test } from "./fixtures";

test.describe("inbox", () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  });

  test("keyboard triage writes an activity timeline", async ({ page }) => {
    const { projectId, items } = seed();
    await page.goto(`/inbox?project=${projectId}&status=all`);
    await expect(page.locator("[data-row-id]")).toHaveCount(6);
    await shoot(page, "inbox-list");

    // j opens the newest item; k/j move.
    await page.keyboard.press("j");
    const detail = page.getByTestId("feedback-detail");
    await expect(detail).toBeVisible();
    await page.goto(`/inbox?project=${projectId}&item=${items.pin.id}`);
    await expect(detail.getByRole("heading", { name: "Is the trial 14 or 30 days?" })).toBeVisible();

    // s → status menu → In progress
    await page.keyboard.press("s");
    await page.getByRole("option", { name: "In progress" }).click();
    await expect(page.getByTestId("status-picker")).toContainText("In progress");
    // p → priority → Urgent
    await page.keyboard.press("p");
    await page.getByRole("option", { name: "Urgent" }).click();
    await expect(page.getByTestId("priority-picker")).toContainText("Urgent");
    // a → assign → me
    await page.keyboard.press("a");
    await page.getByRole("option", { name: "Avery Admin" }).click();
    await expect(page.getByTestId("assignee-picker")).toContainText("Avery Admin");
    // e → resolve, u → undo, e again
    await page.keyboard.press("e");
    await expect(page.getByText("Resolved", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("status-picker")).toContainText("Resolved");
    await page.keyboard.press("u");
    await expect(page.getByTestId("status-picker")).toContainText("In progress");

    const timeline = detail.getByRole("region", { name: "Activity" });
    await expect(timeline.getByText(/Avery Admin changed status/).first()).toBeVisible();
    await expect(timeline.getByText(/set priority to/)).toBeVisible();
    await expect(timeline.getByText(/assigned/)).toBeVisible();
    await expect(timeline.getByText("reported this")).toBeVisible();

    // c → comment; edit; delete.
    await page.keyboard.press("c");
    await page.keyboard.type("Trial is 14 days — adding it under the button.");
    await page.keyboard.press("Control+Enter");
    const comment = timeline.locator("li[data-comment]").filter({ hasText: "Trial is 14 days" });
    await expect(comment).toBeVisible();
    await comment.getByRole("button", { name: "Comment actions" }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await comment.getByRole("textbox", { name: "Edit comment" }).fill("Trial is 14 days. Copy updated.");
    await comment.getByRole("button", { name: "Save" }).click();
    await expect(comment.getByText("Trial is 14 days. Copy updated.")).toBeVisible();
    await expect(comment.getByText("· edited")).toBeVisible();
    await shoot(page, "inbox-detail-timeline");
    // Let the toasts (bottom-right, over the comment menu) clear first; hovering pauses them.
    await page.mouse.move(10, 10);
    await expect(page.getByText("Comment updated")).toBeHidden({ timeout: 15_000 });
    await comment.getByRole("button", { name: "Comment actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(timeline.locator("li[data-comment]")).toHaveCount(0);
    await expect(timeline.getByText("deleted an internal note")).toBeVisible();

    // Copy link puts a deep link on the clipboard.
    await detail.getByRole("button", { name: "Copy link" }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain(`item=${items.pin.id}`);
    const open = detail.getByRole("link", { name: "Open on page" });
    await expect(open).toHaveAttribute("href", `https://e2e.example.com/pricing?pinwren=${items.pin.id}`);
  });

  test("region comment shows its capture, anchor and the bug's attachments", async ({ page }) => {
    const { projectId, items } = seed();
    await page.goto(`/inbox?project=${projectId}&status=all&item=${items.region.id}`);
    const detail = page.getByTestId("feedback-detail");
    await expect(detail.getByText("Region", { exact: true })).toBeVisible();
    await expect(detail.getByRole("img", { name: /Screenshot attached/ })).toBeVisible();
    await expect(detail.locator("[data-marker]")).toHaveCount(1);
    await detail.getByRole("tab", { name: "Anchor" }).click();
    await expect(detail.getByTestId("anchor-selector")).toHaveText("#pro");
    await expect(detail.getByText(/Region · \d+ × \d+ px/)).toBeVisible();
    await shoot(page, "inbox-region", { fullPage: false });

    await page.goto(`/inbox?project=${projectId}&status=all&item=${items.bug.id}`);
    const attachments = detail.getByRole("region", { name: "Attachments" });
    await expect(attachments.getByText("receipt.pdf")).toBeVisible();
    const href = await attachments.getByRole("link", { name: /receipt\.pdf/ }).getAttribute("href");
    expect(href).toMatch(/^\/api\/assets\/[0-9a-f-]+$/);
    const res = await page.request.get(href ?? "");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toContain("attachment");
    await detail.getByRole("tab", { name: /Console/ }).click();
    await expect(detail.getByText(/TypeError: Cannot read properties/)).toBeVisible();
    await shoot(page, "inbox-bug");
  });

  test("x selects, bulk bar changes status and assignee", async ({ page }) => {
    const { projectId, items } = seed();
    await page.goto(`/inbox?project=${projectId}&status=all`);
    await expect(page.locator("[data-row-id]")).toHaveCount(6);
    await page.keyboard.press("j");
    await page.keyboard.press("x");
    await page.keyboard.press("j");
    await page.keyboard.press("x");
    const bar = page.getByRole("toolbar", { name: "Bulk actions" });
    await expect(bar).toContainText("2 selected");
    await shoot(page, "inbox-bulk");
    await bar.getByRole("button", { name: "Status" }).click();
    await page.getByRole("menuitem", { name: "In review" }).click();
    await expect(page.getByText("2 moved to In review").first()).toBeVisible();
    await bar.getByRole("button", { name: "Assign" }).click();
    await page.getByRole("menuitem", { name: "Avery Admin" }).click();
    await expect(page.getByText("Assigned 2").first()).toBeVisible();
    // Shift-click the checkbox of another row extends the selection.
    await page
      .getByRole("checkbox", { name: `Select #${items.headline.number}` })
      .click({ modifiers: ["Shift"] });
    await expect(bar).not.toContainText("2 selected");
    await bar.getByRole("button", { name: "Clear selection" }).click();
    await expect(bar).toHaveCount(0);
  });

  test("works at 375 px", async ({ page }) => {
    const { projectId, items } = seed();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/inbox?project=${projectId}`);
    await expect(page.getByRole("list", { name: "Feedback" }).getByRole("listitem").first()).toBeVisible();
    await shoot(page, "mobile-inbox");
    await page.goto(`/inbox?project=${projectId}&status=all&item=${items.bug.id}`);
    await expect(page.getByTestId("feedback-detail")).toBeVisible();
    await shoot(page, "mobile-detail");
  });
});
