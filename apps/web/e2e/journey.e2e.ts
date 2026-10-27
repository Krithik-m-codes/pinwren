import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { SHOTS } from "./env";

// The owner's journey on a fresh self-hosted instance, all through the real UI (playwright.journey.config.ts
// says how to start the server). One account administers the server from the start (BugPin model): it
// creates the workspace and project, pastes the install snippet into a customer site, and the feedback sent
// from that site shows up live in the inbox and the bell. SMTP stays unset (no mail catcher): the delivery log
// records what was skipped; the owner enters real SMTP credentials afterwards.

const SITE_PORT = 5555;
const SITE = `http://localhost:${SITE_PORT}`;
const tag = Date.now().toString(36);
const OWNER = { name: "Olive Owner", email: `owner-${tag}@example.com`, password: "owner-password-1" };
const EDITOR = { name: "Eddie Editor", email: `editor-${tag}@example.com`, password: "editor-password-1" };

let snippet = "";
let server: Server;
let admin: BrowserContext;
let dash: Page;

async function shot(page: Page, name: string) {
  // The Next dev-tools badge isn't part of the product (it sits over the account avatar).
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.screenshot({ path: join(SHOTS, `journey-${name}.png`) });
}

/** Wait for entrance animations (widget speed dial and sidebar, dashboard popovers) to finish. */
const settle = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      [
        ...document.getAnimations(),
        ...(document.querySelector("pinwren-root")?.shadowRoot?.getAnimations() ?? []),
      ]
        // Spinners and pulsing dots never finish.
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished),
    ).then(() => undefined),
  );

/** The customer's site: a plain page with whatever the Install tab gave us pasted before </body>. */
function sitePage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Horizon Studio</title>
<style>body{font-family:system-ui;margin:0}header{padding:64px 32px;background:#eef2ff}h1{font-size:48px;margin:0 0 12px}
section{padding:32px;display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.card{border:1px solid #ddd;border-radius:12px;padding:24px;height:140px}</style>
</head><body>
<header><h1 id="hero">We craft digital experiences</h1><p id="lede">Design and development for startups.</p>
<button id="cta">View our work</button></header>
<section><div class="card" id="card-1">Lumen</div><div class="card" id="card-2">Vertex SaaS</div><div class="card" id="card-3">Orbit</div></section>
<script>document.getElementById("cta").onclick=()=>{console.error("checkout: price is undefined");fetch("/api/missing").catch(()=>{});};</script>
${snippet}
</body></html>`;
}

/** The widget's shadow root is closed in production; tests open it to reach its controls. */
async function customerPage(ctx: BrowserContext) {
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- re-invoked with the element as `this`
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init: ShadowRootInit) {
      return attach.call(this, { ...init, mode: "open" });
    };
  });
  await page.goto(SITE);
  await expect(page.locator("pinwren-root .launcher")).toBeVisible();
  return page;
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test.describe.serial("fresh install journey", () => {
  test.beforeAll(async ({ browser }) => {
    server = createServer((req, res) => {
      if (req.url === "/" || req.url?.startsWith("/?")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(sitePage());
      } else {
        res.writeHead(404);
        res.end("not found");
      }
    });
    await new Promise<void>((resolve) => server.listen(SITE_PORT, resolve));
    server.unref();
    admin = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
    dash = await admin.newPage();
  });

  test.afterAll(async () => {
    await admin.close();
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  });

  test("1. the first account becomes the administrator", async () => {
    await dash.goto("/sign-up");
    await expect(dash.getByText("Create the administrator account")).toBeVisible();
    await dash.getByLabel("Name").fill(OWNER.name);
    await dash.getByLabel("Work email").fill(OWNER.email);
    await dash.getByLabel("Password").fill(OWNER.password);
    await shot(dash, "01-sign-up");
    await dash.getByRole("button", { name: "Create account" }).click();
    await expect(dash).toHaveURL(/\/onboarding/, { timeout: 90_000 });
    const setup = (await (await dash.request.get("/api/setup")).json()) as { needed: boolean };
    expect(setup.needed).toBe(false);
  });

  test("2. onboarding creates the workspace and the first project", async () => {
    await expect(dash.getByText("Set up your workspace", { exact: true })).toBeVisible();
    await dash.getByLabel("Workspace name").fill("Horizon Studio");
    await dash.getByLabel("First project").fill("Marketing site");
    await dash.getByLabel("Website domain").fill(SITE);
    await shot(dash, "02-onboarding");
    await dash.getByRole("button", { name: "Continue" }).click();
    await expect(dash).toHaveURL(/\/projects\/[^/?]+\?tab=install/, { timeout: 90_000 });
  });

  test("3. the install snippet goes onto the site and the project connects", async () => {
    await expect(dash.getByTestId("install-waiting")).toBeVisible();
    snippet = ((await dash.locator("pre").first().textContent()) ?? "").trim();
    expect(snippet).toMatch(
      /^<script src="https?:\/\/[^"/]+\/widget\.js" data-project="pk_[^"]+" async><\/script>$/,
    );
    expect(snippet).toContain(`src="${new URL(dash.url()).origin}/widget.js"`);
    await shot(dash, "03-install-waiting");
    const site = await customerPage(admin);
    await expect(dash.getByTestId("install-connected")).toBeVisible({ timeout: 60_000 });
    await shot(dash, "03-install-connected");
    await site.close();
  });

  test("4. Settings › Email: the admin can edit SMTP and test unsaved values", async () => {
    await dash.goto("/settings/email");
    await expect(dash.getByText("Outgoing email (SMTP)")).toBeVisible();
    await expect(dash.getByTestId("smtp-not-configured")).toBeVisible();
    await dash.getByLabel("SMTP host").fill("127.0.0.1");
    await dash.getByLabel("Port").fill("9");
    await dash.getByLabel("From address").fill("Pinwren <noreply@example.com>");
    await dash.getByTestId("smtp-test").click();
    await expect(dash.getByTestId("smtp-test-result")).toContainText(/connect|refused|Connection/i);
    await shot(dash, "04-smtp-test");
    // Leave it unsaved: SMTP stays "not set up" until the owner enters real credentials.
    await dash.reload();
    await expect(dash.getByTestId("smtp-not-configured")).toBeVisible();
  });

  test("5. Notifications › General, Reporter and Email templates", async () => {
    await dash.goto("/settings/notifications");
    await dash.getByRole("tab", { name: "General" }).click();
    await dash.getByLabel("Add an email address").fill("boss@example.com");
    await dash.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dash.getByTestId("notify-emails")).toContainText("boss@example.com");
    await shot(dash, "05-notifications-general");
    await dash.getByRole("tab", { name: "Reporter" }).click();
    await expect(dash.getByText("Report received")).toBeVisible();
    await shot(dash, "05-notifications-reporter");
    await dash.getByRole("tab", { name: "Email templates" }).click();
    await expect(dash.getByRole("combobox", { name: "Template" })).toBeVisible();
    await expect(dash.getByTestId("preview-subject")).not.toBeEmpty();
  });

  test("6–7. feedback from the site arrives live in the inbox and the bell", async ({ browser }) => {
    await dash.goto("/inbox");
    const rows = dash.locator("li[data-row-id]");
    await expect(dash.getByTestId("notifications-bell")).toBeVisible();
    const before = await rows.count();
    // The setup checklist: the widget connected in step 3, no report yet.
    const checklist = dash.getByTestId("setup-checklist");
    await expect(checklist.locator('[data-step="widget"]')).toHaveAttribute("data-done", "true");
    await expect(checklist.locator('[data-step="feedback"]')).not.toHaveAttribute("data-done");

    // The visitor is someone else: their own browser.
    const visitor = await browser.newContext();
    const site = await customerPage(visitor);
    const launcher = site.locator("pinwren-root .launcher");
    await launcher.click();
    // A public website keeps reports private: a new visitor has nothing to show yet, so no markers or sidebar.
    for (const name of [/Create new annotation/, /Report a bug/])
      await expect(site.getByRole("menuitem", { name })).toBeVisible();
    await expect(site.getByRole("menuitemcheckbox", { name: /Hide markers/ })).toHaveCount(0);
    await expect(site.getByRole("menuitem", { name: /Show sidebar/ })).toHaveCount(0);

    // Drag-select the hero as a Bug.
    await site.getByRole("menuitem", { name: /Create new annotation/ }).click();
    const hero = await site.locator("#hero").boundingBox();
    if (!hero) throw new Error("no hero");
    await site.mouse.move(hero.x + 10, hero.y + 5);
    await site.mouse.down();
    await site.mouse.move(hero.x + 200, hero.y + 40, { steps: 5 });
    await site.mouse.move(hero.x + 420, hero.y + 60, { steps: 5 });
    await site.mouse.up();
    const composer = site.getByRole("dialog", { name: "New comment" });
    await expect(composer).toBeVisible();
    await composer.getByRole("radio", { name: "Bug" }).click();
    await composer.getByLabel("Your comment").fill("The headline overlaps the nav on tablets");
    const name = composer.getByLabel("Your name");
    if (await name.count()) await name.fill("Maria Visitor");
    await shot(site, "06-composer");
    await site.keyboard.press("Control+Enter");
    await expect(site.locator("pinwren-root .toast")).toHaveText(/#\d+ sent/);

    // Live, without a reload.
    await expect(rows).toHaveCount(before + 1, { timeout: 30_000 });
    await expect(dash.getByTestId("notifications-bell")).toHaveAccessibleName(/1 unread/, {
      timeout: 30_000,
    });
    // …and the checklist ticks "Receive your first report" on the same live event.
    await expect(checklist.locator('[data-step="feedback"]')).toHaveAttribute("data-done", "true");

    // Their own feedback is theirs to see: the speed dial now offers the markers and the sidebar.
    await launcher.click();
    for (const name of [/Hide markers/, /Create new annotation/, /Report a bug/, /Show sidebar/])
      await expect(
        site.getByRole("menuitem", { name }).or(site.getByRole("menuitemcheckbox", { name })),
      ).toBeVisible();
    await settle(site);
    await shot(site, "06-speed-dial");
    await site.keyboard.press("Escape");

    // A click-pinned "Change".
    await site.keyboard.press("c");
    const card = await site.locator("#card-2").boundingBox();
    if (!card) throw new Error("no card");
    await site.mouse.click(card.x + card.width / 2, card.y + card.height / 2);
    await expect(composer).toBeVisible();
    await composer.getByRole("radio", { name: "Change" }).click();
    await composer.getByLabel("Your comment").fill("Can this card link to the case study?");
    await composer.getByRole("button", { name: "Send" }).click();
    await expect(site.locator("pinwren-root .toast")).toHaveText(/#\d+ sent/);
    await expect(rows).toHaveCount(before + 2, { timeout: 30_000 });

    // A full bug report with a screenshot, after the visitor hits the broken button (console error + 404).
    await site.locator("#cta").click();
    await launcher.click();
    await site.getByRole("menuitem", { name: /Report a bug/ }).click();
    const report = site.getByRole("dialog", { name: "Report a bug" });
    await expect(report).toBeVisible();
    await expect(report.locator("pinwren-root .ed canvas, .ed canvas").first()).toBeVisible({
      timeout: 30_000,
    });
    await report.getByLabel("Title").fill("Price shows undefined at checkout");
    await report
      .getByLabel("Describe the bug")
      .fill("Click View our work, then checkout: the price is blank.");
    const email = report.getByLabel(/Your email/).first();
    if (await email.isVisible()) await email.fill(`maria-${tag}@example.com`);
    await shot(site, "06-bug-report");
    await report.getByRole("button", { name: "Send report" }).click();
    await expect(site.locator("pinwren-root .toast").last()).toHaveText(/Bug report #\d+ sent/);
    await expect(rows).toHaveCount(before + 3, { timeout: 30_000 });
    await expect(dash.getByTestId("notifications-bell")).toHaveAccessibleName(/3 unread/, {
      timeout: 30_000,
    });

    await dash.getByTestId("notifications-bell").click();
    await expect(dash.getByTestId("notification-item").first()).toContainText(/New bug report/);
    await settle(dash);
    await shot(dash, "07-bell");
    await dash.keyboard.press("Escape");

    // The sidebar on the site: stats, filters, the visitor's own cards.
    await launcher.click();
    await site.getByRole("menuitem", { name: /Show sidebar/ }).click();
    const bar = site.getByRole("complementary", { name: "Feedback sidebar" });
    await expect(bar).toBeVisible();
    await expect(bar.locator(".stats")).toContainText("Open");
    await expect(bar.locator(".fcard")).toHaveCount(3);
    await settle(site);
    // The panel and every control in it fit the viewport: nothing clipped on the right.
    const vw = site.viewportSize()?.width ?? 0;
    const panelBox = await bar.boundingBox();
    expect(panelBox && panelBox.x >= 0 && panelBox.x + panelBox.width <= vw).toBe(true);
    const clipped = await bar.evaluate((el) => {
      const right = el.getBoundingClientRect().right;
      return [...el.querySelectorAll("button, input, .stats")]
        .filter((c) => c.getBoundingClientRect().width > 0 && c.getBoundingClientRect().right > right + 0.5)
        .map((c) => c.textContent.trim() || c.getAttribute("aria-label") || c.tagName);
    });
    expect(clipped).toEqual([]);
    // A bug report has no pin: "Whole page", never the "not on this version" orphan label.
    const bugCard = bar.locator(".fcard").filter({ hasText: "Price shows undefined" });
    await expect(bugCard).toContainText("Whole page");
    await expect(bar).not.toContainText("Not on this version");
    await shot(site, "06-sidebar");
    await bar.getByRole("button", { name: "Close sidebar" }).click();

    // Hovering a marker previews it.
    await site.locator("pinwren-root .pin:not(.draft)").first().hover();
    await expect(site.locator("pinwren-root .card.preview")).toBeVisible();

    // The bug report in the dashboard: screenshot, page, browser, console.
    await rows.filter({ hasText: "Price shows undefined" }).first().click();
    const detail = dash.getByTestId("feedback-detail");
    await expect(detail).toBeVisible();
    await expect(detail.getByRole("img", { name: /Screenshot attached to #\d+/ })).toBeVisible();
    await expect(detail.getByText(`${SITE}/`).first()).toBeVisible();
    await expect(detail.getByText(/Chrome/).first()).toBeVisible();
    await detail.getByRole("tab", { name: /Console/ }).click();
    await expect(detail.getByText("checkout: price is undefined")).toBeVisible();
    await shot(dash, "07-detail");

    // A public reply to the drag-selected bug reaches the visitor under its pin.
    await rows.filter({ hasText: "headline overlaps" }).first().click();
    await detail.getByRole("tab", { name: "Public reply" }).click();
    await detail.getByLabel("Comment").fill("Thanks Maria, fixing the tablet breakpoint today.");
    await detail.getByRole("button", { name: "Send" }).click();
    await expect(detail.getByText("fixing the tablet breakpoint")).toBeVisible();

    await site.reload();
    await expect(launcher).toBeVisible();
    await launcher.click();
    await site.getByRole("menuitem", { name: /Show sidebar/ }).click();
    await bar.locator(".fcard").filter({ hasText: "headline overlaps" }).locator(".fmain").click();
    await expect(site.getByText("fixing the tablet breakpoint")).toBeVisible();
    await shot(site, "07-reply-on-site");
    await visitor.close();
  });

  test("4b. emails that couldn't go out are in the delivery log", async () => {
    await dash.goto("/settings/email");
    const log = dash.getByTestId("email-deliveries");
    await expect(log).toBeVisible();
    await expect(log).toContainText("boss@example.com");
    await expect(log).toContainText(/not configured|Skipped/i);
    await shot(dash, "04-delivery-log");
  });

  test("8. Add User creates an Editor who can't reach settings", async ({ browser }) => {
    await dash.goto("/settings/members");
    await dash.getByRole("button", { name: "Add user" }).click();
    const dialog = dash.getByRole("dialog");
    await dialog.getByLabel("Name").fill(EDITOR.name);
    await dialog.getByLabel("Email").fill(EDITOR.email);
    await dialog.getByLabel("Password").fill(EDITOR.password);
    await dialog.getByRole("combobox", { name: "Role" }).click();
    await dash.getByRole("option", { name: "Editor" }).click();
    await dialog.getByRole("button", { name: "Add user" }).click();
    await expect(dialog.getByText(`${EDITOR.name} can sign in now`)).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();
    await shot(dash, "08-users");

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await signIn(page, EDITOR.email, EDITOR.password);
    await expect(page).toHaveURL(/\/inbox/);
    await expect(page.locator("li[data-row-id]")).toHaveCount(3);
    const res = await page.request.get("/api/admin/settings/email");
    expect(res.status()).toBe(403);
    await page.goto("/settings");
    await expect(page.getByRole("link", { name: "Email", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Integrations", exact: true })).toHaveCount(0);
    await ctx.close();
  });

  test("9. forgot password without SMTP: ask the admin, who copies a reset link", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/sign-in");
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page.getByText("Ask your administrator")).toBeVisible();
    await shot(page, "09-forgot-password");

    await dash.goto("/settings/members");
    await dash.getByRole("button", { name: `Actions for ${EDITOR.name}` }).click();
    await dash.getByRole("menuitem", { name: "Copy password reset link" }).click();
    await expect(dash.getByText(/Reset link for .* copied/)).toBeVisible();
    const url = await dash.evaluate(() => navigator.clipboard.readText());
    expect(url).toMatch(/reset-password/);

    await page.goto(url);
    const fresh = "editor-password-2";
    await page.getByLabel("New password", { exact: true }).fill(fresh);
    const confirm = page.getByLabel(/Confirm/);
    if (await confirm.count()) await confirm.fill(fresh);
    await page.getByRole("button", { name: /Set|Reset|Save/ }).click();
    await signIn(page, EDITOR.email, fresh);
    await expect(page).toHaveURL(/\/inbox/);
    await ctx.close();
  });
});
