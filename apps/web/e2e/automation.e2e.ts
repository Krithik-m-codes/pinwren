import { getDb, labelSuggestion } from "@pinwren/db";
import { E2E_DATABASE_URL, seed, shoot } from "./env";
import { expect, test } from "./fixtures";

// Project › Automation: build a rule (event, a condition, an action), switch it off and on, dry-run it and
// delete it; plus the AI label chips on an item (accept / dismiss) and the bulk "Accept AI labels" button.

const RULE = "E2E route pricing bugs";

test.describe("automation rules", () => {
  test.afterEach(async ({ request }) => {
    const { projectId } = seed();
    const list = (await (await request.get(`/api/projects/${projectId}/automations`)).json()) as {
      rules: { id: string; name: string }[];
    };
    for (const r of list.rules.filter((x) => x.name.startsWith("E2E"))) {
      await request.delete(`/api/automations/${r.id}`);
    }
  });

  test("builder: create, toggle, dry-run and delete a rule", async ({ page }) => {
    const { projectId } = seed();
    await page.goto(`/projects/${projectId}?tab=automation`);
    await expect(page.getByText("Automation rules", { exact: true })).toBeVisible();
    await expect(page.getByText("No rules yet")).toBeVisible();

    await page.getByTestId("new-rule").click();
    const builder = page.getByTestId("rule-builder");
    await expect(builder).toBeVisible();

    // An incomplete rule is refused with a message, not saved.
    await builder.getByRole("button", { name: "Create rule" }).click();
    await expect(builder.getByTestId("rule-error")).toHaveText("Give the rule a name.");

    await builder.getByLabel("Rule name").fill(RULE);
    // Condition: Type is Bug.
    await builder.getByRole("combobox", { name: "Add a condition" }).click();
    await page.getByRole("option", { name: "Type", exact: true }).click();
    await expect(builder.getByTestId("rule-condition")).toHaveCount(1);
    await expect(
      builder.getByRole("group", { name: "Type" }).getByRole("button", { name: "Bug" }),
    ).toBeVisible();
    // Page URL pattern.
    await builder.getByRole("combobox", { name: "Add a condition" }).click();
    await page.getByRole("option", { name: "Page URL pattern" }).click();
    await builder.getByRole("textbox", { name: "Page URL pattern" }).fill("/pricing*");

    // Action: set the priority to High.
    await builder.getByRole("combobox", { name: "Add an action" }).click();
    await page.getByRole("option", { name: "Set priority" }).click();
    await builder.getByRole("combobox", { name: "Set priority" }).click();
    await page.getByRole("option", { name: "High" }).click();
    await shoot(page, "automation-builder");

    await builder.getByTestId("rule-save").click();
    await expect(page.getByText(`Created ${RULE}`)).toBeVisible();
    const row = page.locator(`[data-rule="${RULE}"]`);
    await expect(row).toBeVisible();
    await expect(row.getByText("A new report arrives")).toBeVisible();
    await expect(row.getByText("2 conditions")).toBeVisible();
    await expect(row.getByText("Never ran")).toBeVisible();

    // Off and on again.
    const toggle = row.getByRole("switch", { name: `Turn ${RULE} on or off` });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(page.getByText(`${RULE} is off`)).toBeVisible();
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(page.getByText(`${RULE} is on`)).toBeVisible();

    // Dry run against a sample: a bug on /pricing matches, a change request does not.
    await row.getByRole("button", { name: `Test ${RULE}` }).click();
    const tester = page.getByTestId("rule-tester");
    await tester.getByRole("textbox", { name: "Page URL" }).fill("https://example.com/pricing/plans");
    await tester.getByTestId("run-test").click();
    await expect(tester.getByTestId("test-verdict")).toHaveText("The rule would run: Set priority.");
    await tester.getByRole("combobox", { name: "Type" }).click();
    await page.getByRole("option", { name: "Change" }).click();
    await tester.getByTestId("run-test").click();
    await expect(tester.getByTestId("test-verdict")).toHaveText("The rule would not run for this report.");
    await shoot(page, "automation-test");
    await tester.getByRole("button", { name: "Close" }).first().click();

    // Edit keeps the rule; delete removes it.
    await row.getByRole("button", { name: `Edit ${RULE}` }).click();
    await expect(page.getByTestId("rule-builder").getByLabel("Rule name")).toHaveValue(RULE);
    await page.getByTestId("rule-builder").getByRole("button", { name: "Cancel" }).click();
    await row.getByRole("button", { name: `Delete ${RULE}` }).click();
    await page.getByRole("button", { name: "Delete rule" }).click();
    await expect(page.getByText(`Deleted ${RULE}`)).toBeVisible();
    await expect(page.getByText("No rules yet")).toBeVisible();
    await expect(page.getByText("No runs yet")).toBeVisible();
  });

  test("the API refuses an invalid rule and a viewer-free list stays empty", async ({ request }) => {
    const { projectId } = seed();
    const bad = await request.post(`/api/projects/${projectId}/automations`, {
      data: { name: "E2E bad", trigger: { event: "feedback_created" }, actions: [] },
    });
    expect(bad.status()).toBe(400);
    const list = (await (await request.get(`/api/projects/${projectId}/automations`)).json()) as {
      rules: unknown[];
    };
    expect(list.rules).toEqual([]);
  });
});

test.describe("AI label suggestions", () => {
  // The suggestions are what the enrichment job stores; the dashboard side is what is under test.
  async function suggest(feedbackId: string, orgId: string, names: string[]) {
    // The connection is opened on first use, against the database the e2e server runs on.
    process.env.DATABASE_URL = E2E_DATABASE_URL;
    await getDb()
      .insert(labelSuggestion)
      .values(names.map((name) => ({ orgId, feedbackId, labelId: null, name })))
      .onConflictDoNothing();
  }

  test("ghost chips: accept one, dismiss one, nothing applied until clicked", async ({ page, request }) => {
    const { items, orgId, projectId } = seed();
    const id = items.pin.id;
    await suggest(id, orgId, ["E2E Checkout", "E2E Noise"]);
    await page.goto(`/inbox?status=all&item=${id}`);
    const chips = page.getByTestId("ai-label-suggestions");
    await expect(chips).toBeVisible();
    await expect(chips.getByTestId("ai-label-chip")).toHaveCount(2);
    // Suggesting changed nothing.
    const before = (await (await request.get(`/api/projects/${projectId}/labels`)).json()) as {
      labels: { name: string }[];
    };
    expect(before.labels.map((l) => l.name)).not.toContain("E2E Checkout");
    await shoot(page, "ai-label-chips");

    await chips.getByRole("button", { name: "Accept label E2E Checkout" }).click();
    await expect(page.getByText("Added label E2E Checkout")).toBeVisible();
    await chips.getByRole("button", { name: "Dismiss label E2E Noise" }).click();
    await expect(chips).toBeHidden();

    const after = (await (await request.get(`/api/projects/${projectId}/labels`)).json()) as {
      labels: { id: string; name: string }[];
    };
    const created = after.labels.find((l) => l.name === "E2E Checkout");
    expect(created).toBeTruthy();
    expect(after.labels.map((l) => l.name)).not.toContain("E2E Noise");
    await expect(page.getByTestId("label-picker")).toContainText("E2E Checkout");

    // Leave the shared workspace as it was.
    if (created) await request.delete(`/api/labels/${created.id}`);
  });

  test("bulk bar: Accept AI labels applies the suggestions of the selected items", async ({
    page,
    request,
  }) => {
    const { items, orgId, projectId } = seed();
    await suggest(items.bug.id, orgId, ["E2E Bulk"]);
    await page.goto(`/inbox?status=all&project=${projectId}`);
    await page
      .getByRole("checkbox", { name: new RegExp(`#${items.bug.number}\\b`) })
      .first()
      .check();
    await page.getByTestId("bulk-accept-ai-labels").click();
    await expect(page.getByText("Accepted 1 suggested label")).toBeVisible();
    const labels = (await (await request.get(`/api/projects/${projectId}/labels`)).json()) as {
      labels: { id: string; name: string }[];
    };
    const created = labels.labels.find((l) => l.name === "E2E Bulk");
    expect(created).toBeTruthy();
    if (created) await request.delete(`/api/labels/${created.id}`);
  });
});
