import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { shoot } from "./env";
import { expect, test } from "./fixtures";

// Sign-in methods (wave 5): the instance switches in Settings › Security, a passkey registered in
// Settings › Profile and used on the sign-in page (Chrome's virtual authenticator), and the words for a
// failed Google / GitHub / email-link sign-in. The e2e server has no SMTP and no OAuth apps, like a fresh
// self-hosted install: email links and Google / GitHub are not offered.

async function addEditor(request: APIRequestContext) {
  const tag = Date.now().toString(36);
  const user = { name: `Kit ${tag}`, email: `kit-${tag}@example.com`, password: `kit-password-${tag}` };
  const res = await request.post("/api/members", { data: { ...user, role: "editor" } });
  expect(res.status()).toBe(201);
  return user;
}

async function freshPage(browser: Browser) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  return { ctx, page: await ctx.newPage() };
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

test.describe("sign-in methods", () => {
  test("Security shows the methods; switching passkeys off removes them from the sign-in page", async ({
    page,
    browser,
  }) => {
    await page.goto("/settings/security");
    const card = page.getByTestId("sign-in-methods");
    await expect(card.getByText("Sign-in methods")).toBeVisible();
    // No SMTP on the e2e server: the email-link switch explains why the sign-in page doesn't offer it.
    await expect(card.getByText(/set up SMTP/)).toBeVisible();
    await expect(card.getByText("Not configured")).toHaveCount(2);
    await expect(card.getByText(/\/api\/auth\/callback\/google/)).toBeVisible();
    await shoot(page, "security-sign-in-methods");

    const passkeys = card.getByRole("switch", { name: "Passkeys" });
    await expect(passkeys).toBeChecked();
    await passkeys.click();
    await expect(page.getByText("Passkeys off")).toBeVisible();

    const visitor = await freshPage(browser);
    await visitor.page.goto("/sign-in");
    await expect(visitor.page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await expect(visitor.page.getByRole("button", { name: "Sign in with a passkey" })).toHaveCount(0);
    await expect(visitor.page.getByRole("button", { name: /Continue with/ })).toHaveCount(0);
    await expect(visitor.page.getByRole("button", { name: "Email me a sign-in link" })).toHaveCount(0);

    await passkeys.click();
    await expect(page.getByText("Passkeys on")).toBeVisible();
    await visitor.page.reload();
    await expect(visitor.page.getByRole("button", { name: "Sign in with a passkey" })).toBeVisible();
    await shoot(visitor.page, "sign-in-with-passkey");
    await visitor.ctx.close();
  });

  test("a passkey added in Profile signs in, and can be renamed and removed", async ({
    browser,
    browserName,
    request,
  }) => {
    test.skip(browserName !== "chromium", "the virtual authenticator is a Chrome DevTools feature");
    const user = await addEditor(request);
    const { ctx, page } = await freshPage(browser);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });

    await signIn(page, user.email, user.password);
    await page.goto("/settings");
    await expect(page.getByText("No passkeys yet")).toBeVisible();
    await page.getByRole("button", { name: "Add a passkey" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Work laptop");
    await dialog.getByRole("button", { name: "Create passkey" }).click();
    await expect(page.getByText("Passkey added")).toBeVisible();
    await expect(page.getByTestId("passkey-row")).toContainText("Work laptop");
    await shoot(page, "profile-passkeys");

    // Signed out, the passkey alone signs back in.
    await ctx.clearCookies();
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    await expect(page).not.toHaveURL(/\/sign-in/);

    await page.goto("/settings");
    await page.getByRole("button", { name: "Rename Work laptop" }).click();
    await dialog.getByLabel("Name").fill("Desk laptop");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("passkey-row")).toContainText("Desk laptop");
    await page.getByRole("button", { name: "Remove Desk laptop" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("No passkeys yet")).toBeVisible();
    await ctx.close();
  });

  test("a failed Google / GitHub or email-link sign-in says why", async ({ browser }) => {
    const { ctx, page } = await freshPage(browser);
    await page.goto("/sign-in?error=SIGNUP_CLOSED");
    await expect(page.getByTestId("sign-in-error")).toContainText("by invitation");
    await page.goto("/sign-in?error=account_not_linked");
    await expect(page.getByTestId("sign-in-error")).toContainText("Settings › Profile");
    await page.goto("/sign-in");
    await expect(page.getByTestId("sign-in-error")).toHaveCount(0);
    await ctx.close();
  });
});
