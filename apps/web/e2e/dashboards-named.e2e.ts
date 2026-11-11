import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { seed, shoot } from "./env";
import { expect, test } from "./fixtures";

// ADR 0037: named dashboards (create, switch, rename, duplicate, default, delete), layouts kept on the
// account, the one-time import of the old browser layout, sharing with the workspace (read-only for others,
// "Duplicate to my dashboards"), the dashboard-wide filter bar in the URL, pinned projects, the start page
// and the session-expired redirect.

type Row = { id: string; name: string; mine: boolean; shared: boolean };

const list = async (request: APIRequestContext) =>
  ((await (await request.get("/api/dashboards?scope=home")).json()) as { dashboards: Row[] }).dashboards;

/** Start and end every case without dashboards of the signed-in admin, so the built-in layout shows. */
async function clean(request: APIRequestContext) {
  for (const d of await list(request)) if (d.mine) await request.delete(`/api/dashboards/${d.id}`);
  await request.patch("/api/me/workspace-preferences", {
    data: { dashboardDefaults: { home: null }, pinnedProjectIds: [] },
  });
  await request.patch("/api/me/ui-state", { data: { startPage: "inbox" } });
}

async function addViewer(request: APIRequestContext) {
  const tag = Date.now().toString(36);
  const user = { name: `Vi ${tag}`, email: `viewer-${tag}@example.com`, password: `viewer-password-${tag}` };
  const res = await request.post("/api/members", { data: { ...user, role: "viewer" } });
  expect(res.status()).toBe(201);
  const { member } = (await res.json()) as { member: { userId: string } };
  return { ...user, id: member.userId };
}

async function signedInAs(browser: Browser, email: string, password: string): Promise<Page> {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/inbox");
  return page;
}

test.describe("named and shared dashboards", () => {
  test.beforeEach(async ({ request }) => clean(request));
  test.afterEach(async ({ request }) => clean(request));

  test("create, switch, rename, duplicate, set a default and delete; the layouts live on the account", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000); // many steps, and the dev server compiles each screen on first visit
    await page.goto("/dashboard");
    const board = page.getByTestId("dashboard-home");
    const switcher = board.getByTestId("dashboard-switcher");
    const widgets = board.locator("[data-widget]");
    await expect(switcher).toContainText("Default");
    const builtin = await widgets.count();

    // The first edit saves the layout to the account as "My dashboard".
    await board.getByTestId("dashboard-customise").click();
    await board
      .getByRole("button", { name: /^Remove / })
      .first()
      .click();
    await expect(switcher).toContainText("My dashboard");
    await page.getByRole("button", { name: "Done" }).click();
    await expect(widgets).toHaveCount(builtin - 1);
    await expect.poll(async () => (await list(request)).map((d) => d.name)).toEqual(["My dashboard"]);

    // Not in this browser: wipe localStorage and the layout still comes back from the server.
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
    await expect(widgets).toHaveCount(builtin - 1);

    // A new dashboard starts from the layout in view and gets its own link.
    await switcher.click();
    await page.getByRole("menuitem", { name: "New dashboard…" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Triage");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(switcher).toContainText("Triage");
    await expect(page).toHaveURL(/dash=/);
    await expect(widgets).toHaveCount(builtin - 1);
    await board.getByTestId("dashboard-customise").click();
    await board
      .getByRole("button", { name: /^Remove / })
      .first()
      .click();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(widgets).toHaveCount(builtin - 2);

    // Switching shows the other layout; the first one was not touched.
    await switcher.click();
    await page.getByRole("menuitemradio", { name: "My dashboard" }).click();
    await expect(switcher).toContainText("My dashboard");
    await expect(widgets).toHaveCount(builtin - 1);
    await switcher.click();
    await page.getByRole("menuitemradio", { name: "Triage" }).click();
    await expect(widgets).toHaveCount(builtin - 2);
    await shoot(page, "dashboard-named", { fullPage: true });

    // Rename, duplicate.
    await switcher.click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await dialog.getByLabel("Name").fill("Exec weekly");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(switcher).toContainText("Exec weekly");
    await switcher.click();
    await page.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
    await expect(switcher).toContainText("Exec weekly copy");
    await expect.poll(async () => (await list(request)).length).toBe(3);

    // A duplicate name is refused with a message in the dialog.
    await switcher.click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await dialog.getByLabel("Name").fill("my dashboard");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByText(/already have a dashboard with that name/)).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();

    // Delete the copy; make "Exec weekly" the one that opens by default.
    await switcher.click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect.poll(async () => (await list(request)).length).toBe(2);
    await switcher.click();
    await page.getByRole("menuitemradio", { name: "Exec weekly" }).click();
    await switcher.click();
    await page.getByRole("menuitem", { name: "Open by default" }).click();
    await page.goto("/dashboard");
    await expect(switcher).toContainText("Exec weekly");
    await expect(widgets).toHaveCount(builtin - 2);
  });

  test("imports the layout the browser kept before dashboards moved to the account, once", async ({
    page,
    request,
  }) => {
    const me = (await (await request.get("/api/me")).json()) as { user: { id: string } };
    const key = `pinwren.dashboard.v1.${me.user.id}.home`;
    await page.goto("/inbox");
    await page.evaluate(
      ([k]) =>
        window.localStorage.setItem(
          k ?? "",
          JSON.stringify({ v: 1, days: 30, slots: [{ id: "kpi.urgent", w: 3, h: 1 }] }),
        ),
      [key],
    );
    await page.goto("/dashboard");
    const board = page.getByTestId("dashboard-home");
    await expect(board.locator("[data-widget]")).toHaveCount(1);
    await expect(board.locator('[data-widget="kpi.urgent"]')).toBeVisible();
    await expect(board.getByTestId("dashboard-switcher")).toContainText("My dashboard");
    await expect.poll(async () => (await list(request)).map((d) => d.name)).toEqual(["My dashboard"]);
    await expect.poll(() => page.evaluate((k) => window.localStorage.getItem(k), key)).toBeNull();
    await page.reload();
    expect((await list(request)).length).toBe(1);
  });

  test("an Admin shares a dashboard; a viewer opens it read-only and duplicates it to their own", async ({
    page,
    request,
    browser,
  }) => {
    test.setTimeout(180_000);
    const made = await request.post("/api/dashboards", {
      data: {
        scope: "home",
        name: "Team weekly",
        layout: { v: 1, days: 7, slots: [{ id: "kpi.created", w: 4, h: 1 }] },
      },
    });
    expect(made.status()).toBe(201);
    await page.goto("/dashboard");
    const switcher = page.getByTestId("dashboard-home").getByTestId("dashboard-switcher");
    await expect(switcher).toContainText("Team weekly");
    await switcher.click();
    await page.getByRole("menuitem", { name: "Share with workspace…" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("switch", { name: "Share with the whole workspace" }).click();
    await dialog.getByRole("checkbox", { name: "Viewers" }).click();
    await shoot(page, "dashboard-share-dialog");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect
      .poll(async () => (await list(request)).find((d) => d.name === "Team weekly")?.shared)
      .toBe(true);

    const viewer = await addViewer(request);
    const vp = await signedInAs(browser, viewer.email, viewer.password);
    try {
      await vp.goto("/dashboard");
      const board = vp.getByTestId("dashboard-home");
      // Viewers have no dashboard of their own, so the one published for their role opens.
      await expect(board.getByTestId("dashboard-switcher")).toContainText("Team weekly");
      await expect(board.locator('[data-widget="kpi.created"]')).toBeVisible();
      await expect(board.getByTestId("dashboard-readonly")).toContainText("Avery Admin");
      await shoot(vp, "dashboard-shared-readonly");
      const sharedId = (await list(request)).find((d) => d.name === "Team weekly")?.id ?? "";
      const denied = await vp.request.patch(`/api/dashboards/${sharedId}`, {
        data: { name: "Hijacked" },
        headers: { origin: new URL(vp.url()).origin },
      });
      expect(denied.status()).toBe(403);

      await board.getByRole("button", { name: "Duplicate to my dashboards" }).click();
      await expect(board.getByTestId("dashboard-switcher")).toContainText("Team weekly copy");
      await expect(vp.getByRole("button", { name: "Done" })).toBeVisible();
      await board
        .getByRole("button", { name: /^Remove / })
        .first()
        .click();
      await vp.getByRole("button", { name: "Done" }).click();
      await expect(board.locator("[data-widget]")).toHaveCount(0);
      // The shared one is untouched for everyone else.
      const shared = (await list(request)).find((d) => d.name === "Team weekly");
      expect(shared?.shared).toBe(true);
    } finally {
      await vp.context().close();
      await request.delete(`/api/members/${viewer.id}`);
    }
  });

  test("the filter bar narrows every widget, lives in the URL and clears", async ({ page }) => {
    const { projectId } = seed();
    const requests: string[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === "/api/stats") requests.push(r.url());
    });
    await page.goto(`/dashboard?project=${projectId}&assignee=none&from=2026-01-01&to=2026-01-31`);
    const board = page.getByTestId("dashboard-home");
    const filters = board.getByTestId("dashboard-filters");
    await expect(filters).toBeVisible();
    await expect(filters.getByRole("button", { name: "Date range" })).toContainText("2026");
    await expect.poll(() => requests.at(-1) ?? "").toContain(`projectId=${projectId}`);
    const last = new URL(requests.at(-1) ?? "http://x");
    expect(last.searchParams.get("assigneeId")).toBe("none");
    expect(last.searchParams.get("from")).toBe("2026-01-01");
    expect(last.searchParams.get("to")).toBe("2026-01-31");
    await shoot(page, "dashboard-filters");

    // Changing a filter updates the link; clearing removes them all.
    await filters.getByRole("combobox", { name: "Assignee" }).click();
    await page.getByRole("option", { name: "Me", exact: true }).click();
    await expect(page).toHaveURL(/assignee=me/);
    await filters.getByTestId("dashboard-filters-clear").click();
    await expect(page).not.toHaveURL(/project=|assignee=|from=/);
    await expect(filters.getByTestId("dashboard-filters-clear")).toHaveCount(0);

    // Picking a project in the bar narrows to it.
    await filters.getByRole("combobox", { name: "Project" }).click();
    await page.getByRole("option").nth(1).click();
    await expect(page).toHaveURL(/project=/);
    await filters.getByRole("combobox", { name: "Label" }).click();
    await expect(page.getByRole("option", { name: "All labels" })).toBeVisible();
  });

  test("the API refuses a malformed filter and returns zero for a foreign label", async ({ request }) => {
    expect((await request.get("/api/stats?labelId=nope")).status()).toBe(400);
    expect((await request.get("/api/stats?from=2026-02-01&to=2026-01-01")).status()).toBe(400);
    const none = await request.get("/api/stats?days=30&labelId=00000000-0000-4000-8000-000000000000");
    expect(none.ok()).toBe(true);
    expect(((await none.json()) as { totals: { active: number } }).totals.active).toBe(0);
  });

  test("projects can be pinned in the sidebar and stay pinned", async ({ page }) => {
    const { projectId } = seed();
    await page.goto("/inbox");
    const row = page.locator(`[data-sidebar="menu-item"]`, {
      has: page.locator(`a[href="/inbox?project=${projectId}"]`),
    });
    await row.hover();
    await row.getByRole("button", { name: /^Pin / }).click();
    await expect(row).toHaveAttribute("data-pinned", "true");
    await page.reload();
    await expect(
      page.locator(`[data-sidebar="menu-item"][data-pinned="true"]`, {
        has: page.locator(`a[href="/inbox?project=${projectId}"]`),
      }),
    ).toBeVisible();
  });

  test("the start page follows the account, with no cookie on this device", async ({ page, request }) => {
    expect((await request.patch("/api/me/ui-state", { data: { startPage: "dashboard" } })).ok()).toBe(true);
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId("dashboard-home")).toBeVisible();
  });

  test("an expired session says so and comes back to the same page after sign-in", async ({ page }) => {
    let served = 0;
    await page.route("**/api/stats?*", async (route) => {
      served += 1;
      if (served > 1) return route.continue();
      return route.fulfill({
        status: 401,
        contentType: "application/problem+json",
        body: JSON.stringify({ title: "Sign in required", status: 401, code: "UNAUTHORIZED" }),
      });
    });
    const visited: string[] = [];
    page.on("framenavigated", (f) => {
      if (f === page.mainFrame()) visited.push(f.url());
    });
    await page.goto("/dashboard?assignee=me");
    await expect(page.getByText("Your session expired. Sign in again to continue.")).toBeVisible();
    await expect
      .poll(() => visited.some((u) => u.includes("/sign-in?next=%2Fdashboard%3Fassignee%3Dme")))
      .toBe(true);
    // The admin's cookie is still good here, so sign-in sends them straight back to where they were.
    await page.waitForURL(/\/dashboard\?assignee=me/);
  });
});
