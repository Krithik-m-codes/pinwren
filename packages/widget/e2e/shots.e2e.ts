import { expect, type Page, test } from "@playwright/test";
import { mockApi } from "./mock";

// "Add screenshot" in the bug report's attachments: capture modes, the browser's own tab capture (a mocked
// getDisplayMedia), cropping to a dragged area, the annotate dialog, and the thumbnail preview / lightbox.

const report = (page: Page) => page.getByRole("dialog", { name: "Report a bug" });
const grid = (page: Page) => report(page).locator(".sh-grid");
const cards = (page: Page) => grid(page).locator(".sh-card");
const toast = (page: Page) => page.locator("pinwren-root .toast").last();
const annotateDlg = (page: Page) => page.getByRole("dialog", { name: "Annotate screenshot" });

async function ready(page: Page) {
  await page.goto("/");
  await expect(page.locator("pinwren-root .launcher")).toBeVisible();
}

async function openReport(page: Page) {
  await page.locator("pinwren-root .launcher").click();
  await page.getByRole("menuitem", { name: /Report a bug/ }).click();
  await expect(report(page)).toBeVisible();
  // The menu button only works once the capture engine is there.
  await expect(report(page).getByRole("button", { name: "Add screenshot" })).toBeEnabled();
}

const addShot = async (page: Page, item: string | RegExp) => {
  await report(page).getByRole("button", { name: "Add screenshot" }).click();
  await page.getByRole("menuitem", { name: item }).click();
};

/** getDisplayMedia that "shares" a 640x400 canvas; records the constraints and stopped tracks. */
async function fakeTabCapture(page: Page, mode: "ok" | "denied" = "ok") {
  await page.addInitScript((m) => {
    const w = window as unknown as { __stopped: number; __opts: unknown[] };
    w.__stopped = 0;
    w.__opts = [];
    navigator.mediaDevices.getDisplayMedia = (opts?: DisplayMediaStreamOptions) => {
      w.__opts.push(opts);
      if (m === "denied") return Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
      const c = document.createElement("canvas");
      c.width = 640;
      c.height = 400;
      const x = c.getContext("2d");
      if (!x) throw new Error("no 2D canvas");
      const paint = () => {
        x.fillStyle = "#0090ff";
        x.fillRect(0, 0, 640, 400);
        x.fillStyle = "#fff";
        x.font = "40px sans-serif";
        x.fillText("Browser capture", 40, 200);
      };
      paint();
      const timer = setInterval(paint, 40);
      const stream = c.captureStream(25);
      for (const t of stream.getTracks()) {
        const stop = t.stop.bind(t);
        t.stop = () => {
          w.__stopped++;
          clearInterval(timer);
          stop();
        };
      }
      return Promise.resolve(stream);
    };
  }, mode);
}

const decode = (page: Page, src: string) =>
  page.evaluate(
    (s) =>
      new Promise<{ w: number; h: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.src = s;
      }),
    src,
  );

type Sent = { name: string; contentType: string; dataUrl: string }[];

test("visible area becomes an attachment after the annotate dialog; thumbnail opens the lightbox", async ({
  page,
}) => {
  const mock = await mockApi(page);
  await ready(page);
  await openReport(page);
  await addShot(page, "Visible area");
  const dlg = annotateDlg(page);
  await expect(dlg).toBeVisible();
  // Mark something, then attach.
  const canvas = dlg.locator(".ed canvas");
  const b = await canvas.boundingBox();
  if (!b) throw new Error("no editor canvas");
  await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5, { steps: 5 });
  await page.mouse.up();
  await expect(canvas).toHaveAttribute("data-shapes", "1");
  await dlg.getByRole("button", { name: "Attach" }).click();
  await expect(dlg).toBeHidden();
  await expect(toast(page)).toContainText("Screenshot attached");

  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toContainText(/screenshot-visible-.*\.png/);
  // The thumbnail decodes (no skeleton left) and keeps its 16:10 box whatever the picture's shape.
  await expect(cards(page).first()).toHaveClass(/loaded/);
  const thumb = await cards(page).first().locator(".sh-thumb").boundingBox();
  expect(thumb && Math.abs(thumb.width / thumb.height - 1.6)).toBeLessThan(0.05);

  await cards(page)
    .first()
    .getByRole("button", { name: /^Preview screenshot-visible/ })
    .click();
  const lb = page.getByRole("dialog", { name: /^Preview screenshot-visible/ });
  await expect(lb).toBeVisible();
  await expect(lb.locator(".sh-zoom")).toHaveText(/^\d+%$/);
  const fit = await lb.locator(".sh-zoom").textContent();
  await lb.getByRole("button", { name: "Zoom in" }).click();
  await expect(lb.locator(".sh-zoom")).not.toHaveText(fit ?? "");
  await page.keyboard.press("0");
  await expect(lb.locator(".sh-zoom")).toHaveText(fit ?? "");
  // Escape closes the lightbox, not the report behind it.
  await page.keyboard.press("Escape");
  await expect(lb).toBeHidden();
  await expect(report(page)).toBeVisible();

  await report(page).getByLabel("Describe the bug").fill("Broken layout");
  await report(page).getByRole("button", { name: "Send report" }).click();
  await expect(toast(page)).toContainText("#1 sent");
  const sent = mock.items[0]?.payload?.attachments as Sent;
  expect(sent).toHaveLength(1);
  expect(sent[0]?.contentType).toBe("image/png");
  expect(sent[0]?.name).toMatch(/^screenshot-visible-/);
  const size = await decode(page, sent[0]?.dataUrl ?? "");
  expect(size.w).toBeGreaterThan(100);
});

test("selected area crops to the dragged rectangle (device pixels)", async ({ page }) => {
  await mockApi(page);
  await ready(page);
  await openReport(page);
  await addShot(page, "Selected area");
  // The report steps aside; drag a 300x200 box over the page.
  await expect(report(page)).toBeHidden();
  await expect(page.locator("pinwren-root .sh-hint")).toContainText("Drag to select an area");
  await page.mouse.move(100, 120);
  await page.mouse.down();
  await page.mouse.move(250, 200, { steps: 4 });
  await page.mouse.move(400, 320, { steps: 4 });
  await page.mouse.up();
  await expect(report(page)).toBeVisible();
  const dlg = annotateDlg(page);
  await expect(dlg).toBeVisible();
  await dlg.getByRole("button", { name: "Attach" }).click();
  await expect(cards(page)).toHaveCount(1);
  const src = await cards(page).first().locator("img").getAttribute("src");
  const dpr = await page.evaluate(() => devicePixelRatio);
  const size = await decode(page, src ?? "");
  expect(size.w).toBe(Math.round(300 * dpr));
  expect(size.h).toBe(Math.round(200 * dpr));
});

test("selected area: Escape cancels and attaches nothing", async ({ page }) => {
  await mockApi(page);
  await ready(page);
  await openReport(page);
  await addShot(page, "Selected area");
  await expect(report(page)).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(report(page)).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
});

test("browser tab capture: getDisplayMedia, widget hidden from the frame, tracks stopped", async ({
  page,
}) => {
  await fakeTabCapture(page);
  await mockApi(page);
  await ready(page);
  await openReport(page);
  await addShot(page, /This tab/);
  const dlg = annotateDlg(page);
  await expect(dlg).toBeVisible();
  await dlg.getByRole("button", { name: "Attach" }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toContainText(/screenshot-tab-/);
  const src = await cards(page).first().locator("img").getAttribute("src");
  expect(await decode(page, src ?? "")).toEqual({ w: 640, h: 400 });
  // Asked for the current tab, at the screen's resolution; the sharing indicator is gone again.
  const opts = (await page.evaluate(() => (window as unknown as { __opts: unknown[] }).__opts[0])) as {
    preferCurrentTab: boolean;
    video: { displaySurface: string };
  };
  expect(opts.preferCurrentTab).toBe(true);
  expect(opts.video.displaySurface).toBe("browser");
  expect(await page.evaluate(() => (window as unknown as { __stopped: number }).__stopped)).toBeGreaterThan(
    0,
  );
  // The widget's UI is back after the frame was grabbed.
  await expect(page.locator("pinwren-root .launcher")).toBeVisible();
  await expect(report(page)).toBeVisible();
});

test("browser tab capture denied: a clear message, nothing attached", async ({ page }) => {
  await fakeTabCapture(page, "denied");
  await mockApi(page);
  await ready(page);
  await openReport(page);
  await addShot(page, /This tab/);
  await expect(report(page).locator(".err")).toContainText("cancelled or blocked");
  await expect(cards(page)).toHaveCount(0);
  await expect(report(page).getByRole("button", { name: "Add screenshot" })).toBeEnabled();
});

test("without getDisplayMedia the menu offers no browser capture", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
  });
  await mockApi(page);
  await ready(page);
  await openReport(page);
  await report(page).getByRole("button", { name: "Add screenshot" }).click();
  await expect(page.getByRole("menuitem")).toHaveCount(4);
  await expect(page.getByRole("menuitem", { name: /This tab/ })).toHaveCount(0);
});

test("Cancel in the annotate dialog drops the shot; Escape inside it does not close the report", async ({
  page,
}) => {
  await mockApi(page);
  await ready(page);
  await openReport(page);
  await addShot(page, "Full page");
  const dlg = annotateDlg(page);
  await expect(dlg).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  await expect(report(page)).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
});

test("remove, retake and annotate actions on a screenshot thumbnail; the limit disables the menu", async ({
  page,
}) => {
  await fakeTabCapture(page);
  await mockApi(page);
  await ready(page);
  await openReport(page);
  for (let i = 0; i < 3; i++) {
    await addShot(page, /This tab/);
    await annotateDlg(page).getByRole("button", { name: "Attach" }).click();
    await expect(cards(page)).toHaveCount(i + 1);
  }
  await expect(report(page).getByRole("button", { name: "Add screenshot" })).toBeDisabled();

  // Retake replaces in place, same mode.
  const first = cards(page).first();
  await first.hover();
  await first.getByRole("button", { name: /^Retake/ }).click();
  await annotateDlg(page).getByRole("button", { name: "Attach" }).click();
  await expect(cards(page)).toHaveCount(3);
  // One more share, and the same slot: the first thumbnail is a fresh card.
  expect(await page.evaluate(() => (window as unknown as { __opts: unknown[] }).__opts.length)).toBe(4);
  await expect(cards(page).first()).toHaveClass(/loaded/);

  // Annotate an attachment: the dialog opens on it; saving changed marks keeps three attachments.
  await cards(page).nth(1).hover();
  await cards(page)
    .nth(1)
    .getByRole("button", { name: /^Annotate/ })
    .click();
  const dlg = annotateDlg(page);
  await expect(dlg).toBeVisible();
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toBeHidden();
  await expect(cards(page)).toHaveCount(3);

  await cards(page).nth(2).hover();
  await cards(page)
    .nth(2)
    .getByRole("button", { name: /^Remove/ })
    .click();
  await expect(cards(page)).toHaveCount(2);
  await expect(report(page).getByRole("button", { name: "Add screenshot" })).toBeEnabled();
});

test("the menu is keyboard operable and closes on Escape without closing the report", async ({ page }) => {
  await mockApi(page);
  await ready(page);
  await openReport(page);
  const btn = report(page).getByRole("button", { name: "Add screenshot" });
  await btn.focus();
  await page.keyboard.press("Enter");
  await expect(btn).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem").nth(1)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(report(page)).toBeVisible();
  await expect(btn).toBeFocused();
});

test("the shots chunk is downloaded with the report, never on a normal page view", async ({ page }) => {
  const loaded: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("widget-shots.")) loaded.push(r.url());
  });
  await mockApi(page);
  await ready(page);
  expect(loaded).toHaveLength(0);
  await openReport(page);
  expect(loaded).toHaveLength(1);
});
