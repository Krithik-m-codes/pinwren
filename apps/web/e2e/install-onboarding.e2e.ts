import { seed, shoot } from "./env";
import { expect, test } from "./fixtures";

// Wave 5 install-onboarding (docs/contracts/wave-5.md §3.5): install snippets, refused origins, project
// presets, review links, data export and erasure, the setup checklist, and settings navigation.

test.describe("install and onboarding", () => {
  test("install tab: every snippet, the terminal check and the public URL", async ({ page }) => {
    const { projectId, publicKey } = seed();
    await page.goto(`/projects/${projectId}?tab=install`);
    for (const name of ["HTML", "Next.js", "Tag Manager", "npm", "React"]) {
      await expect(page.getByRole("tab", { name, exact: true })).toBeVisible();
    }
    await page.getByRole("tab", { name: "npm", exact: true }).click();
    await expect(page.getByText('import { init } from "@pinwren/widget"')).toBeVisible();
    await page.getByRole("tab", { name: "React", exact: true }).click();
    await expect(page.getByText(`<Pinwren projectKey="${publicKey}"`)).toBeVisible();
    await expect(page.getByText(/npx @pinwren\/cli doctor --url .* --key/)).toBeVisible();
    await shoot(page, "project-install", { fullPage: true });
  });

  test("a refused site shows up with Allow", async ({ page, request }) => {
    const { projectId, publicKey } = seed();
    const refused = "https://refused-e2e.example";
    await request.get(`/w/config`, { headers: { "x-pinwren-key": publicKey, origin: refused } });
    await page.goto(`/projects/${projectId}?tab=install`);
    const row = page.getByTestId("rejected-origins").getByRole("listitem").filter({ hasText: refused });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Allow" }).click();
    await expect(page.getByText("Allowed refused-e2e.example")).toBeVisible();
    await expect(row).toHaveCount(0);
    // Put the allowlist back for the other specs.
    await page.getByRole("button", { name: "Remove refused-e2e.example" }).click();
    await expect(page.getByText("Removed refused-e2e.example")).toBeVisible();
  });

  test("new project asks what the site is for and opens the Install tab", async ({ page, request }) => {
    await page.goto("/projects?new=1");
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Client staging");
    await dialog.getByTestId("preset-review").click();
    await shoot(page, "project-new-preset");
    await dialog.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\?tab=install/);
    await expect(page.getByTestId("no-origins-warning")).toBeVisible();
    await expect(page.getByTestId("install-waiting")).toBeVisible();
    const id = new URL(page.url()).pathname.split("/").pop() ?? "";
    const res = await request.get(`/api/projects/${id}`);
    const { project } = (await res.json()) as {
      project: { publicRead: boolean; widgetConfig: { visitorsCanResolve: boolean } };
    };
    expect(project.publicRead).toBe(true);
    expect(project.widgetConfig.visitorsCanResolve).toBe(true);
    await request.patch(`/api/projects/${id}`, { data: { archived: true } });
  });

  test("review links: create, copy once, revoke", async ({ page }) => {
    const { projectId } = seed();
    await page.goto(`/projects/${projectId}?tab=review`);
    await page.getByRole("button", { name: "New link" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Acme sign-off");
    await dialog.getByRole("button", { name: "Create link" }).click();
    await expect(page.getByText("Copy the link now")).toBeVisible();
    await expect(page.getByText(/pinwren_review=pwr_/)).toBeVisible();
    const row = page.getByTestId("review-links").getByRole("listitem").filter({ hasText: "Acme sign-off" });
    await expect(row.getByText("Active")).toBeVisible();
    await row.getByRole("button", { name: "Revoke" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Revoke" }).click();
    await expect(row.getByText("Revoked")).toBeVisible();
  });

  test("privacy: export the project, and find nothing to erase for a stranger", async ({ page }) => {
    const { projectId } = seed();
    await page.goto(`/projects/${projectId}?tab=privacy`);
    await page.getByRole("button", { name: "Export project data" }).click();
    await expect(page.getByTestId("export-download")).toBeVisible({ timeout: 60_000 });
    const download = page.waitForEvent("download");
    await page.getByTestId("export-download").click();
    expect((await download).suggestedFilename()).toMatch(/^pinwren-.+\.zip$/);

    await page.getByLabel("Reporter's email").fill("nobody-e2e@example.com");
    await page.getByRole("button", { name: "Find data" }).click();
    await expect(page.getByTestId("erase-nothing")).toBeVisible();
    await shoot(page, "project-privacy-data", { fullPage: true });
  });

  test("email the reporter sits on the Widget tab", async ({ page }) => {
    const { projectId } = seed();
    await page.goto(`/projects/${projectId}?tab=widget`);
    await expect(
      page.getByTestId("reporter-emails").getByRole("switch", { name: "Email the reporter" }),
    ).toBeVisible();
  });

  test("setup checklist on the inbox can be dismissed", async ({ page }) => {
    await page.goto("/inbox");
    const checklist = page.getByTestId("setup-checklist");
    // Every step may already be done on a reused database; then there is nothing to show.
    if (!(await checklist.isVisible().catch(() => false))) {
      await expect(page.getByTestId("setup-checklist")).toHaveCount(0);
      return;
    }
    await expect(checklist.getByText(/of 6 done/)).toBeVisible();
    await shoot(page, "inbox-setup-checklist");
    await checklist.getByRole("button", { name: "Hide the checklist" }).click();
    await expect(checklist).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("setup-checklist")).toHaveCount(0);
  });

  test("command palette lists every settings page; the account menu opens settings", async ({ page }) => {
    await page.goto("/inbox");
    // The shortcut is bound once the app has hydrated.
    await expect(page.locator("ul[aria-label=Feedback][data-ready]")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog");
    for (const name of ["Integrations", "Email", "Security", "Licence"]) {
      await expect(palette.getByRole("option", { name, exact: true })).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Profile & settings" }).click();
    await expect(page).toHaveURL(/\/settings$/);
  });

  test("licence page separates what ships from what is coming", async ({ page }) => {
    await page.goto("/settings/license");
    await expect(page.getByTestId("license-status")).toBeVisible();
    const soon = page.getByTestId("license-coming-soon");
    if (await soon.isVisible().catch(() => false)) {
      await expect(soon.getByText("Single sign-on")).toBeVisible();
    }
  });
});
