import { randomUUID } from "node:crypto";
import { SITE_ORIGIN, seed, shoot } from "./env";
import { expect, test } from "./fixtures";

// Wave 5, email + notifications (docs/contracts/wave-5.md §3.2): Settings › Email (SMTP test with unsaved
// values, the delivery log), Settings › Notifications (General, Reporter, My notifications) and the
// notifications page behind the bell's "View all".

test.describe("email and notifications", () => {
  test("SMTP: provider preset, TLS switches, test unsaved values, delivery log", async ({ page }) => {
    await page.goto("/settings/email");
    await expect(page.getByText("Outgoing email (SMTP)")).toBeVisible();
    const host = page.getByLabel("SMTP host");
    if (await host.isDisabled()) test.skip(true, "SMTP_HOST is set by the environment");

    await page.getByRole("combobox", { name: "Fill in for a provider" }).click();
    await page.getByRole("option", { name: "Resend" }).click();
    await expect(host).toHaveValue("smtp.resend.com");
    await expect(page.getByLabel("Username")).toHaveValue("resend");
    await expect(page.getByRole("switch", { name: "Use TLS" })).toBeChecked();
    await expect(page.getByText(/The username is “resend”/)).toBeVisible();

    // 587 with "Use TLS" is the classic mistake: the form says so.
    await page.getByLabel("Port").fill("587");
    await page.getByLabel("Port").blur();
    await expect(page.getByText(/Port 587 starts unencrypted/)).toBeVisible();

    // Point the unsaved form at a closed local port: the test fails with a category, nothing is saved.
    await host.fill("127.0.0.1");
    await page.getByLabel("Port").fill("9");
    await page.getByLabel("Port").blur();
    await page.getByRole("switch", { name: "Use TLS" }).click();
    await page.getByLabel("From address").fill("not an address");
    await page.getByTestId("smtp-test").click();
    await expect(page.getByText(/An address like noreply@example.com/)).toBeVisible();
    await page.getByLabel("From address").fill("Pinwren <noreply@example.com>");
    await page.getByTestId("smtp-test").click();
    await expect(page.getByTestId("smtp-test-result")).toContainText(/Connection failed|refused/, {
      timeout: 30_000,
    });
    await shoot(page, "settings-email-smtp", { fullPage: true });

    await page.reload();
    await expect(page.getByLabel("SMTP host")).not.toHaveValue("127.0.0.1");
    await expect(page.getByText("Recent deliveries", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Failed", exact: true }).click();
    await expect(page.getByTestId("email-deliveries").or(page.getByText(/No failed emails/))).toBeVisible();
  });

  test("Notifications › General and Reporter for a project", async ({ page }) => {
    await page.goto("/settings/notifications");
    await expect(page.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("New report recipients")).toBeVisible();

    await page.getByRole("button", { name: "Chosen members", exact: true }).click();
    await expect(page.getByText("Notification settings saved").first()).toBeVisible();
    await expect(page.getByTestId("notify-members")).toBeVisible();
    await page.getByRole("button", { name: "All members", exact: true }).click();
    await expect(page.getByTestId("notify-members")).toHaveCount(0);

    const address = page.getByLabel("Add an email address");
    await address.fill("not-an-address");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("An email address like boss@example.com")).toBeVisible();
    await address.fill("Boss@Example.com");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByTestId("notify-emails")).toContainText("boss@example.com");
    await shoot(page, "settings-notifications-general", { fullPage: true });
    await page.getByRole("button", { name: "Remove boss@example.com" }).click();
    await expect(page.getByTestId("notify-emails")).toHaveCount(0);

    await page.getByRole("tab", { name: "Reporter" }).click();
    await expect(page).toHaveURL(/tab=reporter/);
    const priority = page.getByRole("switch", { name: "Priority changes" });
    await expect(priority).not.toBeChecked();
    await priority.click();
    await expect(priority).toBeChecked();
    await page.getByRole("switch", { name: "Email the reporter" }).click();
    await expect(priority).toBeDisabled();
    await page.getByRole("switch", { name: "Email the reporter" }).click();
    await priority.click();
    await expect(priority).not.toBeChecked();
    await shoot(page, "settings-notifications-reporter");
  });

  test("My notifications: digest, pause, matrix", async ({ page, request }) => {
    await page.goto("/settings/notifications?tab=mine");
    await page.getByRole("button", { name: "Daily digest", exact: true }).click();
    await expect(page.getByText(/One email a day/)).toBeVisible();
    let prefs = (await (await request.get("/api/me/preferences")).json()) as {
      preferences: { emailDigest: string; emailPaused: boolean };
    };
    expect(prefs.preferences.emailDigest).toBe("daily");
    await page.getByRole("switch", { name: "Pause all email" }).click();
    await expect(page.getByRole("switch", { name: "Pause all email" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Mentions for Marketing site" })).toBeVisible();
    await shoot(page, "settings-notifications-mine", { fullPage: true });
    await page.getByRole("switch", { name: "Pause all email" }).click();
    await page.getByRole("button", { name: "Instantly", exact: true }).click();
    await expect(page.getByText(/One email per notification/)).toBeVisible();
    prefs = (await (await request.get("/api/me/preferences")).json()) as typeof prefs;
    expect(prefs.preferences).toEqual({ emailDigest: "off", emailPaused: false });
  });

  test("bell → View all → notifications page with tabs, project filter and paging", async ({
    page,
    request,
  }) => {
    const { projectId, publicKey } = seed();
    // A fresh report so there is at least one unread notification.
    const res = await request.post("/w/feedback", {
      headers: { "x-pinwren-key": publicKey, origin: SITE_ORIGIN },
      data: {
        clientId: randomUUID(),
        kind: "bug",
        body: "Notifications page check: the pay button is dead",
        page: { url: `${SITE_ORIGIN}/checkout`, title: "Checkout" },
        environment: {
          userAgent: "e2e",
          browser: "Chrome 140",
          os: "Windows 11",
          viewport: { w: 1280, h: 800 },
          dpr: 1,
        },
        reporter: { name: "Maria", email: "maria@client.example" },
      },
    });
    expect(res.ok()).toBe(true);
    const created = ((await res.json()) as { feedback: { id: string } }).feedback;

    await page.goto(`/projects/${projectId}`);
    const bell = page.getByTestId("notifications-bell").filter({ visible: true });
    await expect(bell).toHaveAccessibleName(/unread/, { timeout: 30_000 });
    await expect(page).toHaveTitle(/^\(\d+\+?\) /);
    await bell.click();
    await expect(page.getByText("New bug report from Maria").first()).toBeVisible();
    await page.getByTestId("notifications-view-all").click();
    await page.waitForURL(/\/notifications$/);

    await expect(page.getByTestId("notification-row").first()).toBeVisible();
    // The tab, not the rows (each unread row's name also says "Unread").
    await page.getByRole("button", { name: /^Unread \(\d+\)$/ }).click();
    await expect(page.getByText("New bug report from Maria").first()).toBeVisible();
    await page.getByRole("combobox", { name: "Project" }).click();
    await page.getByRole("option", { name: "Docs" }).click();
    await expect(page.getByText("No unread notifications")).toBeVisible();
    await page.getByRole("combobox", { name: "Project" }).click();
    await page.getByRole("option", { name: "All projects" }).click();
    await shoot(page, "notifications-page");

    await page.getByRole("button", { name: "Mark all read" }).click();
    await expect(page.getByText("No unread notifications")).toBeVisible();
    await expect(bell).toHaveAccessibleName("Notifications");
    await expect(page).not.toHaveTitle(/^\(\d+\+?\) /);

    // Other specs count the shared project's items: leave it as the seed made it.
    expect((await request.delete(`/api/feedback/${created.id}`)).ok()).toBe(true);
  });
});
