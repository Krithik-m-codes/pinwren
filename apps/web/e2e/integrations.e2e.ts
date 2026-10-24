import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Page } from "@playwright/test";
import { seed, shoot } from "./env";
import { expect, test } from "./fixtures";

// Wave 5 integrations: Microsoft Teams, Telegram and ntfy channels, and Linear / Jira issue sync. The chat
// receivers are a local HTTP server on 127.0.0.1 (as in settings.e2e.ts); Telegram's and Linear's APIs are
// fixed public hosts, so their forms are exercised without sending. Everything created here is removed
// afterwards: settings.e2e.ts expects an empty webhook list.

type Seen = { method: string; url: string; headers: IncomingMessage["headers"]; body: string };

let server: Server;
let base = "";
const seen: Seen[] = [];

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => {
      body += c.toString();
    });
    req.on("end", () => {
      seen.push({ method: req.method ?? "GET", url: req.url ?? "/", headers: req.headers, body });
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"id":"ntfy-msg"}');
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async ({ request }) => {
  await new Promise<void>((r) => server.close(() => r()));
  const res = await request.get("/api/webhooks");
  const { webhooks } = (await res.json()) as { webhooks: { id: string }[] };
  for (const w of webhooks) await request.delete(`/api/webhooks/${w.id}`);
  const { projectId } = seed();
  const trackers = (await (await request.get(`/api/projects/${projectId}/integrations`)).json()) as {
    integrations: { id: string; provider: string }[];
  };
  for (const i of trackers.integrations.filter((x) => x.provider === "linear")) {
    await request.delete(`/api/integrations/${i.id}`);
  }
});

async function pickKind(page: Page, label: string) {
  const dialog = page.getByRole("dialog", { name: "Add a webhook" });
  await dialog.getByRole("combobox", { name: "Type" }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
  return dialog;
}

test.describe("integrations", () => {
  test("ntfy: topic URL + access token, test event arrives as JSON with the token", async ({ page }) => {
    await page.goto("/settings/integrations");
    await page.getByRole("button", { name: "Add webhook" }).first().click();
    const dialog = await pickKind(page, "ntfy");
    await expect(dialog.getByTestId("wh-kind-help")).toContainText("topic URL");
    await dialog.getByLabel("Topic URL").fill(`${base}/`);
    await dialog.getByRole("button", { name: "Add webhook" }).click();
    await expect(dialog.getByText("Use the topic URL, like https://ntfy.sh/my-topic")).toBeVisible();
    await dialog.getByLabel("Topic URL").fill(`${base}/pinwren-e2e`);
    await dialog.getByLabel("Access token (optional)").fill("tk_e2e_token");
    await dialog.getByLabel("Name (optional)").fill("Phone alerts");
    await dialog.getByRole("button", { name: "Add webhook" }).click();

    // No signing secret for chat kinds: the detail sheet opens straight away, with the URL masked.
    const sheet = page.getByRole("dialog").filter({ hasText: "Recent deliveries" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(/…-e2e$/)).toBeVisible();
    await sheet.getByRole("button", { name: "Send test event" }).click();
    await expect(page.getByText(/Test delivered · 200/)).toBeVisible();
    const hit = seen.at(-1);
    expect(hit?.url).toBe("/");
    expect(hit?.headers.authorization).toBe("Bearer tk_e2e_token");
    expect(JSON.parse(hit?.body ?? "{}")).toMatchObject({ topic: "pinwren-e2e", markdown: false });
    await expect(sheet.getByText("Set. Paste a new one to replace it.")).toBeVisible();
    await sheet.getByRole("button", { name: "Remove" }).click();
    await expect(sheet.getByText("None: the topic is public.")).toBeVisible();
    await shoot(page, "settings-webhook-ntfy");
    await page.keyboard.press("Escape");
  });

  test("Microsoft Teams: posts an Adaptive Card", async ({ page }) => {
    await page.goto("/settings/integrations");
    await page.getByRole("button", { name: "Add webhook" }).first().click();
    const dialog = await pickKind(page, "Microsoft Teams");
    await dialog.getByLabel("URL").fill(`${base}/workflows/e2e`);
    await dialog.getByRole("button", { name: "Add webhook" }).click();
    const sheet = page.getByRole("dialog").filter({ hasText: "Recent deliveries" });
    await sheet.getByRole("button", { name: "Send test event" }).click();
    await expect(page.getByText(/Test delivered · 200/)).toBeVisible();
    const card = JSON.parse(seen.at(-1)?.body ?? "{}") as { attachments?: { contentType: string }[] };
    expect(seen.at(-1)?.url).toBe("/workflows/e2e");
    expect(card.attachments?.[0]?.contentType).toBe("application/vnd.microsoft.card.adaptive");
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("list", { name: "Webhooks" }).getByText("Microsoft Teams").first(),
    ).toBeVisible();
  });

  test("Telegram: bot token and chat id are validated, stored and shown masked", async ({ page }) => {
    await page.goto("/settings/integrations");
    await page.getByRole("button", { name: "Add webhook" }).first().click();
    const dialog = await pickKind(page, "Telegram");
    await expect(dialog.getByLabel("URL")).toHaveCount(0);
    await dialog.getByLabel("Bot token").fill("not-a-token");
    await dialog.getByLabel("Chat id").fill("chat");
    await dialog.getByRole("button", { name: "Add webhook" }).click();
    await expect(dialog.getByText("A bot token looks like 123456789:AA…")).toBeVisible();
    await expect(dialog.getByText("A numeric chat id (e.g. -1001234567890) or @channelname")).toBeVisible();
    await dialog.getByLabel("Bot token").fill("123456789:AAbbccddeeffgghhiijjkkllmmnnooppqq");
    await dialog.getByLabel("Chat id").fill("-1001234567890");
    await dialog.getByRole("button", { name: "Add webhook" }).click();
    const sheet = page.getByRole("dialog").filter({ hasText: "Recent deliveries" });
    await expect(
      sheet.getByText("https://api.telegram.org/bot123456789:…ppqq → chat -1001234567890"),
    ).toBeVisible();
    await expect(sheet.getByText("AAbbcc")).toHaveCount(0);
    await sheet.getByLabel("Chat").fill("@pinwren_e2e");
    await sheet.getByRole("button", { name: "Move" }).click();
    await expect(sheet.getByText(/→ chat @pinwren_e2e/)).toBeVisible();
    await shoot(page, "settings-webhook-telegram");
    await page.keyboard.press("Escape");
  });

  test("Linear: connect a team, paste the signing secret; Jira asks for a licence", async ({ page }) => {
    const { projectId } = seed();
    await page.goto(`/projects/${projectId}?tab=trackers`);
    const card = page.getByTestId("tracker-linear");
    await card.getByRole("button", { name: "Connect Linear" }).click();
    await card.getByLabel("API key").fill("lin_api_e2e_key_123456");
    await card.getByLabel("Team key").fill("acme/site");
    await card.getByRole("button", { name: "Connect Linear" }).click();
    await expect(card.getByText("Use the team key, like ENG")).toBeVisible();
    await card.getByLabel("Team key").fill("eng");
    await card.getByRole("button", { name: "Connect Linear" }).click();
    await expect(page.getByText("Linear connected").first()).toBeVisible();
    await expect(card.getByText("ENG", { exact: true })).toBeVisible();
    await expect(card.getByText(/\/api\/integrations\/linear\/webhook$/)).toBeVisible();
    await card.getByLabel("Signing secret from Linear").fill("short");
    await card.getByRole("button", { name: "Save" }).click();
    await expect(card.getByText("Paste the whole signing secret")).toBeVisible();
    await card.getByLabel("Signing secret from Linear").fill("lin_wh_e2e_signing_secret_value");
    await card.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Signing secret saved").first()).toBeVisible();

    // Jira is Enterprise (blueprint 07): without a licence it can't be connected.
    const jira = page.getByTestId("tracker-jira");
    await expect(jira.getByTestId("jira-licence")).toBeVisible();
    await expect(jira.getByRole("button", { name: "Connect Jira" })).toBeDisabled();
    await shoot(page, "project-trackers-linear-jira", { fullPage: true });
  });
});
