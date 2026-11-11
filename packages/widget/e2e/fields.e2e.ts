import { expect, type Page, test } from "@playwright/test";
import { mockApi } from "./mock";

// Custom questions in the bug report (ADR 0032): rendered from /w/config in the lazy widget-fields.js chunk,
// validated before sending, translated with the project's own strings, sent as `customFields`.

const report = (page: Page) => page.getByRole("dialog", { name: "Report a bug" });

const plans = [
  { value: "free", label: "Free" },
  { value: "pro", label: "Pro" },
  { value: "team", label: "Team" },
];
const field = (over: Record<string, unknown>) => ({
  key: "order",
  type: "text",
  label: "Order number",
  helpText: "",
  placeholder: "",
  required: false,
  kinds: ["bug"],
  options: [],
  defaultValue: null,
  validation: {},
  strings: {},
  ...over,
});

async function openReport(page: Page) {
  await page.goto("/");
  await expect(page.locator("pinwren-root .launcher")).toBeVisible();
  await page.locator("pinwren-root .launcher").click();
  await page.getByRole("menuitem", { name: /Report a bug/ }).click();
  await expect(report(page)).toBeVisible();
}

test("a project without custom questions never loads the chunk", async ({ page }) => {
  await mockApi(page);
  const files: string[] = [];
  page.on("request", (r) => files.push(new URL(r.url()).pathname));
  await openReport(page);
  await expect(report(page).getByText("More details")).toHaveCount(0);
  expect(files.some((f) => f.includes("widget-fields"))).toBe(false);
});

test("asks the questions, checks the required one, and sends every answer with the report", async ({
  page,
}) => {
  const mock = await mockApi(page, {
    widget: {
      customFields: [
        field({ helpText: "On your receipt", required: true }),
        field({ key: "plan", type: "select", label: "Plan", options: plans, defaultValue: "pro" }),
        field({ key: "areas", type: "multiselect", label: "Areas", options: plans }),
        field({
          key: "seats",
          type: "number",
          label: "Seats",
          validation: { min: 1, max: 50, integer: true },
        }),
        field({ key: "contact", type: "checkbox", label: "You may contact me" }),
        field({ key: "idea_only", label: "Only for ideas", kinds: ["idea"] }),
      ],
    },
  });
  await openReport(page);
  const form = report(page);
  await expect(form.getByText("More details")).toBeVisible();
  await expect(form.getByLabel("Order number")).toBeVisible();
  await expect(form.getByText("On your receipt")).toBeVisible();
  await expect(form.getByLabel("Plan")).toHaveValue("pro");
  await expect(form.getByLabel("Only for ideas")).toHaveCount(0);

  await form.getByPlaceholder(/What went wrong/).fill("The checkout button does nothing");
  await form.getByRole("button", { name: "Send report" }).click();
  // The required question blocks the send and is announced.
  await expect(form.getByText("This answer is required")).toBeVisible();
  await expect(form.getByLabel("Order number")).toHaveAttribute("aria-invalid", "true");
  await expect(form.getByLabel("Order number")).toBeFocused();
  expect(mock.items).toHaveLength(0);

  await form.getByLabel("Order number").fill("A-1042");
  await expect(form.getByText("This answer is required")).toHaveCount(0);
  await form.getByLabel("Seats").fill("0");
  await form.getByRole("button", { name: "Send report" }).click();
  await expect(form.getByText("Minimum: 1")).toBeVisible();
  await form.getByLabel("Seats").fill("12");
  await form.getByLabel("Team").check();
  await form.getByLabel("You may contact me").check();
  await form.getByRole("button", { name: "Send report" }).click();
  await expect(report(page)).toBeHidden();
  await expect.poll(() => mock.items.length).toBe(1);
  expect((mock.items[0]?.payload as { customFields?: unknown }).customFields).toEqual({
    order: "A-1042",
    plan: "pro",
    areas: ["team"],
    seats: 12,
    contact: true,
  });
});

test("shows the project's own translation of the questions in the visitor's language", async ({ page }) => {
  await mockApi(page, {
    widget: {
      customFields: [
        field({
          label: "Order number",
          required: true,
          strings: { fr: { label: "Numéro de commande", helpText: "Sur votre reçu" } },
        }),
      ],
    },
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "languages", { get: () => ["fr-FR", "fr"] });
    Object.defineProperty(navigator, "language", { get: () => "fr-FR" });
  });
  await page.goto("/");
  await expect(page.locator("pinwren-root .launcher")).toBeVisible();
  await page.locator("pinwren-root .launcher").click();
  await page.getByRole("menuitem", { name: /Signaler un bug/ }).click();
  const form = page.getByRole("dialog", { name: "Signaler un bug" });
  await expect(form.getByLabel("Numéro de commande")).toBeVisible();
  await expect(form.getByText("Sur votre reçu")).toBeVisible();
  await expect(form.getByText("Plus de détails")).toBeVisible();
});

test("keeps the answers in the draft", async ({ page }) => {
  await mockApi(page, {
    widget: { customFields: [field({ required: false })] },
  });
  await openReport(page);
  const form = report(page);
  await form.getByPlaceholder(/What went wrong/).fill("Draft body");
  await form.getByLabel("Order number").fill("D-77");
  await page.waitForTimeout(700); // the draft is saved shortly after the last edit
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(report(page)).toBeHidden();
  await page.locator("pinwren-root .launcher").click();
  await page.getByRole("menuitem", { name: /Report a bug/ }).click();
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(report(page).getByLabel("Order number")).toHaveValue("D-77");
});

test("project text is shown as text, never as markup", async ({ page }) => {
  await mockApi(page, {
    widget: {
      customFields: [field({ label: '<img src=x onerror="window.__pwn=1">Order', helpText: "<b>bold?</b>" })],
    },
  });
  await openReport(page);
  await expect(report(page).getByText("<b>bold?</b>")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __pwn?: number }).__pwn)).toBeUndefined();
});
