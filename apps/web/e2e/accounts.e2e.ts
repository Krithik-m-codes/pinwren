import { createHmac } from "node:crypto";
import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { ADMIN, seed, shoot } from "./env";
import { expect, test } from "./fixtures";

// Accounts (wave-5 contract §3.1, BugPin model): Users › Add User, roles, password reset without SMTP,
// two-factor sign-in, deep links through sign-in, pending invitations on onboarding, and workspaces
// (create, switch, `?org=` links, delete). The e2e server has no SMTP, like a fresh self-hosted install.

/** RFC 6238 code for a base32 secret (what an authenticator app shows). */
function totp(secret: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secret.replace(/[\s=]/g, "").toUpperCase()) {
    bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g)?.map((b) => parseInt(b, 2)) ?? []);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const offset = (h[h.length - 1] ?? 0) & 0xf;
  const n = (h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return n.toString().padStart(6, "0");
}

/** An account created straight through Users › Add User's API, for flows that need a fresh person. */
async function addUser(request: APIRequestContext, role: "admin" | "editor" | "viewer") {
  const tag = Date.now().toString(36);
  const user = { name: `Pat ${tag}`, email: `pat-${tag}@example.com`, password: `pat-password-${tag}` };
  const res = await request.post("/api/members", { data: { ...user, role } });
  expect(res.status()).toBe(201);
  const { member } = (await res.json()) as { member: { userId: string } };
  return { ...user, id: member.userId };
}

/** A signed-out browser context and page. */
async function freshPage(browser: Browser) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  return { ctx, page: await ctx.newPage() };
}

async function signIn(page: Page, email: string, password: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test.describe("accounts", () => {
  test("Add User creates the account, the person signs in, an Admin changes the role and removes them", async ({
    page,
    browser,
  }) => {
    const tag = Date.now().toString(36);
    const email = `added-${tag}@example.com`;
    await page.goto("/settings/members");
    await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add user" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Addie Added");
    await dialog.getByLabel("Email").fill(email);
    await dialog.getByLabel("Password").fill("short");
    await dialog.getByRole("button", { name: "Add user" }).click();
    await expect(dialog.getByText("Use at least 8 characters")).toBeVisible();
    await dialog.getByRole("button", { name: "Generate" }).click();
    await dialog.getByRole("combobox", { name: "Role" }).click();
    await page.getByRole("option", { name: "Viewer" }).click();
    await shoot(page, "users-add-user");
    await dialog.getByRole("button", { name: "Add user" }).click();
    await expect(dialog.getByText("Addie Added can sign in now")).toBeVisible();
    const password = (await dialog.getByTestId("new-user-password").textContent()) ?? "";
    expect(password).toHaveLength(16);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);

    const row = page.locator(`[data-member="${email}"]`);
    await expect(row.getByRole("combobox", { name: /Role of/ })).toContainText("Viewer");

    // The same address again: offered as an invitation instead.
    await page.getByRole("button", { name: "Add user" }).click();
    await dialog.getByLabel("Name").fill("Again");
    await dialog.getByLabel("Email").fill(email);
    await dialog.getByRole("button", { name: "Generate" }).click();
    await dialog.getByRole("button", { name: "Add user" }).click();
    await expect(dialog.getByText(/already exists/)).toBeVisible();
    await dialog.getByRole("button", { name: `Invite ${email} instead` }).click();
    await expect(page.getByLabel("Email address")).toHaveValue(email);

    // The new person signs in with what the Admin handed over: a read-only Viewer.
    const { ctx, page: guest } = await freshPage(browser);
    await guest.goto("/sign-in");
    await signIn(guest, email, password);
    await guest.waitForURL("**/inbox");
    await expect(guest.getByTestId("read-only-badge")).toBeVisible();
    await ctx.close();

    await row.getByRole("combobox", { name: /Role of/ }).click();
    await page.getByRole("option", { name: "Editor" }).click();
    await expect(page.getByText("Addie Added is now an Editor")).toBeVisible();
    await row.getByRole("button", { name: /Actions for/ }).click();
    await page.getByRole("menuitem", { name: "Remove from workspace" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
    await expect(row).toHaveCount(0);
  });

  test("without SMTP: forgot password says ask your admin, whose reset link works once", async ({
    page,
    request,
    browser,
  }) => {
    const pat = await addUser(request, "editor");
    const { ctx, page: guest } = await freshPage(browser);
    await guest.goto("/sign-in");
    await guest.getByRole("link", { name: "Forgot password?" }).click();
    await expect(guest.getByText("Ask your administrator")).toBeVisible();
    await shoot(guest, "forgot-password-no-smtp");

    // The instance admin (PINWREN_ADMIN_EMAILS) copies a reset link from Users.
    await page.goto("/settings/members");
    await page
      .locator(`[data-member="${pat.email}"]`)
      .getByRole("button", { name: /Actions for/ })
      .click();
    await expect(page.getByRole("menuitem", { name: "Copy password reset link" })).toBeVisible();
    await page.keyboard.press("Escape");
    const { url } = (await (await request.post(`/api/members/${pat.id}/reset-link`)).json()) as {
      url: string;
    };

    await guest.goto(url);
    await guest.getByLabel("New password", { exact: true }).fill("brand-new-password");
    await guest.getByLabel("Confirm new password").fill("brand-new-password");
    await guest.getByRole("button", { name: "Set new password" }).click();
    await expect(guest.getByText("Password changed")).toBeVisible();
    await guest.goto(url);
    await guest.getByLabel("New password", { exact: true }).fill("another-password-1");
    await guest.getByLabel("Confirm new password").fill("another-password-1");
    await guest.getByRole("button", { name: "Set new password" }).click();
    await expect(guest.getByText(/expired or was already used/)).toBeVisible();

    await guest.goto("/sign-in");
    await signIn(guest, pat.email, "brand-new-password");
    await guest.waitForURL("**/inbox");
    await ctx.close();
  });

  test("two-factor: enrol in Profile, then sign-in asks for the code", async ({ request, browser }) => {
    const pat = await addUser(request, "editor");
    const { ctx, page: p } = await freshPage(browser);
    await p.goto("/sign-in");
    await signIn(p, pat.email, pat.password);
    await p.waitForURL("**/inbox");

    await p.goto("/settings");
    await p.getByRole("button", { name: "Turn on" }).click();
    const dialog = p.getByRole("dialog");
    await dialog.getByLabel("Password").fill(pat.password);
    await dialog.getByRole("button", { name: "Continue" }).click();
    const secret = ((await dialog.getByTestId("totp-secret").textContent()) ?? "").replace(/\s/g, "");
    expect(secret.length).toBeGreaterThan(10);
    await shoot(p, "profile-two-factor-setup");
    await dialog.getByLabel("Code from the app").fill(totp(secret));
    await dialog.getByRole("button", { name: "Turn on" }).click();
    await expect(dialog.getByRole("list", { name: "Backup codes" }).getByRole("listitem")).toHaveCount(10);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(p.getByTestId("two-factor-on")).toBeVisible();
    await ctx.close();

    // Signing in again now takes a code.
    const second = await freshPage(browser);
    await second.page.goto("/sign-in");
    await signIn(second.page, pat.email, pat.password);
    await expect(second.page.getByText("Two-factor authentication")).toBeVisible();
    await second.page.getByLabel("Code").fill("000000");
    await second.page.getByRole("button", { name: "Verify" }).click();
    await expect(second.page.locator("form [role=alert]")).toBeVisible();
    await second.page.getByLabel("Code").fill(totp(secret));
    await second.page.getByRole("button", { name: "Verify" }).click();
    await second.page.waitForURL("**/inbox");
    await second.ctx.close();
  });

  test("a deep link survives signing in", async ({ browser }) => {
    const { ctx, page: guest } = await freshPage(browser);
    await guest.goto("/settings/workspace");
    await guest.waitForURL(/\/sign-in\?next=%2Fsettings%2Fworkspace/);
    await signIn(guest, ADMIN.email, ADMIN.password);
    await guest.waitForURL("**/settings/workspace");
    await expect(guest.getByLabel("Workspace name")).toHaveValue("Acme Studio");
    // Signed in, the auth pages send you on.
    await guest.goto("/sign-in");
    await guest.waitForURL("**/inbox");
    await ctx.close();
  });

  test("someone invited who signs up on their own is offered the invitation", async ({
    request,
    browser,
  }) => {
    const email = `onboard-${Date.now().toString(36)}@example.com`;
    const res = await request.post("/api/auth/organization/invite-member", {
      data: { email, role: "member" },
    });
    expect(res.ok()).toBe(true);
    const { ctx, page: guest } = await freshPage(browser);
    await guest.goto("/sign-up");
    await guest.getByLabel("Name").fill("Olive Onboard");
    await guest.getByLabel("Work email").fill(email);
    await guest.getByLabel("Password").fill("onboard-password-1");
    await guest.getByRole("button", { name: "Create account" }).click();
    await guest.waitForURL("**/onboarding");
    const invites = guest.getByTestId("pending-invitations");
    await expect(invites.getByText("Acme Studio", { exact: true })).toBeVisible();
    await expect(invites.getByText(/Editor/)).toBeVisible();
    await shoot(guest, "onboarding-invitations");
    await invites.getByRole("button", { name: "Join Acme Studio" }).click();
    await guest.waitForURL("**/inbox");
    await expect(guest.getByTestId("workspace-name")).toHaveText("Acme Studio");
    await ctx.close();
  });

  test("workspaces: create, follow an ?org= link back, switch, and delete with the name", async ({
    page,
    request,
  }) => {
    const { orgId } = seed();
    const name = `Side project ${Date.now().toString(36)}`;
    await page.goto("/inbox");
    await page.getByTestId("workspace-switcher").click();
    // The seeded admin is reused across runs, so several workspaces may share the name: find this run's.
    await expect(page.locator(`[role="menuitem"][data-org-id="${orgId}"]`)).toContainText("Acme Studio");
    await shoot(page, "workspace-switcher");
    await page.getByRole("menuitem", { name: "Create workspace" }).click();
    await page.getByRole("dialog").getByLabel("Workspace name").fill(name);
    await page.getByRole("dialog").getByRole("button", { name: "Create workspace" }).click();
    await page.waitForURL("**/projects");
    await expect(page.getByTestId("workspace-name")).toHaveText(name);

    // An email link to an item in Acme Studio switches back to it.
    await page.goto(`/inbox?status=all&org=${orgId}`);
    await page.waitForURL((u) => !u.searchParams.has("org"));
    await expect(page.getByTestId("workspace-name")).toHaveText("Acme Studio");

    await page.getByTestId("workspace-switcher").click();
    await page.getByRole("menuitem", { name }).click();
    await expect(page.getByTestId("workspace-name")).toHaveText(name);

    await page.goto("/settings/workspace");
    await page.getByRole("button", { name: "Delete workspace" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Delete workspace" })).toBeDisabled();
    await dialog.getByLabel("Workspace name").fill(name);
    await shoot(page, "workspace-delete");
    await dialog.getByRole("button", { name: "Delete workspace" }).click();
    await page.waitForURL("**/inbox");
    await expect(page.getByTestId("workspace-name")).toHaveText("Acme Studio");
    await page.getByTestId("workspace-switcher").click();
    await expect(page.getByRole("menuitem", { name })).toHaveCount(0);
    // Every spec shares this session, and the active workspace lives on it: hand back the seeded one
    // (after a delete Better Auth may pick another workspace the reused admin belongs to).
    const back = await request.post("/api/auth/organization/set-active", { data: { organizationId: orgId } });
    expect(back.ok()).toBe(true);
  });

  test("Security lists the instance administrators", async ({ page }) => {
    await page.goto("/settings/security");
    const admins = page.getByRole("list", { name: "Instance administrators" });
    await expect(admins.locator(`[data-admin="${ADMIN.email}"]`)).toContainText("PINWREN_ADMIN_EMAILS");
  });
});
