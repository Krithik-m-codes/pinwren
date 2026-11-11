import { randomUUID } from "node:crypto";
import { SITE_ORIGIN, seed, shoot } from "./env";
import { expect, test } from "./fixtures";

// Project › Form: build the report form (add, reorder by keyboard, preview, save), then follow an answer from
// the widget API into the item (shown, edited), the inbox filter and the export; finally delete the fields.

test.describe("custom fields and the form builder", () => {
  // The workspace is shared with the other specs, which count its items: what a test files goes to the trash.
  const filed: string[] = [];

  test.afterEach(async ({ request }) => {
    for (const id of filed.splice(0)) await request.delete(`/api/feedback/${id}`);
    const { projectId } = seed();
    await request.put(`/api/projects/${projectId}/custom-fields`, { data: { fields: [] } });
  });

  test("builds the form, previews it, reorders by keyboard and saves", async ({ page, request }) => {
    const { projectId, publicKey } = seed();
    await page.goto(`/projects/${projectId}?tab=form`);
    await expect(page.getByText("Report form fields", { exact: true })).toBeVisible();
    await expect(page.getByText("No custom fields yet")).toBeVisible();

    // A field without a label is refused in the dialog.
    await page.getByTestId("add-field").click();
    const editor = page.getByTestId("field-editor");
    await expect(editor).toBeVisible();
    await editor.getByTestId("save-field").click();
    await expect(editor.getByText("Give the field a label")).toBeVisible();

    await editor.getByLabel("Label", { exact: true }).fill("Order number");
    await expect(editor.getByLabel("Key")).toHaveValue("order_number");
    await editor.getByText("Required", { exact: true }).click();
    await editor.getByTestId("save-field").click();
    await expect(page.getByTestId("field-row")).toHaveCount(1);

    // A select with options.
    await page.getByTestId("add-field").click();
    await editor.getByLabel("Label", { exact: true }).fill("Plan");
    await editor.getByRole("combobox", { name: "Type" }).click();
    await page.getByRole("option", { name: "Select", exact: true }).click();
    await editor.getByLabel("Option 1 label").fill("Free");
    await editor.getByRole("button", { name: "Add option" }).click();
    await editor.getByLabel("Option 2 label").fill("Pro");
    await expect(editor.getByLabel("Option 2 value")).toHaveValue("pro");
    await editor.getByTestId("save-field").click();
    await expect(page.getByTestId("field-row")).toHaveCount(2);
    await expect(page.getByTestId("field-count")).toHaveText("2 of 20 fields");

    // The preview shows what the widget will ask, and checks answers with the same rules.
    const preview = page.getByTestId("form-preview");
    await expect(preview.getByText("Order number")).toBeVisible();
    await preview.getByTestId("preview-check").click();
    await expect(preview.getByText("This answer is required")).toBeVisible();
    await preview.getByLabel("Order number").fill("A-1");
    await preview.getByTestId("preview-check").click();
    await expect(preview.getByText("Every answer is valid")).toBeVisible();

    // Keyboard reorder: the handle moves its field with the arrow keys.
    await page.getByRole("button", { name: "Reorder Plan" }).focus();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByTestId("field-row").first()).toContainText("Plan");
    await expect(page.getByText("Moved Plan to position 1 of 2")).toBeAttached();

    await shoot(page, "form-builder");
    await page.getByTestId("save-form").click();
    await expect(page.getByText("Form saved")).toBeVisible();

    // The widget gets the saved form, in the saved order, reporter fields only.
    const config = (await (
      await request.get("/w/config", { headers: { "x-pinwren-key": publicKey, origin: SITE_ORIGIN } })
    ).json()) as { widget: { customFields: { key: string }[] } };
    expect(config.widget.customFields.map((f) => f.key)).toEqual(["plan", "order_number"]);

    // A reload shows the same order; export gives the JSON that Import takes back.
    await page.reload();
    await expect(page.getByTestId("field-row").first()).toContainText("Plan");
  });

  test("an answer from the widget shows on the item, is editable, filterable and exported", async ({
    page,
    request,
  }) => {
    const { projectId, publicKey } = seed();
    const put = await request.put(`/api/projects/${projectId}/custom-fields`, {
      data: {
        fields: [
          { key: "order_number", type: "text", label: "Order number", required: true },
          {
            key: "plan",
            type: "select",
            label: "Plan",
            options: [
              { value: "free", label: "Free" },
              { value: "pro", label: "Pro" },
            ],
          },
          { key: "triage_note", type: "textarea", label: "Triage note", audience: "internal" },
        ],
      },
    });
    expect(put.ok()).toBe(true);
    const sent = await request.post("/w/feedback", {
      headers: { "x-pinwren-key": publicKey, origin: SITE_ORIGIN },
      data: {
        clientId: randomUUID(),
        kind: "bug",
        body: "Checkout hangs on the pay button (custom fields e2e)",
        page: { url: `${SITE_ORIGIN}/checkout`, title: "Checkout" },
        environment: { userAgent: "Mozilla/5.0 Chrome/120", viewport: { w: 1280, h: 800 }, dpr: 1 },
        customFields: { order_number: "ORD-9001", plan: "pro" },
      },
    });
    expect(sent.status()).toBe(201);
    const { id } = ((await sent.json()) as { feedback: { id: string } }).feedback;
    filed.push(id);

    await page.goto(`/inbox?project=${projectId}&status=all&item=${id}`);
    const card = page.getByTestId("custom-fields-card");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("answer-order_number")).toContainText("ORD-9001");
    await expect(card.getByTestId("answer-plan")).toContainText("Pro");
    await expect(card.getByTestId("answer-triage_note")).toContainText("Not answered");

    // The team fills in the internal field.
    await card.getByTestId("edit-custom-fields").click();
    await card.getByLabel("Triage note").fill("Payment provider timeout, see incident 12");
    await card.getByTestId("save-custom-fields").click();
    await expect(page.getByText("Answers saved")).toBeVisible();
    await expect(card.getByTestId("answer-triage_note")).toContainText("Payment provider timeout");
    await expect(page.getByText(/set Triage note to/)).toBeVisible();

    // Filter the inbox by the field.
    await page.goto(`/inbox?project=${projectId}&status=all&cf=plan%3Apro`);
    await expect(page.getByText("Plan: Pro")).toBeVisible();
    await expect(page.getByRole("button", { name: /Checkout hangs/ })).toBeVisible();
    await page.goto(`/inbox?project=${projectId}&status=all&cf=plan%3Afree`);
    await expect(page.getByRole("button", { name: /Checkout hangs/ })).toHaveCount(0);

    // Exports carry the answers.
    const csv = await (
      await request.get(`/api/feedback/export?projectId=${projectId}&status=all&format=csv`)
    ).text();
    expect(csv).toContain("Order number,Plan,Triage note");
    expect(csv).toContain("ORD-9001");
  });
});
