import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { seed, shoot } from "./env";
import { expect, test } from "./fixtures";

// AI triage: the workspace form, the project switches and "Translate report" on an inbox item, against a
// fake OpenAI-compatible provider on 127.0.0.1 (allowed by the suite's outbound allowlist). The provider
// answers every chat completion with the JSON each task asks for, so no real model is involved.

type Seen = { url: string; authorization: string | undefined };

let server: Server;
let base = "";
const seen: Seen[] = [];

test.beforeAll(async () => {
  server = createServer((req: IncomingMessage, res) => {
    let body = "";
    req.on("data", (c: Buffer) => {
      body += c.toString();
    });
    req.on("end", () => {
      seen.push({ url: req.url ?? "/", authorization: req.headers.authorization });
      // The connection test wants {"ok":true}; a translation wants {"translation":"..."}; anything else {}.
      const reply = body.includes("healthcheck")
        ? '{"ok":true}'
        : '{"translation":"Seite lädt nicht","translatedText":"Seite lädt nicht","text":"Seite lädt nicht"}';
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  server.unref();
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async ({ request }) => {
  await new Promise<void>((r) => {
    server.closeAllConnections();
    server.close(() => r());
  });
  // The workspace is shared with the other specs: leave AI switched off and the project untouched.
  await request.put("/api/settings/ai", {
    data: { provider: "anthropic", model: "claude-haiku-5-5", enabled: false },
  });
  const { projectId } = seed();
  await request.patch(`/api/projects/${projectId}/ai`, { data: { enabled: false, autoSummary: true } });
});

test.describe("AI triage & enrichment", () => {
  test("workspace AI settings: pick a provider, test the connection, save", async ({ page }) => {
    await page.goto("/settings/ai");
    await expect(page.getByRole("heading", { name: "AI Configuration" })).toBeVisible();

    await expect(page.getByRole("radio", { name: /Anthropic/ })).toBeChecked();
    await expect(page.getByRole("radio", { name: /OpenAI-compatible/ })).toBeVisible();
    await expect(page.getByRole("radio", { name: /Ollama/ })).toBeVisible();

    await page.getByRole("radio", { name: /OpenAI-compatible/ }).check();
    await expect(page.locator("#ai-base-url")).toBeVisible();
    await page.getByRole("button", { name: "gpt-4o-mini" }).click();
    await expect(page.locator("#ai-model")).toHaveValue("gpt-4o-mini");

    await page.locator("#ai-api-key").fill("sk-e2e-test-key-12345");
    await page.locator("#ai-base-url").fill(base);

    // A private address typed here is refused until it is allowed; 127.0.0.1 is, in this suite.
    await page.getByRole("button", { name: "Test connection" }).click();
    await expect(page.getByText(/Connection successful/)).toBeVisible();
    expect(seen.at(-1)).toMatchObject({
      url: "/v1/chat/completions",
      authorization: "Bearer sk-e2e-test-key-12345",
    });

    await page.getByRole("switch", { name: "Enable AI features" }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("AI settings updated successfully")).toBeVisible();

    // The key is stored encrypted and never comes back.
    await page.reload();
    await expect(page.getByText("••••••••••••••••")).toBeVisible();
    await expect(page.getByRole("button", { name: "Change key" })).toBeVisible();

    await shoot(page, "settings-ai", { fullPage: true });
  });

  test("project AI tab: toggles the triage options", async ({ page }) => {
    const { projectId } = seed();
    await page.goto(`/projects/${projectId}?tab=ai`);

    await expect(page.getByText("AI Triage & Enrichment", { exact: true })).toBeVisible();
    await expect(page.getByText("Executive summaries", { exact: true })).toBeVisible();
    await expect(page.getByText("Priority & kind suggestions", { exact: true })).toBeVisible();
    await expect(page.getByText("Duplicate detection", { exact: true })).toBeVisible();
    await expect(page.getByText("Reproduction steps", { exact: true })).toBeVisible();

    await page.getByText("Enable AI triage", { exact: true }).click();
    await expect(page.getByText("AI triage updated")).toBeVisible();

    const summary = page.locator("#project-ai-summary");
    await expect(summary).toBeEnabled();
    await page.getByText("Executive summaries", { exact: true }).click();
    await expect(page.getByText("Executive summary updated")).toBeVisible();

    await shoot(page, "project-ai", { fullPage: true });
  });

  test("inbox item: Translate report goes through the configured provider", async ({ page }) => {
    const { projectId, items } = seed();
    await page.goto(`/inbox?project=${projectId}&status=all&item=${items.pin.id}`);

    const detail = page.getByTestId("feedback-detail");
    await expect(detail).toBeVisible();

    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByTestId("translate-report").click();

    await expect(page.getByText("Showing translated report")).toBeVisible();
    await expect(detail.getByText("Seite lädt nicht").first()).toBeVisible();

    await shoot(page, "inbox-ai-detail", { fullPage: true });
  });
});
