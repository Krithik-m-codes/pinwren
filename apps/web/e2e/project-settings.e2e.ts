import { SITE_ORIGIN, seed, shoot } from "./env";
import { expect, test } from "./fixtures";

test.describe("project settings", () => {
  test("widget tab: every change previews live and persists", async ({ page, request }) => {
    const { projectId, publicKey } = seed();
    await page.goto(`/projects/${projectId}?tab=widget`);
    const preview = page.getByTestId("launcher-preview");
    await expect(preview).toBeVisible();
    await shoot(page, "project-widget", { fullPage: true });

    // Shape → pill with a label; the preview shows the label as you type.
    await page.getByRole("group", { name: "Shape" }).getByRole("button", { name: "Pill" }).click();
    await expect(page.getByText("Widget settings saved").first()).toBeVisible();
    const label = page.getByLabel("Pill label");
    await label.fill("Send feedback");
    await expect(preview.getByText("Send feedback")).toBeVisible();
    await label.press("Enter");

    // Position, icon, accent (swatch), tooltip, offset.
    await page.getByRole("radio", { name: "Top left" }).click();
    await page.getByRole("group", { name: "Icon" }).getByRole("button", { name: "Bug" }).click();
    await page.getByRole("button", { name: /Accent colour/ }).click();
    await page.getByRole("button", { name: "#e5484d" }).click();
    await page.keyboard.press("Escape");
    const tooltip = page.getByLabel("Tooltip");
    await tooltip.fill("Found a problem?");
    await tooltip.blur();
    await expect(preview.getByText("Found a problem?")).toBeVisible();
    const offsetX = page.getByLabel("Offset x in pixels");
    await offsetX.fill("48");
    await offsetX.press("Enter");

    // Behaviour + consent.
    await page.getByRole("switch", { name: "Right-click to comment" }).click();
    await page.getByRole("switch", { name: "Ask for consent" }).click();
    const privacy = page.getByLabel("Privacy policy link");
    await privacy.fill("not a url");
    await privacy.blur();
    await expect(page.getByText("Enter a full URL")).toBeVisible();
    await privacy.fill("https://e2e.example.com/privacy");
    await privacy.blur();
    await expect(preview.getByText("Before you send")).toBeVisible();

    // Validation from the shared schema: an offset over 400 is refused client-side.
    await offsetX.fill("999");
    await offsetX.press("Enter");
    await expect(page.getByText("Between 0 and 400")).toBeVisible();
    await offsetX.fill("48");
    await offsetX.press("Enter");

    await expect
      .poll(async () => {
        const r = await request.get("/w/config", {
          headers: { "x-annota-key": publicKey, origin: SITE_ORIGIN },
        });
        const { widget } = (await r.json()) as { widget: Record<string, Record<string, unknown>> };
        return {
          launcher: widget.launcher,
          rightClickComment: widget.rightClickComment,
          consent: widget.consent,
        };
      })
      .toMatchObject({
        launcher: {
          shape: "pill",
          label: "Send feedback",
          position: "top-left",
          icon: "bug",
          accent: "#e5484d",
          tooltip: "Found a problem?",
          offset: { x: 48 },
        },
        rightClickComment: true,
        consent: { enabled: true, privacyUrl: "https://e2e.example.com/privacy" },
      });

    await page.reload();
    await expect(page.getByLabel("Pill label")).toHaveValue("Send feedback");
    await shoot(page, "project-widget-edited", { fullPage: true });
  });

  test("capture, privacy and danger tabs", async ({ page, request }) => {
    const { projectId } = seed();
    await page.goto(`/projects/${projectId}?tab=capture`);
    await page
      .getByRole("group", { name: "Console capture" })
      .getByRole("button", { name: "Errors" })
      .click();
    await expect(page.getByText("Capture settings saved").first()).toBeVisible();
    const mask = page.getByLabel("Add a selector");
    await mask.fill("[[bad");
    await mask.press("Enter");
    await expect(page.getByText("That isn't a valid CSS selector")).toBeVisible();
    await mask.fill(".customer-email");
    await mask.press("Enter");
    await expect(
      page.getByRole("list", { name: "Mask selectors" }).getByText(".customer-email"),
    ).toBeVisible();
    await shoot(page, "project-capture");

    await page.getByRole("tab", { name: "Privacy & data" }).click();
    await page.getByRole("combobox", { name: "Retention" }).click();
    await page.getByRole("option", { name: "90 days" }).click();
    await expect(page.getByText("Feedback is kept for 90 days").first()).toBeVisible();
    await page.getByRole("switch", { name: "Email the reporter" }).click();
    await page.getByRole("switch", { name: "Use the instance default" }).click();
    const limit = page.getByLabel("Reports and replies per minute");
    await limit.fill("25");
    await limit.press("Enter");
    await expect(page.getByText("Limit set to 25 per minute").first()).toBeVisible();
    await shoot(page, "project-privacy");

    const r = await request.get(`/api/projects/${projectId}`);
    const { project } = (await r.json()) as { project: Record<string, unknown> };
    expect(project).toMatchObject({
      retentionDays: 90,
      notifyReporter: true,
      widgetRateLimitPerMin: 25,
      captureConfig: { console: "errors", maskSelectors: [".customer-email"] },
    });

    await page.getByRole("tab", { name: "Danger zone" }).click();
    await shoot(page, "project-danger");
  });

  test("archive and restore a project; rotate its key", async ({ page, request }) => {
    const res = await request.post("/api/projects", { data: { name: "Throwaway", allowedOrigins: [] } });
    const { project } = (await res.json()) as { project: { id: string; publicKey: string } };
    await page.goto(`/projects/${project.id}?tab=danger`);
    await page.getByRole("button", { name: "Rotate key" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Rotate key" }).click();
    await expect(page.getByText("New key generated")).toBeVisible();
    await expect(page.getByText(project.publicKey)).toHaveCount(0);

    await page.getByRole("button", { name: "Archive" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Archive project" }).click();
    await page.waitForURL("**/projects");
    await expect(page.getByRole("link", { name: /Throwaway/ })).toHaveCount(0);

    await page.goto(`/projects/${project.id}?tab=danger`);
    await expect(page.getByText("This project is archived")).toBeVisible();
    await page.getByRole("button", { name: "Restore", exact: true }).last().click();
    await expect(page.getByText("Project restored").first()).toBeVisible();
    await expect(page.getByText("This project is archived")).toHaveCount(0);
  });
});
