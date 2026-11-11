import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { seed, shoot, SITE_ORIGIN } from "./env";
import { expect, test } from "./fixtures";

// Releases, "fixed in" and regression detection (ADR 0029): record a release in project settings, resolve an
// item as fixed in it, file a report that looks like it coming back and see it flagged (banner, inbox filter,
// dashboard widget), then reopen the original from the banner. Everything the test creates is removed again.

const stamp = Date.now().toString(36);
const VERSION = `v9.${stamp.length}.0`;
const NEXT_VERSION = `v9.${stamp.length}.1`;
const ERROR = `RangeError: Invalid array length while pricing the ${stamp} plan`;

const created: string[] = [];

async function report(request: APIRequestContext, release?: string) {
  const { publicKey } = seed();
  const res = await request.post("/w/feedback", {
    headers: { "x-pinwren-key": publicKey, origin: SITE_ORIGIN },
    data: {
      clientId: randomUUID(),
      kind: "bug",
      title: `Pricing page crashes (${stamp})`,
      body: "The plans never render.",
      page: { url: `${SITE_ORIGIN}/regress-${stamp}`, title: "Regress" },
      environment: {
        userAgent: "Mozilla/5.0 (e2e) Chrome/140",
        browser: "Chrome 140",
        os: "Windows 11",
        viewport: { w: 1280, h: 800 },
        dpr: 1,
      },
      diagnostics: { console: [{ level: "error", message: ERROR, at: 1 }], network: [] },
      ...(release ? { metadata: { release } } : {}),
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const { feedback } = (await res.json()) as { feedback: { id: string; number: number } };
  created.push(feedback.id);
  return feedback;
}

test.describe("releases and regressions", () => {
  test.afterEach(async ({ request }) => {
    const { projectId } = seed();
    for (const id of created.splice(0)) {
      await request.delete(`/api/feedback/${id}`);
      await request.delete(`/api/feedback/${id}/forever`);
    }
    const list = (await (await request.get(`/api/projects/${projectId}/releases`)).json()) as {
      releases: { id: string; version: string }[];
    };
    for (const r of list.releases.filter((x) => x.version.startsWith("v9."))) {
      await request.delete(`/api/releases/${r.id}`);
    }
  });

  test("project settings: record, list and delete a release", async ({ page }) => {
    const { projectId } = seed();
    await page.goto(`/projects/${projectId}?tab=releases`);
    await expect(page.getByText("Record the versions you ship")).toBeVisible();
    await expect(page.getByText("No releases yet")).toBeVisible();
    await expect(page.getByRole("switch", { name: "Flag possible regressions" })).toBeChecked();
    await expect(page.getByRole("switch", { name: "Reopen the resolved item" })).not.toBeChecked();

    await page.getByLabel("Version").fill("not valid");
    await page.getByRole("button", { name: "Record release" }).click();
    await expect(page.getByText(/no spaces/)).toBeVisible();

    await page.getByLabel("Version").fill(VERSION);
    await page.getByLabel("Commit").fill("9f2c1ab");
    await page.getByRole("button", { name: "Record release" }).click();
    await expect(page.getByText(`Recorded ${VERSION}`)).toBeVisible();
    const row = page.locator(`[data-release="${VERSION}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText("9f2c1ab");
    await expect(page.getByText("Record releases from CI")).toBeVisible();
    await expect(page.getByText(`/api/v1/projects/${projectId}/releases`)).toBeVisible();
    await shoot(page, "releases-tab");

    // Recording the same version again updates it instead of adding a row.
    await page.getByLabel("Version").fill(VERSION);
    await page.getByRole("button", { name: "Record release" }).click();
    await expect(page.getByText(`Updated ${VERSION}`)).toBeVisible();
    await expect(page.locator("[data-release]")).toHaveCount(1);

    await row.getByRole("button", { name: `Delete ${VERSION}` }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /Delete/ })
      .click();
    await expect(page.getByText(`Deleted ${VERSION}`)).toBeVisible();
    await expect(page.getByText("No releases yet")).toBeVisible();
  });

  test("resolve as fixed in a release, then see a regression flagged and reopen the original", async ({
    page,
    request,
  }) => {
    const { projectId } = seed();
    const release = (await (
      await request.post(`/api/projects/${projectId}/releases`, { data: { version: VERSION } })
    ).json()) as { release: { id: string } };
    expect(release.release.id).toBeTruthy();
    const original = await report(request);

    // Resolve it as fixed in the release.
    await page.goto(`/inbox?project=${projectId}&status=all&item=${original.id}`);
    const detail = page.getByTestId("feedback-detail");
    await expect(detail.getByRole("heading", { name: `Pricing page crashes (${stamp})` })).toBeVisible();
    await expect(page.getByTestId("fixed-in-picker")).toHaveCount(0);
    await page.getByTestId("status-picker").click();
    await page.getByRole("option", { name: "Resolved" }).click();
    await expect(page.getByTestId("status-picker")).toContainText("Resolved");
    await page.getByTestId("fixed-in-picker").click();
    await expect(page.getByRole("option", { name: "Next release" })).toBeVisible();
    await page.getByRole("option", { name: VERSION }).click();
    await expect(page.getByTestId("fixed-in-picker")).toContainText(VERSION);
    const timeline = detail.getByRole("region", { name: "Activity" });
    await expect(timeline.getByText(`marked it fixed in ${VERSION}`)).toBeVisible();
    await shoot(page, "fixed-in-picker");

    // The list row names the release; so does the release table.
    await page.goto(`/inbox?project=${projectId}&status=all`);
    await expect(page.locator(`[data-row-id="${original.id}"]`).getByTestId("fixed-in-tag")).toContainText(
      `Fixed in ${VERSION}`,
    );

    // A new report with the same console error, from a later release, is flagged.
    const again = await report(request, "v9.99.9");
    await expect
      .poll(
        async () => {
          const d = (await (await request.get(`/api/feedback/${again.id}`)).json()) as {
            feedback: { regressionOf: { number: number } | null };
          };
          return d.feedback.regressionOf?.number ?? null;
        },
        { timeout: 60_000, intervals: [1000, 2000, 3000] },
      )
      .toBe(original.number);

    await page.goto(`/inbox?project=${projectId}&status=all&item=${again.id}`);
    const banner = page.getByTestId("regression-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(`#${original.number}`);
    await expect(banner).toContainText("It shares a console error with it");
    await expect(page.getByTestId("regression-badge")).toContainText(`regression of #${original.number}`);
    await expect(page.getByTestId("reported-release")).toContainText("Reported in v9.99.9");
    await expect(
      detail
        .getByRole("region", { name: "Activity" })
        .getByText(`Possible regression of #${original.number}`),
    ).toBeVisible();
    await shoot(page, "regression-banner");

    // The inbox filter keeps only flagged reports.
    await page.goto(`/inbox?project=${projectId}&status=all&regression=true`);
    await expect(page.locator(`[data-row-id="${again.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-row-id="${original.id}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-row-id="${again.id}"]`).getByTestId("regression-tag")).toBeVisible();

    // The dashboard widget lists it.
    await page.goto("/dashboard");
    await page.getByTestId("dashboard-customise").click();
    await page.getByRole("button", { name: "Add widget" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^Regressions/ })
      .click();
    await page.keyboard.press("Escape");
    const list = page.getByTestId("regression-list");
    await expect(list).toContainText(`#${again.number}`);
    await expect(list).toContainText(`of #${original.number}`);
    await page.getByRole("button", { name: "Reset to default" }).click();
    await page.getByRole("button", { name: "Done" }).click();

    // Reopen the original from the banner.
    await page.goto(`/inbox?project=${projectId}&status=all&item=${again.id}`);
    await page.getByRole("button", { name: `Reopen #${original.number}` }).click();
    await expect(page.getByText(`Reopened #${original.number}`)).toBeVisible();
    await expect
      .poll(async () => {
        const d = (await (await request.get(`/api/feedback/${original.id}`)).json()) as {
          feedback: { status: string; fixedInReleaseId: string | null };
          regressions: { id: string }[];
        };
        return [d.feedback.status, d.feedback.fixedInReleaseId, d.regressions.map((r) => r.id)];
      })
      .toEqual(["open", null, [again.id]]);

    // On the original, the newer report is listed.
    await page.goto(`/inbox?project=${projectId}&status=all&item=${original.id}`);
    await expect(page.getByTestId("regressions-of-this")).toContainText(`#${again.number}`);
  });

  test('"next release" turns into the release recorded next', async ({ page, request }) => {
    const { projectId } = seed();
    await request.post(`/api/projects/${projectId}/releases`, { data: { version: VERSION } });
    const item = await report(request);
    await page.goto(`/inbox?project=${projectId}&status=all&item=${item.id}`);
    await page.getByTestId("status-picker").click();
    await page.getByRole("option", { name: "Resolved" }).click();
    await page.getByTestId("fixed-in-picker").click();
    await page.getByRole("option", { name: "Next release" }).click();
    await expect(page.getByTestId("fixed-in-picker")).toContainText("Next release");

    await page.goto(`/projects/${projectId}?tab=releases`);
    await page.getByLabel("Version").fill(NEXT_VERSION);
    await page.getByRole("button", { name: "Record release" }).click();
    await expect(page.getByText(`Recorded ${NEXT_VERSION}`)).toBeVisible();
    await expect(page.getByText(/1 item promised for the next release is now fixed in/)).toBeVisible();

    await page.goto(`/inbox?project=${projectId}&status=all&item=${item.id}`);
    await expect(page.getByTestId("fixed-in-picker")).toContainText(NEXT_VERSION);
    await expect(
      page
        .getByTestId("feedback-detail")
        .getByRole("region", { name: "Activity" })
        .getByText(`The next release shipped as ${NEXT_VERSION}`),
    ).toBeVisible();
  });
});
