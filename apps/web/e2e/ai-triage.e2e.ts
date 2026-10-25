import { seed, shoot } from "./env";
import { expect, test } from "./fixtures";

test.describe("AI triage & enrichment", () => {
  test("workspace AI settings: form configuration and provider selection", async ({ page }) => {
    await page.goto("/settings/ai");
    await expect(page.getByRole("heading", { name: "AI Configuration" })).toBeVisible();
    await expect(
      page.getByText("Configure provider credentials and models for automated bug triage"),
    ).toBeVisible();

    // Provider buttons
    await expect(page.getByRole("button", { name: "Anthropic" })).toBeVisible();
    await expect(page.getByRole("button", { name: "OpenAI" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ollama" })).toBeVisible();

    // Switch to OpenAI
    await page.getByRole("button", { name: "OpenAI" }).click();
    await expect(page.getByPlaceholder("https://api.openai.com/v1")).toBeVisible();

    // Model presets
    await page.getByRole("button", { name: "gpt-4o-mini" }).click();
    const modelInput = page.getByLabel("Model");
    await expect(modelInput).toHaveValue("gpt-4o-mini");

    // Enable switch and fill credentials
    await page.getByLabel("Enable AI triage").click();
    const keyInput = page.getByLabel("API key");
    await keyInput.fill("sk-e2e-test-key-12345");

    // Save settings
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("AI settings saved")).toBeVisible();

    await shoot(page, "settings-ai", { fullPage: true });
  });

  test("project AI settings tab: toggles triage options", async ({ page }) => {
    const { projectId } = seed();
    await page.goto(`/projects/${projectId}?tab=ai`);

    await expect(page.getByRole("heading", { name: "AI Triage & Enrichment" })).toBeVisible();
    await expect(page.getByText("Executive summaries")).toBeVisible();
    await expect(page.getByText("Priority & kind suggestions")).toBeVisible();
    await expect(page.getByText("Duplicate detection")).toBeVisible();
    await expect(page.getByText("Reproduction steps")).toBeVisible();

    // Toggle main AI switch
    const enableSwitch = page.locator("#project-ai-enabled");
    await enableSwitch.click();
    await expect(page.getByText("AI triage updated")).toBeVisible();

    // Child switches should be interactive now
    const summarySwitch = page.locator("#project-ai-summary");
    await expect(summarySwitch).toBeEnabled();
    await summarySwitch.click();
    await expect(page.getByText("Executive summary updated")).toBeVisible();

    await shoot(page, "project-ai", { fullPage: true });
  });

  test("inbox item: AI actions and translation menu are reachable", async ({ page }) => {
    const { projectId, items } = seed();
    await page.goto(`/inbox?project=${projectId}&status=all&item=${items.pin.id}`);

    const detail = page.getByTestId("feedback-detail");
    await expect(detail).toBeVisible();

    // More actions menu contains Translate report
    await page.getByRole("button", { name: "More actions" }).click();
    const translateItem = page.getByRole("menuitem", { name: "Translate report" });
    await expect(translateItem).toBeVisible();
    await translateItem.click();

    // Translation toggle banner should be visible
    await expect(page.getByText(/Viewing original|Translated to/)).toBeVisible();

    await shoot(page, "inbox-ai-detail", { fullPage: true });
  });
});
