import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ADMIN, seed, shoot } from "./env";
import { expect, test } from "./fixtures";

test.describe("settings", () => {
  test("profile and section navigation", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(ADMIN.name);
    const nav = page.getByRole("navigation", { name: "Settings" });
    for (const label of ["Members", "Notifications", "Integrations", "API tokens", "Email"]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }
    await shoot(page, "settings-profile", { fullPage: true });
  });

  test("invite a member, then the invitee accepts and lands in the inbox", async ({
    page,
    request,
    browser,
  }) => {
    const invitee = `invitee-${Date.now().toString(36)}@example.com`;
    await page.goto("/settings/members");
    await expect(page.getByRole("list", { name: "Members" }).getByText(ADMIN.email)).toBeVisible();
    await page.getByLabel("Email address").fill("not-an-email");
    await page.getByRole("button", { name: "Send invite" }).click();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
    await page.getByLabel("Email address").fill(invitee);
    await page.getByRole("combobox", { name: "Role" }).click();
    await page.getByRole("option", { name: "Admin" }).click();
    await page.getByRole("button", { name: "Send invite" }).click();
    await expect(page.getByText(`Invitation sent to ${invitee}`)).toBeVisible();
    const pending = page.getByRole("list", { name: "Pending invitations" });
    await expect(pending.getByText(invitee)).toBeVisible();
    await expect(pending.getByText(/Admin · invited/)).toBeVisible();
    await shoot(page, "settings-members", { fullPage: true });

    const { invitations } = (await (await request.get("/api/invitations")).json()) as {
      invitations: { id: string; email: string }[];
    };
    const inv = invitations.find((i) => i.email === invitee);
    if (!inv) throw new Error("invitation not listed");

    // A fresh browser: sign up from the invitation page, then join.
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const guest = await ctx.newPage();
    await guest.goto(`/accept-invitation/${inv.id}`);
    await expect(guest.getByText("You're invited")).toBeVisible();
    await shoot(guest, "accept-invitation-signed-out");
    await guest.getByLabel("Name").fill("Ivy Invitee");
    await guest.getByLabel("Email").fill(invitee);
    await guest.getByLabel("Password").fill("invitee-password-1");
    await guest.getByRole("button", { name: "Create account and continue" }).click();
    await expect(guest.getByRole("button", { name: "Join Acme Studio" })).toBeVisible();
    await shoot(guest, "accept-invitation-join");
    await guest.getByRole("button", { name: "Join Acme Studio" }).click();
    await guest.waitForURL("**/inbox");
    await expect(guest.getByRole("heading", { name: "Inbox" })).toBeVisible();
    await expect(guest.locator("[data-row-id]").first()).toBeVisible();
    await ctx.close();

    // Back as the admin: the invitee is a member, the invitation is gone; change role and remove.
    await page.reload();
    const member = page.getByRole("list", { name: "Members" }).locator(`[data-member="${invitee}"]`);
    await expect(member).toBeVisible();
    await expect(pending.getByText(invitee)).toHaveCount(0);
    await member.getByRole("combobox", { name: /Role of/ }).click();
    await page.getByRole("option", { name: "Member" }).click();
    await expect(page.getByText("Ivy Invitee is now member")).toBeVisible();
    await member.getByRole("button", { name: /Actions for/ }).click();
    await page.getByRole("menuitem", { name: "Remove from workspace" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
    await expect(member).toHaveCount(0);
  });

  test("revoke a pending invitation", async ({ page }) => {
    const email = `revoke-${Date.now().toString(36)}@example.com`;
    await page.goto("/settings/members");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Send invite" }).click();
    const row = page.locator(`[data-invitation="${email}"]`);
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Revoke" }).click();
    await expect(row).toHaveCount(0);
  });

  test.describe("webhooks", () => {
    let server: Server;
    let url = "";
    const received: { headers: Record<string, string | string[] | undefined>; body: string }[] = [];
    test.beforeAll(async () => {
      server = createServer((req, res) => {
        let body = "";
        req.on("data", (c: Buffer) => {
          body += c.toString();
        });
        req.on("end", () => {
          received.push({ headers: req.headers, body });
          res.writeHead(200, { "content-type": "application/json" });
          res.end('{"ok":true}');
        });
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hooks/pinwren`;
    });
    test.afterAll(() => new Promise<void>((r) => server.close(() => r())));

    test("create a webhook, send a test, see it in the delivery log, redeliver, rotate the secret", async ({
      page,
    }) => {
      await page.goto("/settings/integrations");
      await expect(page.getByText("No webhooks yet")).toBeVisible();
      await shoot(page, "settings-integrations-empty");
      await page.getByRole("button", { name: "Add webhook" }).first().click();
      const dialog = page.getByRole("dialog", { name: "Add a webhook" });
      await dialog.getByLabel("URL").fill("ftp://nope");
      await dialog.getByRole("button", { name: "Add webhook" }).click();
      await expect(dialog.getByText("Use an http(s) URL")).toBeVisible();
      await dialog.getByLabel("URL").fill(url);
      await dialog.getByLabel("Name (optional)").fill("Local receiver");
      await dialog.getByRole("checkbox", { name: "Status changed" }).click();
      await dialog.getByRole("button", { name: "Add webhook" }).click();

      // The signing secret is shown once.
      const secret = page.getByTestId("secret-value");
      await expect(secret).toHaveText(/^whsec_/);
      await page.getByRole("button", { name: "I've saved it" }).click();

      const sheet = page.getByRole("dialog").filter({ hasText: "Recent deliveries" });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByText("Nothing sent yet")).toBeVisible();
      await sheet.getByRole("button", { name: "Send test event" }).click();
      await expect(page.getByText(/Test delivered · 200/)).toBeVisible();
      const log = sheet.getByTestId("deliveries");
      await expect(log.locator('[data-delivery="ping"]')).toHaveCount(1);
      await expect(log.getByText("success")).toBeVisible();
      expect(received.at(-1)?.headers["pinwren-event"]).toBe("ping");
      expect(String(received.at(-1)?.headers["pinwren-signature"])).toMatch(/^v1=[0-9a-f]{64}$/);
      await shoot(page, "settings-webhook-detail");

      await log.getByRole("button", { name: "Redeliver" }).first().click();
      await expect(log.locator('[data-delivery="ping"]')).toHaveCount(2);
      expect(received.length).toBeGreaterThanOrEqual(2);

      await sheet.getByRole("button", { name: "Rotate secret" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Rotate" }).click();
      await expect(page.getByTestId("secret-value")).toHaveText(/^whsec_/);
      await page.getByRole("button", { name: "I've saved it" }).click();

      // Pausing disables testing; the list shows the state.
      await sheet.getByRole("switch", { name: "Active" }).click();
      await expect(sheet.getByRole("button", { name: "Send test event" })).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("list", { name: "Webhooks" }).getByText("Disabled")).toBeVisible();
      await shoot(page, "settings-integrations");
    });
  });

  test("create an API token (secret shown once), use it, revoke it", async ({ page, request }) => {
    await page.goto("/settings/tokens");
    await page.getByRole("button", { name: "Create token" }).click();
    const dialog = page.getByRole("dialog", { name: "Create an API token" });
    await dialog.getByLabel("Name").fill("CI triage bot");
    await dialog.getByRole("checkbox", { name: /feedback:write/ }).click();
    await dialog.getByRole("combobox", { name: "Expires" }).click();
    await page.getByRole("option", { name: "30 days" }).click();
    await dialog.getByRole("button", { name: "Create token" }).click();
    const secret = (await page.getByTestId("secret-value").textContent()) ?? "";
    expect(secret).toMatch(/^ann_/);
    await shoot(page, "settings-token-secret");
    await page.getByRole("button", { name: "I've saved it" }).click();

    const res = await request.get("/api/v1/feedback", { headers: { authorization: `Bearer ${secret}` } });
    expect(res.status()).toBe(200);

    const row = page.locator('[data-token="CI triage bot"]');
    await expect(row).toContainText("feedback:read");
    await expect(row).toContainText("feedback:write");
    await expect(row).toContainText(secret.slice(0, 12));
    await shoot(page, "settings-tokens");
    await row.getByRole("button", { name: "Revoke" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Revoke token" }).click();
    await expect(row).toHaveCount(0);
    const after = await request.get("/api/v1/feedback", { headers: { authorization: `Bearer ${secret}` } });
    expect(after.status()).toBe(401);
  });

  test("notification preferences matrix", async ({ page, request }) => {
    await page.goto("/settings/notifications");
    const box = page.getByRole("checkbox", { name: "Email for Marketing site" });
    await expect(box).toBeChecked();
    await box.click();
    await expect(page.getByText("Notification preferences saved").first()).toBeVisible();
    await shoot(page, "settings-notifications");
    const { preferences } = (await (await request.get("/api/notification-preferences")).json()) as {
      preferences: { projectName: string; email: boolean }[];
    };
    expect(preferences.find((p) => p.projectName === "Marketing site")?.email).toBe(false);
    await box.click();
  });

  test("instance email settings with a test send", async ({ page }) => {
    await page.goto("/settings/email");
    await expect(page.getByText("Outgoing email")).toBeVisible();
    await page.getByLabel("SMTP host").fill("bad host!");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("A hostname like smtp.example.com")).toBeVisible();
    await page.getByLabel("SMTP host").fill("");
    await page.getByRole("button", { name: "Send test email" }).click();
    await expect(page.getByRole("status")).toContainText(/Not sent|refused|Sent/);
    await shoot(page, "settings-email", { fullPage: true });
  });

  test("notification bell: unread count, open, mark read, jump to the item", async ({ page }) => {
    const { projectId } = seed();
    await page.goto(`/projects/${projectId}`);
    const bell = page.getByTestId("notifications-bell").filter({ visible: true });
    await expect(bell).toHaveAccessibleName(/unread/, { timeout: 30_000 });
    await bell.click();
    const pop = page.getByRole("dialog").filter({ hasText: "Notifications" });
    await expect(pop.getByText("New feedback").first()).toBeVisible();
    await shoot(page, "notifications-popover");
    await pop
      .getByRole("button", { name: /New feedback/ })
      .first()
      .click();
    await page.waitForURL(/\/inbox\?.*item=/);
    await expect(page.getByTestId("feedback-detail")).toBeVisible();
    await bell.click();
    await page.getByRole("button", { name: "Mark all read" }).click();
    await expect(bell).toHaveAccessibleName("Notifications");
    await expect(page.getByRole("button", { name: "Mark all read" })).toBeDisabled();
  });

  test("settings at 375 px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/settings/members");
    await expect(page.getByRole("list", { name: "Members" })).toBeVisible();
    await shoot(page, "mobile-settings-members");
    const { projectId } = seed();
    await page.goto(`/projects/${projectId}?tab=widget`);
    await expect(page.getByTestId("launcher-preview")).toBeVisible();
    await shoot(page, "mobile-project-widget");
  });
});
