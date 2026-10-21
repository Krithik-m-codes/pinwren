import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { SITE_ORIGIN, seed, shoot } from "./env";
import { expect, test } from "./fixtures";

// Wave 3: panel actions, GitHub issue sync, branding, privacy mode, email templates, security.
// External parties (action receiver, GitHub API) are a local HTTP server on 127.0.0.1.

type Seen = { method: string; url: string; headers: IncomingMessage["headers"]; body: string };

async function fakeServer(handler: (req: Seen) => { status: number; json: unknown }) {
  const seen: Seen[] = [];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => {
      body += c.toString();
    });
    req.on("end", () => {
      const entry = { method: req.method ?? "GET", url: req.url ?? "/", headers: req.headers, body };
      seen.push(entry);
      const out = handler(entry);
      res.statusCode = out.status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(out.json));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, seen, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test.describe("wave 3", () => {
  test("panel actions: editor, then a link and a webhook from the item", async ({
    page,
    request,
    context,
  }) => {
    const { projectId, items } = seed();
    const receiver = await fakeServer(() => ({
      status: 200,
      json: { message: "Agent picked it up (run 42)" },
    }));
    try {
      await page.goto(`/projects/${projectId}?tab=actions`);
      await expect(page.getByText("No actions yet")).toBeVisible();

      // A link with placeholders.
      await page.getByRole("button", { name: "Add action" }).click();
      let dialog = page.getByRole("dialog", { name: "Add an action" });
      await dialog.getByLabel("Label").fill("Create Jira ticket");
      await dialog.getByLabel("URL").fill("javascript:alert(1)");
      await dialog.getByRole("button", { name: "Add action" }).click();
      await expect(dialog.getByText("Use an https:// or http:// URL")).toBeVisible();
      await dialog.getByLabel("URL").fill("https://jira.example.com/create?summary={number}&page={url}");
      await dialog.getByRole("group", { name: "Icon" }).getByRole("button", { name: "Ticket" }).click();
      await dialog.getByRole("button", { name: "Add action" }).click();
      await expect(page.getByText("“Create Jira ticket” added").first()).toBeVisible();

      // A webhook: "who sees it" is locked to the team.
      await page.getByRole("button", { name: "Add action" }).click();
      dialog = page.getByRole("dialog", { name: "Add an action" });
      await dialog.getByLabel("Label").fill("Send to agent");
      await dialog
        .getByRole("group", { name: "Action type" })
        .getByRole("button", { name: "Call a webhook" })
        .click();
      await expect(dialog.getByText("Webhook actions run from the dashboard only.")).toBeVisible();
      await dialog.getByLabel("URL").fill(`${receiver.base}/hook`);
      await dialog.getByRole("button", { name: "Add action" }).click();
      await expect(page.getByText("“Send to agent” added").first()).toBeVisible();
      const list = page.getByRole("list", { name: "Panel actions" });
      await expect(list.locator("[data-action]")).toHaveCount(2);
      await expect(list.locator('[data-action="send-to-agent"]')).toContainText("Team only");

      // The signing secret, revealed.
      await page.getByRole("button", { name: "Reveal secret" }).click();
      const secret = (await page.getByTestId("action-secret").textContent()) ?? "";
      expect(secret).toMatch(/^whsec_/);
      await shoot(page, "project-actions", { fullPage: true });

      // On the item: the link opens with the number filled in; the webhook shows the receiver's message.
      await page.goto(`/inbox?status=all&item=${items.bug.id}`);
      const actions = page.getByTestId("item-actions");
      const link = actions.getByRole("link", { name: "Create Jira ticket" });
      await expect(link).toHaveAttribute(
        "href",
        new RegExp(`summary=${items.bug.number}&page=https%3A%2F%2F`),
      );
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
      await context.route("https://jira.example.com/**", (r) =>
        r.fulfill({ body: "jira", contentType: "text/plain" }),
      );
      const popup = context.waitForEvent("page");
      await link.click();
      const opened = await popup;
      await opened.waitForLoadState();
      expect(opened.url()).toContain(`jira.example.com/create?summary=${items.bug.number}`);
      await opened.close();

      await actions.getByRole("button", { name: "Send to agent" }).click();
      await expect(page.getByText("Agent picked it up (run 42)").first()).toBeVisible();
      const hit = receiver.seen.find((s) => s.url === "/hook");
      if (!hit) throw new Error("the receiver saw no /hook request");
      const ts = String(hit.headers["pinwren-timestamp"]);
      const expected = `v1=${createHmac("sha256", secret).update(`${ts}.${hit.body}`).digest("hex")}`;
      expect(hit.headers["pinwren-signature"]).toBe(expected);
      const timeline = page.getByTestId("feedback-detail").getByRole("region", { name: "Activity" });
      await expect(timeline.getByText(/ran “Send to agent”/)).toBeVisible();
      await shoot(page, "inbox-actions");

      // Webhook actions never reach the widget.
      const cfg = await request.get("/w/config", {
        headers: { "x-pinwren-key": seed().publicKey, origin: SITE_ORIGIN },
      });
      const body = await cfg.text();
      expect(body).toContain("Create Jira ticket");
      expect(body).not.toContain(receiver.base);
    } finally {
      await receiver.close();
    }
  });

  test("GitHub: connect with a token, then Send to GitHub", async ({ page }) => {
    const { projectId, items } = seed();
    let n = 7;
    const gh = await fakeServer((req) => {
      if (req.headers.authorization !== "Bearer ghp_e2e_token_abcd")
        return { status: 401, json: { message: "Bad credentials" } };
      if (req.method === "GET") return { status: 200, json: { full_name: "acme/site" } };
      if (req.method === "POST") {
        n += 1;
        return { status: 201, json: { number: n, html_url: `https://github.example/acme/site/issues/${n}` } };
      }
      return { status: 200, json: {} };
    });
    try {
      await page.goto(`/projects/${projectId}?tab=trackers`);
      const card = page.getByTestId("tracker-github");
      await card.getByRole("button", { name: "Connect GitHub" }).click();
      await card.getByLabel("Access token").fill("ghp_e2e_token_abcd");
      await card.getByLabel("Repository").fill("not a repo");
      await card.getByRole("button", { name: "Connect GitHub" }).click();
      await expect(card.getByText("Enter the repository as owner/name")).toBeVisible();
      await card.getByLabel("Repository").fill("acme/site");
      await card.getByLabel("GitHub Enterprise API URL").fill(gh.base);
      await card
        .getByRole("group", { name: "Open GitHub issues for" })
        .getByRole("button", { name: "Manually" })
        .click();
      await card.getByRole("button", { name: "Connect GitHub" }).click();
      await expect(page.getByText("GitHub connected").first()).toBeVisible();
      await expect(card.getByText("Connected")).toBeVisible();
      await card.getByRole("button", { name: "Test connection" }).click();
      await expect(card.getByRole("status")).toContainText("Can reach acme/site");
      await card.getByRole("button", { name: "Reveal webhook secret" }).click();
      await expect(card.getByTestId("tracker-secret")).toContainText("whsec_");
      await shoot(page, "project-trackers", { fullPage: true });

      await page.goto(`/inbox?status=all&item=${items.pin.id}`);
      const actions = page.getByTestId("item-actions");
      await actions.getByRole("button", { name: "Send to GitHub" }).click();
      await expect(page.getByText(/GitHub issue #\d+ created/).first()).toBeVisible();
      const issue = actions.getByTestId("issue-link");
      await expect(issue).toContainText(/GitHub #\d+/);
      await expect(issue).toHaveAttribute("href", /https:\/\/github\.example\/acme\/site\/issues\/\d+/);
      await expect(actions.getByRole("button", { name: "Send to GitHub" })).toHaveCount(0);
      const created = gh.seen.find((s) => s.method === "POST");
      expect(created?.body).toContain(`/inbox?status=all&item=${items.pin.id}`);
      await shoot(page, "inbox-github-issue");
    } finally {
      await gh.close();
    }
  });

  test("branding: name, logo and accent reach the header", async ({ page }) => {
    await page.goto("/settings/branding");
    await page.getByLabel("Product name").fill("Acme Feedback");
    await page.getByLabel("Product name").press("Enter");
    await expect(page.getByText("Now called Acme Feedback").first()).toBeVisible();
    await expect(page.getByTestId("product-name")).toHaveText("Acme Feedback");

    // A real 64×64 PNG made in the browser.
    const png = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 64;
      const ctx = c.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      ctx.fillStyle = "#e5484d";
      ctx.beginPath();
      ctx.arc(32, 32, 30, 0, Math.PI * 2);
      ctx.fill();
      return c.toDataURL("image/png").split(",")[1] ?? "";
    });
    await page.getByTestId("logo-file").setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    });
    await expect(page.getByText("Logo updated").first()).toBeVisible();
    const headerLogo = page.getByTestId("brand-logo").first();
    await expect(headerLogo).toBeVisible();
    await expect(headerLogo).toHaveAttribute("src", /\/api\/brand-assets\//);

    await page.getByRole("button", { name: /Brand colour/ }).click();
    await page.getByRole("button", { name: "#30a46c" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByText("Accent colour saved").first()).toBeVisible();
    await expect(page.getByTestId("brand-theme")).toHaveCount(1);
    const primary = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
    );
    expect(primary).toBe("#30a46c");
    await shoot(page, "settings-branding", { fullPage: true });

    // The branding survives a reload and applies on other screens.
    await page.goto("/inbox");
    await expect(page.getByTestId("product-name")).toHaveText("Acme Feedback");
    await expect(page.getByTestId("brand-logo").first()).toBeVisible();
  });

  test("privacy mode: toggle, explanation, enforcement", async ({ page, request }) => {
    const { projectId, publicKey } = seed();
    await page.goto(`/projects/${projectId}?tab=privacy`);
    await expect(page.getByRole("list", { name: "What privacy mode does" })).toContainText(
      "Truncates visitor IP",
    );
    await page.getByRole("switch", { name: "Privacy mode" }).click();
    await expect(page.getByText("Privacy mode on").first()).toBeVisible();
    const cfg = await request.get("/w/config", {
      headers: { "x-pinwren-key": publicKey, origin: SITE_ORIGIN },
    });
    const { widget, capture } = (await cfg.json()) as {
      widget: { privacyMode: boolean; consent: { enabled: boolean } };
      capture: { console: string };
    };
    expect(widget.privacyMode).toBe(true);
    expect(widget.consent.enabled).toBe(true);
    expect(["off", "errors"]).toContain(capture.console);
    await shoot(page, "project-privacy-mode", { fullPage: true });
    await page.getByRole("tab", { name: "Widget" }).click();
    await expect(page.getByText("Always shown while privacy mode is on")).toBeVisible();
    // Off again, so the instance's update check isn't paused by this workspace.
    await page.getByRole("tab", { name: "Privacy & data" }).click();
    await page.getByRole("switch", { name: "Privacy mode" }).click();
    await expect(page.getByText("Privacy mode off").first()).toBeVisible();
  });

  test("email templates: edit, preview, reset", async ({ page }) => {
    await page.goto("/settings/email");
    await expect(page.getByText("Email templates")).toBeVisible();
    await page.getByRole("combobox", { name: "Template" }).click();
    await page.getByRole("option", { name: "New feedback" }).click();
    // The preview is a sandboxed frame (no scripts): assert on what it is given, not inside it.
    const frame = page.getByTestId("preview-frame");
    await expect(frame).toHaveAttribute("srcdoc", /Dana Reviewer/);
    await expect(frame).toHaveAttribute("sandbox", "");

    const body = page.getByLabel("Body");
    await body.fill(
      "# Hello team\n\n**{{reporterName}}** found something:\n\n> {{body}}\n\n<b>raw html</b> {{nope}}",
    );
    await expect(page.getByText("Not available in this template: {{nope}}")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save template" })).toBeDisabled();
    await body.fill("# Hello team\n\n**{{reporterName}}** found something:\n\n> {{body}}\n\n<b>raw html</b>");
    await expect(frame).toHaveAttribute("srcdoc", /<h1[^>]*>Hello team<\/h1>/);
    await expect(frame).toHaveAttribute("srcdoc", /&lt;b&gt;raw html&lt;\/b&gt;/);
    await expect(frame).toHaveAttribute("srcdoc", /<strong>Dana Reviewer<\/strong>/);
    await page.getByLabel("Subject").fill("[{{projectName}}] {{reporterName}} wrote");
    await expect(page.getByTestId("preview-subject")).toContainText("[Marketing site] Dana Reviewer wrote");
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByText("“New feedback” saved").first()).toBeVisible();
    await expect(page.getByText("Customised")).toBeVisible();
    await page.getByRole("button", { name: "Send me this email" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Not sent|Test sent|refused/ })).toBeVisible();
    await shoot(page, "settings-email-templates", { fullPage: true });

    await page.getByRole("button", { name: "Reset to default" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Reset" }).click();
    await expect(page.getByText("Back to the default wording").first()).toBeVisible();
    await expect(page.getByLabel("Subject")).toHaveValue("[{{projectName}}] #{{number}} {{title}}");
    await expect(page.getByText("Default", { exact: true })).toBeVisible();
  });

  test("security settings for instance admins", async ({ page }) => {
    await page.goto("/settings/security");
    await expect(page.getByText("Session lifetime")).toBeVisible();
    const days = page.getByLabel("Session lifetime");
    await days.fill("14");
    await days.press("Enter");
    await expect(page.getByText("New sessions last 14 days").first()).toBeVisible();
    await expect(page.getByText("Enforce HTTPS")).toBeVisible();
    await shoot(page, "settings-security", { fullPage: true });
    await days.fill("7");
    await days.press("Enter");
    await expect(page.getByText("New sessions last 7 days").first()).toBeVisible();
  });
});
