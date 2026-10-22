import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import type { APIRequestContext, Browser, BrowserContext, Page } from "@playwright/test";
import { request as playwrightRequest } from "@playwright/test";
import { SITE_ORIGIN, seed, shoot } from "./env";
import { expect, test } from "./fixtures";

// Wave 4 in the dashboard: live inbox, presence, review rounds, saved views, session replay, signed identity,
// consent record, the viewer role, Settings › Licence, widget cache headers and a 10 MB replay upload.

const REPO = join(__dirname, "..", "..", "..");
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";

const env = {
  userAgent: "Mozilla/5.0 (e2e) Chrome/140",
  browser: "Chrome 140",
  os: "Windows 11",
  viewport: { w: 1280, h: 800 },
  dpr: 1,
  locale: "en-GB",
  timezone: "Europe/London",
};

/** POST /w/feedback as the widget does (public key + allowed origin). */
async function widgetPost(request: APIRequestContext, body: Record<string, unknown>) {
  const { publicKey } = seed();
  const r = await request.post("/w/feedback", {
    headers: { "x-pinwren-key": publicKey, origin: SITE_ORIGIN },
    data: {
      clientId: randomUUID(),
      kind: "bug",
      body: "From the widget",
      page: { url: `${SITE_ORIGIN}/live`, title: "Live" },
      environment: env,
      ...body,
    },
  });
  expect(r.status(), await r.text()).toBe(201);
  return ((await r.json()) as { feedback: { id: string; number: number } }).feedback;
}

/** A second member of the workspace, signed in in its own browser context. */
async function newMember(
  browser: Browser,
  admin: APIRequestContext,
  role: "viewer" | "member",
  name: string,
): Promise<{ ctx: BrowserContext; page: Page; email: string }> {
  const email = `${role}-${Date.now().toString(36)}@example.com`;
  const inv = await admin.post("/api/auth/organization/invite-member", {
    headers: { origin: BASE },
    data: { email, role },
  });
  expect(inv.ok(), await inv.text()).toBe(true);
  const { id } = (await inv.json()) as { id: string };
  const api = await playwrightRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { origin: BASE } });
  expect(
    (
      await api.post("/api/auth/sign-up/email", { data: { name, email, password: "member-password-1" } })
    ).ok(),
  ).toBe(true);
  expect(
    (await api.post("/api/auth/organization/accept-invitation", { data: { invitationId: id } })).ok(),
  ).toBe(true);
  expect(
    (await api.post("/api/auth/organization/set-active", { data: { organizationId: seed().orgId } })).ok(),
  ).toBe(true);
  const ctx = await browser.newContext({ storageState: await api.storageState() });
  await api.dispose();
  return { ctx, page: await ctx.newPage(), email };
}

test.describe("wave 4", () => {
  test("live inbox: new items slide in, the pill when scrolled, verified reporters and consent", async ({
    page,
    request,
  }) => {
    const { projectId } = seed();
    await page.setViewportSize({ width: 1440, height: 420 });
    await page.goto(`/inbox?project=${projectId}&status=all`);
    const rows = page.locator("[data-row-id]");
    await expect(rows.first()).toBeVisible();
    await expect(page.locator("ul[aria-label=Feedback][data-ready]")).toBeVisible();

    // A signed identity: HMAC-SHA256(project identity secret, user id).
    const { secret } = (await (await request.get(`/api/projects/${projectId}/identity-secret`)).json()) as {
      secret: string;
    };
    const signature = createHmac("sha256", secret).update("user-42").digest("hex");
    const live = await widgetPost(request, {
      title: "Live: the cart total is wrong",
      reporter: { name: "Vera Verified", email: "vera@client.example", externalId: "user-42", signature },
      consent: { version: "1-0badc0de", acceptedAt: new Date().toISOString() },
    });
    // No reload: the stream event refetches the list and the row slides in.
    const row = page.locator(`[data-row-id="${live.id}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toHaveAttribute("data-fresh", "true");
    await expect(row.getByLabel("Verified reporter")).toBeVisible();
    await shoot(page, "live-inbox-new-item");

    // Scrolled down, new items wait behind the pill.
    await page.locator("ul[aria-label=Feedback]").evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await page.locator("ul[aria-label=Feedback]").dispatchEvent("scroll");
    const later = await widgetPost(request, { title: "Live: second report while scrolled" });
    const pill = page.getByTestId("new-items-pill");
    await expect(pill).toHaveText(/1 new/, { timeout: 15_000 });
    await expect(page.locator(`[data-row-id="${later.id}"]`)).toHaveCount(0);
    await shoot(page, "live-inbox-pill");
    await pill.click();
    await expect(page.locator(`[data-row-id="${later.id}"]`)).toBeVisible();
    await expect(pill).toHaveCount(0);

    // The item: verified badge, signed user id and the consent record.
    await row.getByRole("button").first().click();
    const detail = page.getByTestId("feedback-detail");
    await expect(detail.getByTestId("verified-reporter")).toBeVisible();
    await expect(detail.getByTestId("consent-record")).toContainText("1-0badc0de");
    await expect(detail.getByText("user-42")).toBeVisible();
  });

  test("presence and the viewer role: read-only screens, avatars on what others have open", async ({
    page,
    request,
    browser,
  }) => {
    test.setTimeout(120_000);
    const { projectId, items } = seed();
    const viewer = await newMember(browser, request, "viewer", "Vic Viewer");
    try {
      // The viewer sees everything but no control that changes something.
      await viewer.page.goto(`/inbox?project=${projectId}&status=all&item=${items.bug.id}`);
      await expect(viewer.page.getByTestId("read-only-badge")).toBeVisible();
      const vDetail = viewer.page.getByTestId("feedback-detail");
      await expect(vDetail.getByTestId("read-only-fields")).toBeVisible();
      await expect(vDetail.getByRole("combobox", { name: "Status" })).toHaveCount(0);
      await expect(vDetail.getByRole("textbox", { name: "Comment" })).toHaveCount(0);
      await expect(vDetail.getByText("You have read-only access")).toBeVisible();
      await expect(viewer.page.getByRole("checkbox", { name: /Select #/ })).toHaveCount(0);
      await shoot(viewer.page, "viewer-inbox");

      // The admin sees the viewer on that item, in the list and in its header.
      await page.goto(`/inbox?project=${projectId}&status=all&item=${items.bug.id}`);
      const presence = page.locator(`[data-row-id="${items.bug.id}"]`).getByTestId("presence");
      await expect(presence).toHaveAttribute("aria-label", /Vic Viewer/, { timeout: 30_000 });
      await expect(page.getByTestId("feedback-detail").getByTestId("presence")).toBeVisible();
      await shoot(page, "presence");

      // Keyboard writes are ignored, project settings are read-only, no invite form.
      await viewer.page.keyboard.press("e");
      await expect(vDetail.getByTestId("status-picker")).not.toContainText("Resolved");
      await viewer.page.goto(`/projects/${projectId}?tab=widget`);
      await expect(viewer.page.getByTestId("read-only-notice")).toBeVisible();
      await expect(viewer.page.getByRole("switch", { name: "Read-only" })).toBeDisabled();
      await viewer.page.goto("/settings/members");
      await expect(viewer.page.getByRole("list", { name: "Members" }).getByText("Vic Viewer")).toBeVisible();
      await expect(viewer.page.getByRole("button", { name: "Send invite" })).toHaveCount(0);

      // Admins pick Viewer in the role picker.
      await page.goto("/settings/members");
      const member = page.locator(`[data-member="${viewer.email}"]`);
      await expect(member.getByRole("combobox", { name: /Role of/ })).toContainText("Viewer");
      await member.getByRole("combobox", { name: /Role of/ }).click();
      await page.getByRole("option", { name: "Member" }).click();
      await expect(page.getByText("Vic Viewer is now member")).toBeVisible();
    } finally {
      await viewer.ctx.close();
    }
  });

  test("review rounds: create with a due date, assign items, progress, export CSV and PDF, close", async ({
    page,
  }) => {
    const { projectId, items } = seed();
    await page.goto(`/projects/${projectId}/rounds`);
    await expect(page.getByText("No review rounds yet")).toBeVisible();
    await shoot(page, "rounds-empty");

    await page.getByTestId("new-round").click();
    const dialog = page.getByRole("dialog", { name: "New review round" });
    await dialog.getByRole("button", { name: "Start round" }).click();
    await expect(dialog.getByText("Name the round")).toBeVisible();
    await dialog.getByLabel("Name").fill("Pricing review");
    await dialog.getByRole("button", { name: /Due date/ }).click();
    await page.locator(".rdp-day:not(.rdp-outside) button").last().click();
    await dialog.getByRole("button", { name: "Start round" }).click();
    const card = page.locator('[data-round="Pricing review"]');
    await expect(card).toBeVisible();
    await expect(card.getByText(/^Due /)).toBeVisible();
    await expect(card.getByTestId("round-counts")).toContainText("0 of 0 done");

    // Assign two items from the inbox: the bulk bar and the detail's round picker.
    await page.goto(`/inbox?project=${projectId}&status=all`);
    await expect(page.locator("ul[aria-label=Feedback][data-ready]")).toBeVisible();
    await page.getByRole("checkbox", { name: `Select #${items.region.number}` }).click();
    const bar = page.getByRole("toolbar", { name: "Bulk actions" });
    await bar.getByRole("button", { name: "Round" }).click();
    await page.getByRole("menuitem", { name: "Pricing review" }).click();
    await expect(page.getByText("1 added to Pricing review").first()).toBeVisible();
    await bar.getByRole("button", { name: "Clear selection" }).click();
    await page.goto(`/inbox?project=${projectId}&status=all&item=${items.pin.id}`);
    await page.getByTestId("round-picker").click();
    const saved = page.waitForResponse(
      (r) => r.request().method() === "PATCH" && r.url().includes("/api/feedback/"),
    );
    await page.getByRole("option", { name: "Pricing review" }).click();
    expect((await saved).ok()).toBe(true);
    await expect(page.getByTestId("round-picker")).toContainText("Pricing review");

    // Progress counts the round's items; "View items" filters the inbox by it.
    await page.goto(`/projects/${projectId}/rounds`);
    await expect(card.getByTestId("round-counts")).toContainText("of 2 done");
    await shoot(page, "rounds-list");
    await card.getByRole("link", { name: "View items" }).click();
    await page.waitForURL(/round=/);
    await expect(page.locator("[data-row-id]")).toHaveCount(2);
    await expect(page.getByRole("list", { name: "Active filters" })).toContainText("Round: Pricing review");

    // Exports download.
    await page.goto(`/projects/${projectId}/rounds`);
    for (const [label, ext] of [
      ["Export CSV", ".csv"],
      ["Export PDF", ".pdf"],
    ] as const) {
      await card.getByRole("button", { name: "Actions for Pricing review" }).click();
      const download = page.waitForEvent("download");
      await page.getByRole("menuitem", { name: label }).click();
      const file = await download;
      expect(file.suggestedFilename()).toMatch(new RegExp(`\\${ext}$`));
      const path = await file.path();
      const bytes = readFileSync(path);
      if (ext === ".csv") expect(bytes.toString("utf8")).toContain("Is the trial 14 or 30 days?");
      else expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    }

    // Close it; the active-round setting follows.
    await card.getByRole("button", { name: "Close" }).click();
    await expect(card.getByText("Closed", { exact: true })).toBeVisible();
    await page.goto(`/projects/${projectId}?tab=widget`);
    await expect(page.getByRole("combobox", { name: "Active round" })).toContainText("No round");
  });

  test("saved views: save filters, shared in the sidebar, apply, update, delete", async ({ page }) => {
    const { projectId } = seed();
    await page.goto(`/inbox?project=${projectId}&status=all`);
    await page.getByTestId("filter-menu").click();
    await page.getByRole("menuitem", { name: "Priority" }).click();
    await page.getByRole("menuitemradio", { name: "High" }).click();
    await page.keyboard.press("Escape");
    const chips = page.getByRole("list", { name: "Active filters" });
    await expect(chips).toContainText("Priority: High");

    await page.getByTestId("save-view").click();
    const dialog = page.getByRole("dialog", { name: "Save view" });
    await dialog.getByLabel("Name").fill("Hot bugs");
    await dialog.getByRole("switch").click();
    await dialog.getByRole("button", { name: "Save view" }).click();
    const views = page.getByRole("list", { name: "Saved views" });
    await expect(views.getByRole("link", { name: "Hot bugs" })).toBeVisible();
    await shoot(page, "saved-view");

    // Apply it from elsewhere.
    await page.goto("/settings");
    await views.getByRole("link", { name: "Hot bugs" }).click();
    await page.waitForURL(/saved=/);
    await expect(chips).toContainText("Priority: High");

    // Change the filters: "Update" stores them.
    await chips.getByRole("button", { name: /Remove filter: Priority/ }).click();
    await page.getByRole("button", { name: /Update “Hot bugs”/ }).click();
    await expect(page.getByText("“Hot bugs” updated").first()).toBeVisible();

    await views.locator('[data-view="Hot bugs"]').hover();
    await views.getByRole("button", { name: "Actions for view Hot bugs" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(views.getByRole("link", { name: "Hot bugs" })).toHaveCount(0);
  });

  test("session replay plays in the item with console and network markers", async ({ page, request }) => {
    const { projectId } = seed();
    const r = await request.patch(`/api/projects/${projectId}`, {
      data: { captureConfig: { replay: { enabled: true } } },
    });
    expect(r.ok()).toBe(true);
    const t0 = Date.now() - 10_000;
    const events = [
      { type: 4, timestamp: t0, data: { href: `${SITE_ORIGIN}/checkout`, width: 1280, height: 800 } },
      {
        type: 2,
        timestamp: t0 + 10,
        data: {
          node: {
            type: 0,
            id: 1,
            childNodes: [
              { type: 1, name: "html", publicId: "", systemId: "", id: 2 },
              {
                type: 2,
                tagName: "html",
                attributes: {},
                id: 3,
                childNodes: [
                  { type: 2, tagName: "head", attributes: {}, id: 4, childNodes: [] },
                  {
                    type: 2,
                    tagName: "body",
                    attributes: {},
                    id: 5,
                    childNodes: [
                      {
                        type: 2,
                        tagName: "button",
                        attributes: { id: "pay" },
                        id: 6,
                        childNodes: [{ type: 3, textContent: "Pay now", id: 7 }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          initialOffset: { left: 0, top: 0 },
        },
      },
      { type: 3, timestamp: t0 + 3000, data: { source: 2, type: 2, id: 6, x: 10, y: 10 } },
      { type: 3, timestamp: t0 + 6000, data: { source: 2, type: 2, id: 6, x: 12, y: 12 } },
    ];
    const gz = gzipSync(Buffer.from(JSON.stringify(events)));
    const f = await widgetPost(request, {
      title: "Replay: pay button dead",
      replay: {
        dataUrl: `data:application/gzip;base64,${gz.toString("base64")}`,
        durationMs: 6000,
        events: events.length,
      },
      diagnostics: {
        console: [{ level: "error", message: "TypeError: total is undefined", at: t0 + 3100 }],
        network: [
          { method: "POST", url: `${SITE_ORIGIN}/api/pay`, status: 500, durationMs: 120, at: t0 + 3200 },
        ],
      },
    });
    await page.goto(`/inbox?project=${projectId}&status=all&item=${f.id}`);
    const detail = page.getByTestId("feedback-detail");
    const replay = detail.getByTestId("replay");
    await expect(replay.locator(".rr-player")).toBeVisible({ timeout: 20_000 });
    await expect(replay.getByTestId("replay-marker")).toHaveCount(2);
    await shoot(page, "replay");

    // Jumping to the error marker highlights the console entry logged at that moment.
    await replay.getByRole("button", { name: /Jump to error/ }).click();
    await detail.getByRole("tab", { name: /Console/ }).click();
    await expect(detail.getByTestId("console-entries").locator("li").first()).toHaveAttribute(
      "data-now",
      "true",
    );
    // And a console entry seeks the replay.
    await detail.getByTestId("console-entries").getByRole("button").first().click();
    await expect(replay.getByTestId("replay-marker").first()).toBeVisible();
  });

  test("licence: upgrade note, upload a signed licence, inspect, remove", async ({ page, request }) => {
    const { projectId } = seed();
    await request.delete("/api/admin/license");
    await page.goto(`/projects/${projectId}?tab=widget`);
    await expect(page.getByTestId("upgrade-note")).toBeVisible();

    const { signLicense } = (await import(pathToFileURL(join(REPO, "tools/sign-license/lib.mjs")).href)) as {
      signLicense: (payload: Record<string, unknown>, key: string) => string;
    };
    // The throwaway dev key (tools/sign-license/README.md) — trusted only outside production.
    const devKey = readFileSync(join(REPO, "tools/sign-license/dev-private-key.pem"), "utf8");
    const now = Date.now();
    const license = signLicense(
      {
        kid: "dev-2026",
        lid: `lic_e2e_${now}`,
        customer: "E2E Agency GmbH",
        features: ["white_label"],
        limits: { seats: 25 },
        issuedAt: new Date(now - 86_400_000).toISOString(),
        expiresAt: new Date(now + 365 * 86_400_000).toISOString(),
        graceDays: 30,
      },
      devKey,
    );

    try {
      await page.goto("/settings/license");
      await expect(page.getByTestId("license-status")).toContainText("Community");
      await page.getByTestId("upload-license").click();
      const dialog = page.getByRole("dialog", { name: "Install a licence" });
      await dialog.getByLabel("Licence").fill("not-a-licence-at-all");
      await dialog.getByRole("button", { name: "Install licence" }).click();
      await expect(dialog.getByRole("textbox", { name: "Licence" })).toHaveAttribute("aria-invalid", "true");
      await dialog.locator('[data-testid="license-file"]').setInputFiles({
        name: "agency.lic",
        mimeType: "text/plain",
        buffer: Buffer.from(license),
      });
      await expect(dialog.getByLabel("Licence")).toHaveValue(license);
      await dialog.getByRole("button", { name: "Install licence" }).click();
      const status = page.getByTestId("license-status");
      await expect(status).toContainText("Active");
      await expect(page.getByTestId("license-customer")).toHaveText("E2E Agency GmbH");
      await expect(page.locator('[data-feature="white_label"][data-on]')).toBeVisible();
      await shoot(page, "license", { fullPage: true });

      // White-label is now in force: no upgrade note.
      await page.goto(`/projects/${projectId}?tab=widget`);
      await expect(page.getByRole("switch", { name: /Hide “Powered by Pinwren”/ })).toBeVisible();
      await expect(page.getByTestId("upgrade-note")).toHaveCount(0);

      await page.goto("/settings/license");
      await page.getByRole("button", { name: "Remove licence" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
      await expect(page.getByTestId("license-status")).toContainText("Community");
    } finally {
      await request.delete("/api/admin/license");
    }
  });

  test("widget files: short cache for widget.js, immutable hashed chunks, CORS", async ({ request }) => {
    const main = await request.get("/widget.js");
    expect(main.status()).toBe(200);
    expect(main.headers()["cache-control"]).toBe("public, max-age=300");
    expect(main.headers()["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(main.headers()["access-control-allow-origin"]).toBe("*");
    const chunk = /widget-[\w-]+\.[0-9a-f]{10}\.js/.exec(await main.text())?.[0];
    if (!chunk) throw new Error("no hashed chunk referenced by widget.js");
    const res = await request.get(`/${chunk}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(res.headers()["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(res.headers()["access-control-allow-origin"]).toBe("*");
    expect(res.headers()["x-frame-options"]).toBeUndefined();
  });

  test("a 10 MB session replay reaches the API through the proxy", async ({ request }) => {
    const { projectId } = seed();
    await request.patch(`/api/projects/${projectId}`, {
      data: { captureConfig: { replay: { enabled: true } } },
    });
    // ~9.9 MB of incompressible event payload, stored (level 0) so the gzip stays that size: ≈ 13 MB as base64.
    const noise = Array.from({ length: 1200 }, (_, i) => ({
      type: 5,
      timestamp: Date.now() + i,
      data: { tag: "e2e", payload: randomUUID().repeat(230) },
    }));
    const gz = gzipSync(Buffer.from(JSON.stringify(noise)), { level: 0 });
    expect(gz.length).toBeGreaterThan(9.5 * 1024 * 1024);
    expect(gz.length).toBeLessThan(10 * 1024 * 1024);
    const f = await widgetPost(request, {
      title: "Ten megabytes of replay",
      replay: {
        dataUrl: `data:application/gzip;base64,${gz.toString("base64")}`,
        durationMs: 60_000,
        events: noise.length,
      },
    });
    const detail = (await (await request.get(`/api/feedback/${f.id}`)).json()) as {
      assets: { kind: string; bytes: number }[];
    };
    const asset = detail.assets.find((a) => a.kind === "replay");
    expect(asset?.bytes).toBe(gz.length);
    await request.delete(`/api/feedback/${f.id}`);
  });
});

test("wave 4 screens at 375 px", async ({ page }) => {
  const { projectId, items } = seed();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/projects/${projectId}/rounds`);
  await expect(page.getByTestId("new-round")).toBeVisible();
  await shoot(page, "mobile-rounds");
  await page.goto(`/inbox?project=${projectId}&status=all&priority=high`);
  await expect(page.getByRole("list", { name: "Active filters" })).toBeVisible();
  await shoot(page, "mobile-inbox-filters");
  await page.goto(`/inbox?project=${projectId}&status=all&item=${items.bug.id}`);
  await expect(page.getByTestId("feedback-detail")).toBeVisible();
  await shoot(page, "mobile-detail-wave4");
  await page.goto("/settings/license");
  await expect(page.getByTestId("license-status")).toBeVisible();
  await shoot(page, "mobile-license");
  await page.goto(`/projects/${projectId}?tab=capture`);
  await expect(page.getByText("Session replay")).toBeVisible();
  await shoot(page, "mobile-capture", { fullPage: true });
});
