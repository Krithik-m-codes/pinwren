import { expect, type Page, test } from "@playwright/test";
import { mockApi } from "./mock";

// Error-triggered prompt (opt-in `errorPrompt`) and observability link-outs (`metadata.observability`).

const toast = (page: Page) => page.locator("pinwren-root .errprompt");
const report = (page: Page) => page.getByRole("dialog", { name: "Report a bug" });

async function ready(page: Page) {
  await page.goto("/");
  await expect(page.locator("pinwren-root .launcher")).toBeVisible();
  // The lazy chunk registers its listeners shortly after the config arrives.
  await page.waitForFunction(() => !!(window as unknown as { __pinwrenErrors?: unknown }).__pinwrenErrors);
}

/** Throw outside any handler of ours, the way a host page's own code would. */
const throwOnPage = (page: Page, message: string) =>
  page.evaluate((m) => {
    setTimeout(() => {
      throw new Error(m);
    }, 0);
  }, message);

async function openBugForm(page: Page) {
  await page.locator("pinwren-root .launcher").click();
  await page.getByRole("menuitem", { name: /Report a bug/ }).click();
  await expect(report(page)).toBeVisible();
}

test("an uncaught error offers a report that opens pre-filled, with the stack as diagnostics", async ({
  page,
}) => {
  const mock = await mockApi(page, { widget: { errorPrompt: true }, capture: { console: "off" } });
  await ready(page);
  await throwOnPage(page, "Cart total is NaN");
  await expect(toast(page)).toContainText("Something went wrong");
  await toast(page).getByRole("button", { name: "Send report" }).click();
  await expect(report(page)).toBeVisible();
  await expect(report(page).getByLabel("Title")).toHaveValue("Error: Cart total is NaN");
  await report(page).getByLabel("Describe the bug").fill("Total showed NaN after adding two items.");
  await report(page).getByRole("button", { name: "Send report" }).click();
  await expect.poll(() => mock.items.length).toBe(1);
  const p = mock.items[0]?.payload as {
    diagnostics: { console: { message: string }[] };
    metadata: { error: { message: string } };
  };
  // console capture is off, yet the chosen error is in the report
  expect(p.diagnostics.console.some((c) => c.message.includes("Cart total is NaN"))).toBe(true);
  expect(p.metadata.error.message).toBe("Error: Cart total is NaN");
});

test("the prompt is dismissible and never repeats the same error", async ({ page }) => {
  await mockApi(page, { widget: { errorPrompt: true } });
  await ready(page);
  await throwOnPage(page, "Same failure");
  await expect(toast(page)).toBeVisible();
  await toast(page).getByRole("button", { name: "Dismiss" }).click();
  await expect(toast(page)).toHaveCount(0);
  await throwOnPage(page, "Same failure");
  await page.waitForTimeout(300);
  await expect(toast(page)).toHaveCount(0);
});

test("off by default: nothing is shown and the chunk is never requested", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (r) => requested.push(new URL(r.url()).pathname));
  await mockApi(page);
  await page.goto("/");
  await expect(page.locator("pinwren-root .launcher")).toBeVisible();
  await throwOnPage(page, "Quiet failure");
  await page.waitForTimeout(500);
  await expect(toast(page)).toHaveCount(0);
  expect(requested.some((p) => p.startsWith("/widget-errors"))).toBe(false);
});

test("never in privacy mode", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (r) => requested.push(new URL(r.url()).pathname));
  await mockApi(page, { widget: { errorPrompt: true, privacyMode: true } });
  await page.goto("/");
  await expect(page.locator("pinwren-root .launcher")).toBeVisible();
  await throwOnPage(page, "Private failure");
  await page.waitForTimeout(500);
  await expect(toast(page)).toHaveCount(0);
  expect(requested.some((p) => p.startsWith("/widget-errors"))).toBe(false);
});

test("not on pages where the widget is hidden", async ({ page }) => {
  await mockApi(page, { widget: { errorPrompt: true, visibility: { mode: "manual" } } });
  await page.goto("/");
  await expect(page.locator("pinwren-root")).toBeAttached();
  await page.waitForFunction(() => !!(window as unknown as { __pinwrenErrors?: unknown }).__pinwrenErrors);
  await throwOnPage(page, "Hidden failure");
  await page.waitForTimeout(500);
  await expect(toast(page)).toHaveCount(0);
});

test("a bug report carries the ids of Sentry, PostHog, LogRocket and Datadog found on the page", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.Sentry = {
      getCurrentScope: () => ({ lastEventId: () => "evt0123456789" }),
      getReplay: () => ({ getReplayId: () => "rep-42" }),
      getClient: () => ({ getOptions: () => ({ dsn: "https://k@o1.ingest.sentry.io/2" }) }),
    };
    w.posthog = {
      get_session_id: () => "ph-session",
      get_session_replay_url: () => "https://us.posthog.com/replay/ph-session",
    };
    w.LogRocket = { sessionURL: "https://app.logrocket.com/acme/web/s/1" };
    w.DD_RUM = {
      getInternalContext: () => ({ session_id: "dd-session", application_id: "dd-app" }),
      getInitConfiguration: () => ({ site: "datadoghq.com" }),
    };
  });
  const mock = await mockApi(page);
  await page.goto("/");
  await expect(page.locator("pinwren-root .launcher")).toBeVisible();
  await openBugForm(page);
  await report(page).getByLabel("Describe the bug").fill("Something broke.");
  await report(page).getByRole("button", { name: "Send report" }).click();
  await expect.poll(() => mock.items.length).toBe(1);
  const meta = mock.items[0]?.payload?.metadata as { observability: Record<string, unknown> };
  expect(meta.observability).toEqual({
    sentry: { eventId: "evt0123456789", replayId: "rep-42", host: "sentry.io" },
    posthog: { sessionId: "ph-session", replayUrl: "https://us.posthog.com/replay/ph-session" },
    logrocket: { sessionUrl: "https://app.logrocket.com/acme/web/s/1" },
    datadog: { sessionId: "dd-session", applicationId: "dd-app", site: "datadoghq.com" },
  });
});

test("privacy mode attaches no third-party ids", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).LogRocket = {
      sessionURL: "https://app.logrocket.com/a/b/s/1",
    };
  });
  const mock = await mockApi(page, { widget: { privacyMode: true } });
  await page.goto("/");
  await expect(page.locator("pinwren-root .launcher")).toBeVisible();
  await openBugForm(page);
  await report(page).getByLabel("Describe the bug").fill("Something broke.");
  await report(page).getByRole("button", { name: /send/i }).click();
  await expect.poll(() => mock.items.length).toBe(1);
  expect(JSON.stringify(mock.items[0]?.payload?.metadata ?? {})).not.toContain("logrocket");
});
