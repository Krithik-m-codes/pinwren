import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { mockApi } from "./mock";

// Bug report mode: capture modes, editor tools, attachments, offline outbox, drafts, locales.

const SHOTS = fileURLToPath(new URL("./__screenshots__/", import.meta.url));
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${SHOTS}${name}.png`, animations: "disabled" });

const report = (page: Page) => page.getByRole("dialog", { name: "Report a bug" });
const canvas = (page: Page) => page.locator("pinwren-root .ed canvas");
const toast = (page: Page) => page.locator("pinwren-root .toast").last();

// 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error("element has no box");
  return b;
}

async function ready(page: Page, url = "/") {
  await page.goto(url);
  await expect(page.locator("pinwren-root .launcher")).toBeVisible();
}

async function openReport(page: Page) {
  await page.locator("pinwren-root .launcher").click();
  await page.getByRole("menuitem", { name: /Report a bug/ }).click();
  await expect(report(page)).toBeVisible();
}

/** Drag on the screenshot between two points given as fractions of the canvas box. */
async function drawOn(page: Page, from: [number, number], to: [number, number]) {
  const b = await box(canvas(page));
  await page.mouse.move(b.x + b.width * from[0], b.y + b.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * ((from[0] + to[0]) / 2), b.y + b.height * ((from[1] + to[1]) / 2), {
    steps: 4,
  });
  await page.mouse.move(b.x + b.width * to[0], b.y + b.height * to[1], { steps: 4 });
  await page.mouse.up();
}

const shapes = (page: Page) => canvas(page).getAttribute("data-shapes");

/** Natural size of a data-URL image, decoded in the page. */
const imageSize = (page: Page, src: string) =>
  page.evaluate(
    (s) =>
      new Promise<{ w: number; h: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.src = s;
      }),
    src,
  );

/** Make the DOM capture fail, as on a page whose cross-origin assets taint SnapDOM. */
async function breakDomCapture(page: Page) {
  await page.route("**/widget-capture.*.js", async (route) => {
    const res = await route.fetch();
    const body = `${await res.text()}
;(() => { const m = window.__pinwrenCapture; m.capture = () => Promise.reject(new Error("DOM capture blocked")); })();`;
    await route.fulfill({ response: res, body });
  });
}

/** getDisplayMedia that "shares" a canvas, counting stopped tracks. */
async function fakeScreenShare(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __stopped: number; __shares: number };
    w.__stopped = 0;
    w.__shares = 0;
    navigator.mediaDevices.getDisplayMedia = () => {
      w.__shares++;
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
        x.fillText("Shared screen", 40, 200);
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
  });
}

test("visible capture → every editor tool, shortcuts, undo/redo, crop → send with severity", async ({
  page,
}) => {
  const mock = await mockApi(page);
  await ready(page);
  await page.evaluate(() => console.error("Checkout failed: 500"));
  await openReport(page);
  await expect(canvas(page)).toBeVisible();
  const cw = Number(await canvas(page).getAttribute("width"));
  const ch = Number(await canvas(page).getAttribute("height"));
  expect(cw).toBe(1280);
  expect(ch).toBe(800);
  const dlg = report(page);
  await expect(dlg.locator(".summary")).toContainText("1 console error");
  await expect(dlg.locator(".summary")).toContainText("Screenshot");

  // Box is the default tool.
  await drawOn(page, [0.05, 0.1], [0.3, 0.25]);
  await dlg.getByRole("button", { name: "Ellipse" }).click();
  await drawOn(page, [0.35, 0.1], [0.55, 0.3]);
  // Keyboard shortcuts work once focus is off the form fields.
  await page.keyboard.press("a");
  await expect(dlg.getByRole("button", { name: "Arrow" })).toHaveAttribute("aria-pressed", "true");
  await drawOn(page, [0.6, 0.4], [0.8, 0.2]);
  await page.keyboard.press("p");
  await drawOn(page, [0.1, 0.5], [0.3, 0.6]);
  await dlg.getByRole("button", { name: "Colour #0090ff" }).click();
  await dlg.getByRole("button", { name: "Large" }).click();
  await page.keyboard.press("t");
  const cb = await box(canvas(page));
  await page.mouse.click(cb.x + cb.width * 0.4, cb.y + cb.height * 0.55);
  const label = dlg.locator(".ed-text");
  await expect(label).toBeFocused();
  await label.fill("Price is wrong");
  await label.press("Enter");
  await expect(label).toHaveCount(0);
  await page.keyboard.press("b");
  await drawOn(page, [0.7, 0.6], [0.9, 0.75]);
  expect(await shapes(page)).toBe("6");
  await shot(page, "20-report-annotated");

  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  expect(await shapes(page)).toBe("4");
  await page.keyboard.press("Control+Shift+z");
  expect(await shapes(page)).toBe("5");
  await dlg.getByRole("button", { name: "Redo" }).click();
  expect(await shapes(page)).toBe("6");
  await expect(dlg.getByRole("button", { name: "Redo" })).toBeDisabled();

  // Crop to the top-left quarter: the exported screenshot is that size.
  await page.keyboard.press("c");
  await drawOn(page, [0.25, 0.25], [0.75, 0.75]);
  await shot(page, "21-report-crop");

  await dlg.getByLabel("Title").fill("Price shows ₹0");
  await dlg.getByLabel("Describe the bug").fill("The Guji card shows ₹0 after adding to cart.");
  await dlg.getByRole("radio", { name: "Critical" }).click();
  await dlg.getByRole("button", { name: "Send report" }).click();
  await expect(toast(page)).toHaveText("Bug report #1 sent — thank you!");
  await expect(report(page)).toHaveCount(0);

  const p = mock.items[0]?.payload;
  if (!p) throw new Error("nothing was sent");
  expect(p.kind).toBe("bug");
  expect(p.title).toBe("Price shows ₹0");
  expect(p.priority).toBe("urgent");
  expect(String(p.screenshot)).toMatch(/^data:image\/webp;base64,/);
  const size = await imageSize(page, String(p.screenshot));
  expect(Math.abs(size.w - cw / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(size.h - ch / 2)).toBeLessThanOrEqual(2);
  const diag = p.diagnostics as { console: { message: string }[] };
  expect(diag.console.some((c) => c.message.includes("Checkout failed"))).toBe(true);
  const perf = (p.metadata as { performance: Record<string, number> }).performance;
  expect(perf.ttfbMs).toBeGreaterThanOrEqual(0);
  expect(typeof perf.loadMs).toBe("number");
});

test("full-page and element capture", async ({ page }) => {
  const mock = await mockApi(page);
  await ready(page);
  await openReport(page);
  const dlg = report(page);
  await expect(canvas(page)).toBeVisible();

  await dlg.getByRole("button", { name: "Full page" }).click();
  await expect(dlg.getByRole("button", { name: "Full page" })).toHaveAttribute("aria-pressed", "true");
  const fullH = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(fullH).toBeGreaterThan(800);
  await expect.poll(async () => Number(await canvas(page).getAttribute("height"))).toBe(fullH);
  await shot(page, "22-report-full-page");

  await dlg.getByRole("button", { name: "Element" }).click();
  await expect(report(page)).toBeHidden();
  await expect(page.locator("pinwren-root .hint")).toContainText("Click the part of the page to capture");
  const h1 = await box(page.getByTestId("hero-title"));
  await page.mouse.move(h1.x + 30, h1.y + 20);
  await shot(page, "23-element-pick");
  await page.mouse.click(h1.x + 30, h1.y + 20);
  await expect(report(page)).toBeVisible();
  await expect.poll(async () => Number(await canvas(page).getAttribute("width"))).toBe(Math.round(h1.width));
  expect(Math.abs(Number(await canvas(page).getAttribute("height")) - h1.height)).toBeLessThanOrEqual(1);

  await dlg.getByLabel("Describe the bug").fill("Headline kerning");
  await dlg.getByRole("button", { name: "Send report" }).click();
  await expect(toast(page)).toContainText("#1 sent");
  const size = await imageSize(page, String(mock.items[0]?.payload?.screenshot));
  expect(Math.abs(size.w - h1.width)).toBeLessThanOrEqual(1);
});

test("DOM capture fails → screen share fallback (tracks stopped) or send without screenshot", async ({
  page,
}) => {
  await breakDomCapture(page);
  await fakeScreenShare(page);
  const mock = await mockApi(page);
  await ready(page);
  await openReport(page);
  const dlg = report(page);
  await expect(dlg).toContainText("We couldn't capture this page");
  await expect(dlg.locator(".summary")).toContainText("No screenshot");
  await shot(page, "24-capture-failed");

  await dlg.getByRole("button", { name: "Capture with screen share" }).click();
  await expect(canvas(page)).toBeVisible();
  expect(await canvas(page).getAttribute("width")).toBe("640");
  expect(await page.evaluate(() => (window as unknown as { __stopped: number }).__stopped)).toBeGreaterThan(
    0,
  );
  await expect(page.locator("pinwren-root")).toHaveCSS("visibility", "visible");
  await drawOn(page, [0.1, 0.1], [0.6, 0.6]);
  await dlg.getByLabel("Describe the bug").fill("Captured by screen share");
  await dlg.getByRole("button", { name: "Send report" }).click();
  await expect(toast(page)).toContainText("#1 sent");
  expect(String(mock.items[0]?.payload?.screenshot)).toMatch(/^data:image\//);

  // Second report: skip the screenshot entirely.
  await openReport(page);
  await dlg.getByRole("button", { name: "Send without screenshot" }).click();
  await expect(dlg).toContainText("the report will be sent without one");
  await dlg.getByLabel("Describe the bug").fill("No picture this time");
  await dlg.getByRole("button", { name: "Send report" }).click();
  await expect(toast(page)).toContainText("#2 sent");
  expect(mock.items[1]?.payload?.screenshot).toBeUndefined();
});

test("screen share is also a manual capture mode", async ({ page }) => {
  await fakeScreenShare(page);
  await mockApi(page);
  await ready(page);
  await openReport(page);
  await expect(canvas(page)).toBeVisible();
  await report(page).getByRole("button", { name: "Screen share" }).click();
  await expect.poll(() => canvas(page).getAttribute("width")).toBe("640");
  await expect(report(page).getByRole("button", { name: "Screen share" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("attachments: browse, paste, drop, validation, remove", async ({ page }) => {
  const mock = await mockApi(page);
  await ready(page);
  await openReport(page);
  const dlg = report(page);
  const files = dlg.locator(".file");

  const chooser = page.waitForEvent("filechooser", { timeout: 5000 });
  await dlg.getByRole("button", { name: "browse" }).click();
  await (
    await chooser
  ).setFiles([
    { name: "receipt.png", mimeType: "image/png", buffer: PNG },
    { name: "invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF") },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hi") },
  ]);
  await expect(files).toHaveCount(2);
  await expect(dlg.locator(".err")).toContainText("notes.txt: only images and PDFs can be attached");

  // Paste an image from the clipboard into the description.
  const desc = dlg.getByLabel("Describe the bug");
  await desc.fill("See attached");
  await desc.evaluate((el, b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "image.png", { type: "image/png" }));
    el.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, composed: true, cancelable: true }),
    );
  }, PNG.toString("base64"));
  await expect(files).toHaveCount(3);
  await expect(files.nth(2)).toContainText("pasted-");
  await expect(desc).toHaveValue("See attached");

  // A fourth file (dropped) is refused.
  await dlg.locator(".drop").evaluate((el, b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "fourth.png", { type: "image/png" }));
    el.dispatchEvent(
      new DragEvent("drop", { dataTransfer: dt, bubbles: true, composed: true, cancelable: true }),
    );
  }, PNG.toString("base64"));
  await expect(dlg.locator(".err")).toContainText("You can attach up to 3 files");
  await expect(files).toHaveCount(3);
  await shot(page, "25-report-attachments");

  await dlg.getByRole("button", { name: "Remove invoice.pdf" }).click();
  await expect(files).toHaveCount(2);
  await expect(dlg.locator(".summary")).toContainText("2 attachments");
  await dlg.getByRole("button", { name: "Send report" }).click();
  await expect(toast(page)).toContainText("#1 sent");
  const att = mock.items[0]?.payload?.attachments as { name: string; contentType: string; dataUrl: string }[];
  expect(att.map((a) => a.name)[0]).toBe("receipt.png");
  expect(att).toHaveLength(2);
  expect(att[0]?.dataUrl).toMatch(/^data:image\/png;base64,/);
});

test("offline submit is queued, shown, and flushed when the network comes back", async ({
  page,
  context,
}) => {
  const mock = await mockApi(page);
  await ready(page);
  await openReport(page);
  const dlg = report(page);
  await dlg.getByLabel("Describe the bug").fill("Sent while offline");
  await context.setOffline(true);
  mock.offline = true;
  await dlg.getByRole("button", { name: "Send report" }).click();
  await expect(toast(page)).toContainText("You're offline");
  await expect(report(page)).toHaveCount(0);
  await expect(page.locator("pinwren-root .launcher")).toHaveClass(/queued/);
  await page.locator("pinwren-root .launcher").click();
  await expect(page.getByRole("menuitem", { name: /1 report waiting to send/ })).toBeVisible();
  await shot(page, "26-queued-menu");
  await page.keyboard.press("Escape");
  expect(mock.items).toHaveLength(0);

  mock.offline = false;
  await context.setOffline(false); // fires `online`
  await expect.poll(() => mock.items.length).toBe(1);
  await expect(toast(page)).toContainText("Saved report #1 sent");
  await expect(page.locator("pinwren-root .launcher")).not.toHaveClass(/queued/);
  expect(mock.items[0]?.body).toBe("Sent while offline");
});

test("a 5xx submit is queued and retried with the same clientId on the next page load", async ({ page }) => {
  const mock = await mockApi(page);
  mock.postStatus = 503;
  await ready(page);
  await openReport(page);
  await report(page).getByLabel("Describe the bug").fill("Server was down");
  await report(page).getByRole("button", { name: "Send report" }).click();
  await expect(toast(page)).toContainText("saved and will send automatically");
  const first = mock.requests.filter((r) => r.method === "POST");
  expect(first).toHaveLength(1);

  mock.postStatus = null;
  await page.reload();
  await expect.poll(() => mock.items.length).toBe(1);
  const posts = mock.requests.filter((r) => r.method === "POST");
  const ids = posts.map((r) => (r.body as { clientId: string }).clientId);
  expect(new Set(ids).size).toBe(1);
  // Nothing left: another reload sends nothing new.
  await page.reload();
  await expect(page.locator("pinwren-root .launcher")).toBeVisible();
  await page.waitForTimeout(300);
  expect(mock.requests.filter((r) => r.method === "POST")).toHaveLength(posts.length);
});

test("draft survives a reload and resumes with text, annotations and attachments", async ({ page }) => {
  const mock = await mockApi(page);
  await ready(page);
  await openReport(page);
  const dlg = report(page);
  await dlg.getByLabel("Title").fill("Cart badge");
  await dlg.getByLabel("Describe the bug").fill("The cart badge never updates");
  await dlg.getByRole("radio", { name: "High" }).click();
  await drawOn(page, [0.1, 0.1], [0.4, 0.4]);
  await dlg
    .locator("input[type=file]")
    .setInputFiles({ name: "log.png", mimeType: "image/png", buffer: PNG });
  await expect(dlg.locator(".file")).toHaveCount(1);
  await page.waitForTimeout(700); // drafts save 400 ms after the last change
  await page.reload();
  await expect(page.locator("pinwren-root .launcher")).toBeVisible();

  await page.locator("pinwren-root .launcher").click();
  await expect(page.getByRole("menuitem", { name: /Report a bug/ })).toContainText(
    "You have an unsent draft",
  );
  await page.getByRole("menuitem", { name: /Report a bug/ }).click();
  const ask = page.getByRole("alertdialog", { name: "Resume your bug report?" });
  await expect(ask).toBeVisible();
  await shot(page, "27-resume-draft");
  await ask.getByRole("button", { name: "Resume" }).click();
  await expect(dlg).toBeVisible();
  await expect(dlg.getByLabel("Title")).toHaveValue("Cart badge");
  await expect(dlg.getByLabel("Describe the bug")).toHaveValue("The cart badge never updates");
  await expect(dlg.getByRole("radio", { name: "High" })).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => shapes(page)).toBe("1");
  await expect(dlg.locator(".file")).toHaveCount(1);

  // Esc keeps the draft; Start over discards it.
  await page.keyboard.press("Escape");
  await expect(toast(page)).toHaveText("Draft saved");
  await page.keyboard.press("b");
  await ask.getByRole("button", { name: "Start over" }).click();
  await expect(dlg.getByLabel("Describe the bug")).toHaveValue("");
  await dlg.getByLabel("Describe the bug").fill("Fresh report");
  await dlg.getByRole("button", { name: "Send report" }).click();
  await expect(toast(page)).toContainText("#1 sent");
  await page.keyboard.press("b");
  await expect(dlg).toBeVisible();
  await expect(ask).toHaveCount(0);
  expect(mock.items[0]?.payload?.priority).toBe("medium");
});

test("capture config: console off, network failures, mask selectors", async ({ page }) => {
  const mock = await mockApi(page, {
    capture: { console: "off", maskSelectors: ["[data-testid=secret]", "::bad("] },
  });
  await ready(page);
  await page.evaluate(async () => {
    console.error("should not be captured");
    await fetch("/missing-asset.json").catch(() => {
      // a 404 resolves; this only absorbs a network error
    });
  });
  await openReport(page);
  const dlg = report(page);
  await expect(canvas(page)).toBeVisible();
  await expect(dlg.locator(".summary")).toContainText("0 console errors");
  await expect(dlg.locator(".summary")).toContainText("1 failed request");
  await dlg.getByLabel("Describe the bug").fill("diag");
  await dlg.getByRole("button", { name: "Send report" }).click();
  await expect(toast(page)).toContainText("#1 sent");
  const d = mock.items[0]?.payload?.diagnostics as { console: unknown[]; network: { status: number }[] };
  expect(d.console).toHaveLength(0);
  expect(d.network[0]?.status).toBe(404);
});

test("French UI from data-locale, lazy-loaded catalogue", async ({ page }) => {
  await mockApi(page);
  const requested: string[] = [];
  page.on("request", (r) => requested.push(new URL(r.url()).pathname));
  await ready(page, "/?locale=fr");
  expect(requested.some((p) => /^\/widget-i18n-fr\.[0-9a-f]{10}\.js$/.test(p))).toBe(true);
  await page.locator("pinwren-root .launcher").click();
  await expect(page.getByRole("menuitem", { name: /Ajouter un commentaire/ })).toBeVisible();
  await page.getByRole("menuitem", { name: /Signaler un bug/ }).click();
  const dlg = page.getByRole("dialog", { name: "Signaler un bug" });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Envoyer le rapport" })).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Page entière" })).toBeVisible();
  await expect(canvas(page)).toBeVisible();
  await shot(page, "28-report-fr");
  await page.keyboard.press("Escape");
  await page.keyboard.press("c");
  await expect(page.locator("pinwren-root .hint")).toContainText("Cliquez pour commenter");
});

test.describe("browser language", () => {
  test.use({ locale: "de-DE" });
  test("German from navigator.language; English pages never load a catalogue", async ({ page }) => {
    await mockApi(page);
    await ready(page);
    await page.locator("pinwren-root .launcher").click();
    await expect(page.getByRole("menuitem", { name: /Fehler melden/ })).toBeVisible();
  });
});

test("English visitors download no locale file", async ({ page }) => {
  await mockApi(page);
  const requested: string[] = [];
  page.on("request", (r) => requested.push(new URL(r.url()).pathname));
  await ready(page);
  expect(requested.some((p) => p.includes("widget-i18n"))).toBe(false);
});

test("dark mode report and destroy() tears the modal down", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await mockApi(page);
  await ready(page);
  await openReport(page);
  await expect(canvas(page)).toBeVisible();
  await report(page).getByLabel("Describe the bug").fill("Dark mode check");
  await drawOn(page, [0.2, 0.2], [0.5, 0.45]);
  await shot(page, "29-report-dark");
  await page.evaluate(() => (window as unknown as { Pinwren: { destroy(): void } }).Pinwren.destroy());
  await expect(page.locator("pinwren-root")).toHaveCount(0);
});
