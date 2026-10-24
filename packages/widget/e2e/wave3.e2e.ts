import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { type CDPSession, expect, type Locator, type Page, test } from "@playwright/test";
import { anchorFor, mockApi, seed } from "./mock";

// Wave 3 (docs/contracts/wave-3.md): panel actions, branding, privacy mode, masking as solid blocks, export —
// plus Russian, comment on selection, focus management and touch input.

const SHOTS = fileURLToPath(new URL("./__screenshots__/", import.meta.url));
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${SHOTS}${name}.png`, animations: "disabled" });

const HERO = "Small-batch coffee, roasted every Monday.";
const BLOCK = [161, 161, 170]; // mask.ts BLOCK_FILL #a1a1aa
const launcher = (page: Page) => page.locator("pinwren-root .launcher");
const composer = (page: Page) => page.getByRole("dialog", { name: "New comment" });
const report = (page: Page) => page.getByRole("dialog", { name: "Report a bug" });
const canvas = (page: Page) => page.locator("pinwren-root .ed canvas");
const toast = (page: Page) => page.locator("pinwren-root .toast").last();

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error("element has no box");
  return b;
}

async function ready(page: Page, url = "/") {
  await page.goto(url);
  await expect(launcher(page)).toBeVisible();
}

/** Description of whatever has focus, looking inside the widget's (test-opened) shadow root. */
const active = (page: Page) =>
  page.evaluate(() => {
    const a = document.querySelector("pinwren-root")?.shadowRoot?.activeElement ?? document.activeElement;
    return a ? `${a.tagName.toLowerCase()}|${a.getAttribute("aria-label") ?? a.textContent.trim()}` : "";
  });

/** True when focus is inside the element matching `sel` in the widget's shadow root. */
const focusIn = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const r = document.querySelector("pinwren-root")?.shadowRoot;
    const a = r?.activeElement;
    return !!a && !!r.querySelector(s)?.contains(a);
  }, sel);

/** RGB of the editor canvas (the captured screenshot) at canvas pixel (x, y). */
const pixel = (page: Page, x: number, y: number) =>
  canvas(page).evaluate(
    (c, [px, py]) =>
      Array.from((c as HTMLCanvasElement).getContext("2d")?.getImageData(px, py, 1, 1).data ?? []).slice(
        0,
        3,
      ),
    [Math.round(x), Math.round(y)] as const,
  );

/** RGB of a data-URL image at (x, y), decoded in the page. */
const imagePixel = (page: Page, src: string, x: number, y: number) =>
  page.evaluate(
    ([s, px, py]) =>
      new Promise<number[]>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement("canvas");
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const ctx = c.getContext("2d");
          if (!ctx) {
            resolve([]);
            return;
          }
          ctx.drawImage(img, 0, 0);
          resolve(Array.from(ctx.getImageData(px, py, 1, 1).data).slice(0, 3));
        };
        img.src = s;
      }),
    [src, Math.round(x), Math.round(y)] as const,
  );

const openBug = (page: Page) =>
  page.evaluate(() => (window as unknown as { Pinwren: { open(m: string): void } }).Pinwren.open("bug"));

const close = (rgb: number[], want: number[], tol = 6) =>
  rgb.every((v, i) => Math.abs(v - (want[i] ?? 0)) <= tol);

// --- §1 Panel actions ---------------------------------------------------------------------------------

test("panel action link opens the substituted, URL-encoded URL in a new tab without opener or referrer", async ({
  page,
  context,
}) => {
  await context.route("https://tickets.example/**", (r) =>
    r.fulfill({ status: 200, contentType: "text/html", body: "<title>ticket</title>ok" }),
  );
  await mockApi(page, {
    widget: {
      panelActions: [
        {
          id: "ticket",
          label: "Create ticket",
          kind: "link",
          url: "https://tickets.example/new?ref={id}&n={number}&page={url}&p={projectSlug}",
          icon: "ticket",
          visibleTo: "everyone",
        },
        {
          id: "team",
          label: "Team only",
          kind: "link",
          url: "https://t.example/{id}",
          icon: null,
          visibleTo: "team",
        },
        {
          id: "hook",
          label: "Hook",
          kind: "webhook",
          url: "https://h.example/",
          icon: null,
          visibleTo: "everyone",
        },
        {
          id: "bad",
          label: "Bad",
          kind: "link",
          url: "javascript:alert(1)",
          icon: null,
          visibleTo: "everyone",
        },
      ],
    },
    items: [seed({ number: 7, anchor: anchorFor("hero-title", "h1", HERO, { xPct: 60, yPct: 40 }) })],
  });
  await ready(page, "/?pinwren=fb_7");
  const thread = page.getByRole("dialog", { name: "Other #7" });
  await expect(thread).toBeVisible();
  // The card's stylesheet comes with the lazy chunk even when the side panel was never opened.
  expect(await thread.locator(".head").evaluate((el) => getComputedStyle(el).display)).toBe("flex");
  const acts = thread.getByRole("group", { name: "Actions" });
  await expect(acts.getByRole("link")).toHaveCount(1);
  const link = acts.getByRole("link", { name: "Create ticket (opens in a new tab)" });
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await shot(page, "30-panel-action");

  const [tab] = await Promise.all([context.waitForEvent("page"), link.click()]);
  await tab.waitForLoadState();
  // {url} is the page without our ?pinwren= deep-link parameter.
  expect(tab.url()).toBe(
    "https://tickets.example/new?ref=fb_7&n=7&page=http%3A%2F%2Flocalhost%3A5180%2F&p=lumen",
  );
  expect(await tab.evaluate(() => [window.opener === null, document.referrer])).toEqual([true, ""]);
});

// --- §2 Branding --------------------------------------------------------------------------------------

test("branding: no 'Powered by', dialog accent on primary buttons, logo in the report header", async ({
  page,
}) => {
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.route("**/api/assets/**", (r) =>
    r.fulfill({ status: 200, contentType: "image/png", body: PNG }),
  );
  await mockApi(page, {
    branding: { hidePoweredBy: true, dialogAccent: "#0f766e", logoUrl: "/api/assets/logo-1" },
  });
  await ready(page);
  await launcher(page).click();
  const menu = page.getByRole("menu", { name: "Feedback" });
  await expect(menu).toBeVisible();
  await expect(menu).not.toContainText("Powered by");
  // The launcher keeps its own accent; dialogs use the branding one.
  expect(await launcher(page).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    "rgb(214, 58, 28)",
  );
  await page.getByRole("menuitem", { name: /Create new annotation/ }).click();
  const h1 = await box(page.getByTestId("hero-title"));
  await page.mouse.click(h1.x + 40, h1.y + 20);
  const send = composer(page).getByRole("button", { name: "Send" });
  expect(await send.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(15, 118, 110)");
  expect(await send.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(255, 255, 255)");
  await shot(page, "31-branding-composer");
  await page.keyboard.press("Escape");

  await page.keyboard.press("b");
  await expect(report(page)).toBeVisible();
  const logo = report(page).locator("img.side-logo");
  await expect(logo).toHaveAttribute("src", "http://localhost:5180/api/assets/logo-1");
  await expect.poll(() => logo.evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBe(1);
  expect(
    await report(page)
      .getByRole("button", { name: "Send report" })
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe("rgb(15, 118, 110)");
  await shot(page, "32-branding-report");
});

test("an unsafe logo URL is never rendered", async ({ page }) => {
  await mockApi(page, { branding: { logoUrl: "javascript:alert(1)", dialogAccent: "red;}*{x:y" } });
  await ready(page);
  await page.keyboard.press("b");
  await expect(report(page)).toBeVisible();
  await expect(report(page).locator("img")).toHaveCount(0);
  await expect(report(page).locator(".side-ico")).toBeVisible();
});

// --- §3 Privacy mode + §4 masking as blocks -----------------------------------------------------------

test("privacy mode: text fields and masked nodes are solid blocks in every capture mode; no timing, coarse UA", async ({
  page,
}) => {
  const mock = await mockApi(page, {
    widget: { privacyMode: true },
    capture: { maskSelectors: ["[data-testid=secret]"] },
  });
  await ready(page);
  await page.locator("#email").fill("maria.rossi@example.com");
  // Bring the field and the masked note just below it to mid-screen.
  await page.locator("#email").evaluate((el) => el.scrollIntoView({ block: "center" }));
  const scrollY = await page.evaluate((): number => window.scrollY);
  const input = await box(page.locator("#email"));
  const secret = await box(page.getByTestId("secret"));
  const cx = input.x + input.width / 2;
  const cy = input.y + input.height / 2;

  await openBug(page); // focus is in the page's field, so the B shortcut (rightly) types instead
  await expect(canvas(page)).toBeVisible();
  // Visible area (1280×800 at DPR 1): the whole field is one neutral block, the page around it is not.
  expect(await pixel(page, cx, cy)).toEqual(BLOCK);
  expect(await pixel(page, input.x + 2, input.y + 2)).toEqual(BLOCK);
  expect(await pixel(page, input.x + input.width - 2, input.y + input.height - 2)).toEqual(BLOCK);
  expect(await pixel(page, input.x + 4, input.y - 6)).not.toEqual(BLOCK);
  expect(await pixel(page, secret.x + 40, secret.y + secret.height / 2)).toEqual(BLOCK);
  await shot(page, "33-privacy-visible");

  const dlg = report(page);
  await dlg.getByRole("button", { name: "Full page" }).click();
  await expect(dlg.getByRole("button", { name: "Full page" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => Number(await canvas(page).getAttribute("height"))).toBeGreaterThan(800);
  // The full page starts at the document's top, so page coordinates are viewport + scroll.
  expect(await pixel(page, cx, cy + scrollY)).toEqual(BLOCK);
  expect(await pixel(page, secret.x + 40, secret.y + scrollY + secret.height / 2)).toEqual(BLOCK);
  expect(await pixel(page, cx, cy + scrollY - input.height)).not.toEqual(BLOCK);

  await dlg.getByRole("button", { name: "Element" }).click();
  const form = await box(page.locator("form"));
  await page.mouse.click(form.x + 4, form.y + form.height / 2);
  await expect(dlg).toBeVisible();
  await expect
    .poll(async () => Number(await canvas(page).getAttribute("width")))
    .toBe(Math.round(form.width));
  expect(await pixel(page, cx - form.x, cy - form.y)).toEqual(BLOCK);

  await dlg.getByLabel("Describe the bug").fill("Masked");
  await dlg.getByRole("button", { name: "Send report" }).click();
  await expect(toast(page)).toContainText("#1 sent");
  const p = mock.items[0]?.payload;
  if (!p) throw new Error("nothing was sent");
  // The exported (lossy WebP) screenshot still shows the block.
  expect(close(await imagePixel(page, String(p.screenshot), cx - form.x, cy - form.y), BLOCK, 12)).toBe(true);
  expect(p.metadata).toBeUndefined();
  const env = p.environment as { userAgent: string; browser: string };
  expect(env.userAgent).toMatch(/^Chrome on (Windows|macOS|Linux)$/);
  expect(env.browser).toBe("Chrome");
});

test("without privacy mode, only built-in and configured masks are blocked", async ({ page }) => {
  const mock = await mockApi(page);
  await ready(page);
  await page.locator("#email").fill("visible@example.com");
  await page.evaluate(() => {
    const pw = document.createElement("input");
    pw.type = "password";
    pw.value = "hunter2";
    pw.id = "pw";
    pw.style.cssText = "position:fixed;left:40px;top:120px;width:160px;height:30px";
    document.body.append(pw);
  });
  const input = await box(page.locator("#email"));
  const pw = await box(page.locator("#pw"));
  await openBug(page);
  await expect(canvas(page)).toBeVisible();
  expect(await pixel(page, input.x + input.width / 2, input.y + input.height / 2)).not.toEqual(BLOCK);
  expect(await pixel(page, pw.x + pw.width / 2, pw.y + pw.height / 2)).toEqual(BLOCK);
  await report(page).getByLabel("Describe the bug").fill("x");
  await report(page).getByRole("button", { name: "Send report" }).click();
  await expect(toast(page)).toContainText("#1 sent");
  const p = mock.items[0]?.payload as {
    metadata?: { performance?: unknown };
    environment: { userAgent: string };
  };
  expect(p.metadata?.performance).toBeDefined();
  expect(p.environment.userAgent).toMatch(/Chrome\/\d+/);
});

// --- §5 Export ----------------------------------------------------------------------------------------

test("panel export downloads CSV (BOM, escaping, formula-safe) and JSON", async ({ page }) => {
  await mockApi(page, {
    items: [
      seed({
        number: 1,
        createdAt: "2026-10-20T10:00:00.000Z",
        body: '=HYPERLINK("http://evil.test","click")',
        anchor: anchorFor("guji", "article", "Ethiopia Guji", { xPct: 50, yPct: 50 }),
      }),
      seed({
        number: 2,
        createdAt: "2026-10-21T09:30:00.000Z",
        kind: "bug",
        title: "Price, again",
        body: 'Says "₹0"\non mobile',
        reporterName: "Dev Patel",
        anchor: anchorFor("huila", "article", "Colombia Huila", { xPct: 50, yPct: 50 }),
      }),
    ],
  });
  await ready(page);
  await launcher(page).click();
  await page.getByRole("menuitem", { name: /Show sidebar/ }).click();
  const panel = page.getByRole("complementary", { name: "Feedback sidebar" });
  await expect(panel.locator(".fcard")).toHaveCount(2);
  await panel.getByRole("button", { name: "Export" }).click();
  await expect(panel.getByRole("menu", { name: "Export" })).toBeVisible();
  await shot(page, "34-export-menu");

  const [csvDl] = await Promise.all([
    page.waitForEvent("download"),
    panel.getByRole("menuitem", { name: "CSV (Excel, Sheets)" }).click(),
  ]);
  expect(csvDl.suggestedFilename()).toMatch(/^pinwren-localhost-\d{4}-\d\d-\d\d\.csv$/);
  const bytes = await readFile(await csvDl.path());
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const csv = bytes.toString("utf8").slice(1);
  const lines = csv.split("\r\n");
  expect(lines[0]).toBe("Number,Kind,Status,Title,Body,Author,Created,Page URL,Deep link");
  // Newest first, as the panel lists them.
  expect(csv).toContain('2,bug,open,"Price, again","Says ""₹0""\non mobile",Dev Patel,');
  expect(csv).toContain(`1,comment,open,,"'=HYPERLINK(""http://evil.test"",""click"")",Sarah Miller,`);
  expect(csv).toContain(",http://localhost:5180/,http://localhost:5180/?pinwren=fb_1\r\n");

  await panel.getByRole("button", { name: "Export" }).click();
  const [jsonDl] = await Promise.all([
    page.waitForEvent("download"),
    panel.getByRole("menuitem", { name: "JSON" }).click(),
  ]);
  expect(jsonDl.suggestedFilename()).toMatch(/\.json$/);
  const data = JSON.parse(await readFile(await jsonDl.path(), "utf8")) as {
    number: number;
    body: string;
    deepLink: string;
  }[];
  expect(data.map((r) => r.number)).toEqual([2, 1]);
  expect(data[1]?.body).toBe('=HYPERLINK("http://evil.test","click")');
  expect(data[0]?.deepLink).toBe("http://localhost:5180/?pinwren=fb_2");

  // Export follows the list: a search that matches nothing exports nothing.
  await panel.getByLabel("Search feedback").fill("zzz");
  await panel.getByRole("button", { name: "Export" }).click();
  await panel.getByRole("menuitem", { name: "JSON" }).click();
  await expect(toast(page)).toHaveText("Nothing to export");
});

// --- Russian ------------------------------------------------------------------------------------------

test("Russian UI with its plural forms, lazy-loaded", async ({ page }) => {
  await mockApi(page, {
    items: [
      seed({
        number: 1,
        replyCount: 3,
        anchor: anchorFor("guji", "article", "Ethiopia Guji", { xPct: 50, yPct: 50 }),
      }),
      seed({
        number: 2,
        replyCount: 5,
        anchor: anchorFor("huila", "article", "Colombia Huila", { xPct: 50, yPct: 50 }),
      }),
    ],
  });
  const requested: string[] = [];
  page.on("request", (r) => requested.push(new URL(r.url()).pathname));
  await ready(page, "/?locale=ru");
  expect(requested.some((p) => /^\/widget-i18n-ru\.[0-9a-f]{10}\.js$/.test(p))).toBe(true);
  await expect(launcher(page)).toHaveAttribute("aria-label", "Оставить отзыв");
  await launcher(page).click();
  await expect(page.getByRole("menuitem", { name: /Создать заметку/ })).toBeVisible();
  // "Show sidebar" carries the open count (2 on this page).
  const sidebar = page.getByRole("menuitem", { name: /Показать боковую панель/ });
  await expect(sidebar).toContainText("2");
  await sidebar.click();
  const panel = page.getByRole("complementary", { name: "Панель отзывов" });
  // Plural forms: 3 → "ответа" (few), 5 → "ответов" (many).
  await expect(panel).toContainText("3 ответа");
  await expect(panel).toContainText("5 ответов");
  await expect(panel.getByRole("button", { name: "Мои", exact: true })).toBeVisible();
  await expect(panel.getByLabel("Поиск по отзывам")).toBeVisible();
  await shot(page, "35-panel-ru");
  await page.keyboard.press("Escape");
  await page.keyboard.press("b");
  await expect(page.getByRole("dialog", { name: "Сообщить об ошибке" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Отправить отчёт" })).toBeVisible();
});

// --- Comment on selection -----------------------------------------------------------------------------

/** Select characters [from, to) of the hero headline's text. */
const selectHero = (page: Page, from: number, to: number) =>
  page.evaluate(
    ([a, b]) => {
      const t = document.querySelector("[data-testid=hero-title]")?.firstChild as Text;
      const r = document.createRange();
      r.setStart(t, a);
      r.setEnd(t, b);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(r);
      const rect = r.getBoundingClientRect();
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    },
    [from, to] as const,
  );

test("comment on selection: offer, quote, textRange, and the quote highlighted on the page", async ({
  page,
}) => {
  const mock = await mockApi(page);
  await ready(page);
  const sel = await selectHero(page, 20, 40); // "roasted every Monday"
  await page.keyboard.press("c");
  const offer = page.locator("pinwren-root .selbtn");
  await expect(offer).toHaveText("Comment on selection");
  await shot(page, "36-selection-offer");
  await offer.click();

  const c = composer(page);
  await expect(c.getByLabel("Selected text")).toHaveText("roasted every Monday");
  await expect(c.getByLabel("Your comment")).toHaveAttribute("placeholder", "What about this text?");
  await c.getByLabel("Your comment").fill("Say which Monday — it's ambiguous.");
  await shot(page, "37-selection-composer");
  await c.getByRole("button", { name: "Send" }).click();
  await expect(toast(page)).toHaveText("#1 sent");

  const anchor = mock.items[0]?.anchor as { attrs: { testId: string }; textRange: unknown };
  expect(anchor.attrs.testId).toBe("hero-title");
  expect(anchor.textRange).toEqual({ startOffset: 20, endOffset: 40, quote: "roasted every Monday" });

  // The highlight sits on the quoted words.
  const hls = page.locator("pinwren-root .hl");
  await expect(hls.first()).toBeVisible();
  const hb = await box(hls.first());
  expect(hb.y).toBeLessThanOrEqual(sel.y + sel.h);
  expect(hb.y + hb.height).toBeGreaterThanOrEqual(sel.y);
  const all = await hls.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
  const left = Math.min(...all.map((r) => r.left));
  const right = Math.max(...all.map((r) => r.right));
  expect(Math.abs(left - sel.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(right - (sel.x + sel.w))).toBeLessThanOrEqual(2);

  await page.reload();
  await expect(launcher(page)).toBeVisible();
  await expect(page.locator("pinwren-root .hl").first()).toBeVisible();
  await page.getByRole("button", { name: /Other 1 by/ }).click();
  const thread = page.getByRole("dialog", { name: "Other #1" });
  await expect(thread.getByLabel("Selected text")).toHaveText("roasted every Monday");
  await shot(page, "38-selection-thread");
});

test("a quote that is no longer on the page is not highlighted; right-click offers comment on selection", async ({
  page,
}) => {
  await mockApi(page, {
    widget: { rightClickComment: true },
    items: [
      seed({
        number: 1,
        anchor: {
          ...anchorFor("hero-title", "h1", HERO, { xPct: 50, yPct: 50 }),
          textRange: { startOffset: 0, endOffset: 12, quote: "Old headline" },
        },
      }),
    ],
  });
  await ready(page);
  await expect(page.getByRole("button", { name: /Other 1 by/ })).toBeVisible();
  await expect(page.locator("pinwren-root .hl")).toHaveCount(0);

  await page.evaluate(() =>
    addEventListener("contextmenu", (e) => {
      (window as unknown as { prevented: boolean }).prevented = e.defaultPrevented;
    }),
  );
  const s = await selectHero(page, 0, 11); // "Small-batch"
  await page.mouse.click(s.x + s.w / 2, s.y + s.h / 2, { button: "right" });
  // The browser's own menu (Copy) is left alone…
  expect(await page.evaluate(() => (window as unknown as { prevented: boolean }).prevented)).toBe(false);
  // …and the offer appears beside it.
  await page.locator("pinwren-root .selbtn").click();
  await expect(composer(page).getByLabel("Selected text")).toHaveText("Small-batch");
});

// --- Focus management + events ------------------------------------------------------------------------

test("focus is trapped in the thread card and returns to the pin; Esc closes", async ({ page }) => {
  await mockApi(page, {
    items: [seed({ number: 1, anchor: anchorFor("hero-title", "h1", HERO, { xPct: 50, yPct: 50 }) })],
  });
  await ready(page);
  const pin = page.getByRole("button", { name: /Other 1 by/ });
  await pin.focus();
  await page.keyboard.press("Enter");
  const thread = page.getByRole("dialog", { name: "Other #1" });
  await expect(thread).toBeVisible();
  await expect.poll(() => focusIn(page, ".thread")).toBe(true);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await focusIn(page, ".thread"), `Tab ${i}`).toBe(true);
  }
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await focusIn(page, ".thread"), `Shift+Tab ${i}`).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(thread).toBeHidden();
  expect(await active(page)).toMatch(/^button\|Other 1 by Sarah Miller/);
});

test("bug report modal traps focus and gives it back to the launcher", async ({ page }) => {
  await mockApi(page);
  await ready(page);
  await launcher(page).focus();
  await page.keyboard.press("Enter");
  // The speed dial opens with focus on its first action (the markers toggle at the top).
  await expect(page.getByRole("menu").locator(".act").first()).toBeFocused();
  // Esc on the menu returns to the launcher.
  await page.keyboard.press("Escape");
  expect(await active(page)).toMatch(/^button\|Give feedback/);
  await page.keyboard.press("Enter");
  // Arrow keys move through the actions (wrapping); stop on "Report a bug".
  const bug = page.getByRole("menuitem", { name: /Report a bug/ });
  for (let i = 0; i < 8 && !(await bug.evaluate((el) => el.matches(":focus"))); i++) {
    await page.keyboard.press("ArrowDown");
  }
  await expect(bug).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(report(page)).toBeVisible();
  await expect(canvas(page)).toBeVisible();
  for (let i = 0; i < 40; i++) await page.keyboard.press("Tab");
  expect(await focusIn(page, ".modal")).toBe(true);
  await page.keyboard.press("Shift+Tab");
  expect(await focusIn(page, ".modal")).toBe(true);
  await page.keyboard.press("Escape");
  await expect(report(page)).toHaveCount(0);
  expect(await active(page)).toMatch(/^button\|Give feedback/);
});

test("a host-page focus trap can't steal focus from the widget", async ({ page }) => {
  await mockApi(page, {
    items: [
      seed({ number: 1, anchor: anchorFor("guji", "article", "Ethiopia Guji", { xPct: 50, yPct: 50 }) }),
    ],
  });
  await ready(page);
  // Like a modal library: any focus outside its dialog is pulled back in.
  await page.evaluate(() => {
    const d = document.createElement("div");
    d.innerHTML = '<button id="hm" style="position:fixed;left:8px;top:8px">Host modal</button>';
    document.body.append(d);
    document.addEventListener(
      "focusin",
      (e) => {
        if (!d.contains(e.target as Node)) document.getElementById("hm")?.focus();
      },
      true,
    );
    document.getElementById("hm")?.focus();
  });
  await page.getByRole("button", { name: /Other 1 by/ }).click();
  const reply = page.getByRole("dialog", { name: "Other #1" }).getByLabel("Reply", { exact: true });
  await reply.click();
  await page.keyboard.type("typed into the widget");
  await expect(reply).toHaveValue("typed into the widget");
  expect(await active(page)).toBe("textarea|Reply");
});

test("ready event (queued before load and added late) and destroy() restores console and fetch", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.readyCalls = 0;
    w.origError = console.error;
    // Kept only to compare identity later (the widget must restore the original).
    // eslint-disable-next-line @typescript-eslint/unbound-method
    w.origFetch = window.fetch;
    w.Pinwren = { q: [["on", "ready", () => (w.readyCalls as number)++]] };
  });
  await mockApi(page);
  await ready(page);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { readyCalls: number }).readyCalls))
    .toBe(1);
  expect(
    await page.evaluate(() => console.error === (window as unknown as { origError: unknown }).origError),
  ).toBe(false);
  const late = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) =>
        (window as unknown as { Pinwren: { on(e: string, cb: () => void): void } }).Pinwren.on("ready", () =>
          resolve(true),
        ),
      ),
  );
  expect(late).toBe(true);
  // Open lazy parts so their listeners exist, then tear everything down.
  await launcher(page).click();
  await page.getByRole("menuitem", { name: /Show sidebar/ }).click();
  await page.getByRole("button", { name: "Export" }).click();
  await page.evaluate(() => (window as unknown as { Pinwren: { destroy(): void } }).Pinwren.destroy());
  await expect(page.locator("pinwren-root")).toHaveCount(0);
  const restored = await page.evaluate(() => {
    const w = window as unknown as { origError: unknown; origFetch: unknown };
    return [console.error === w.origError, window.fetch === w.origFetch];
  });
  expect(restored).toEqual([true, true]);
  // No stray listeners throwing after teardown.
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.mouse.click(300, 300);
  await page.keyboard.press("c");
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});

// --- Touch --------------------------------------------------------------------------------------------

test.describe("touch", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 780 } });

  async function touchscreen(page: Page) {
    const cdp: CDPSession = await page.context().newCDPSession(page);
    const send = (type: "touchStart" | "touchMove" | "touchEnd", x?: number, y?: number) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: x === undefined || y === undefined ? [] : [{ x: Math.round(x), y: Math.round(y) }],
      });
    return {
      down: (x: number, y: number) => send("touchStart", x, y),
      move: async (x1: number, y1: number, x2: number, y2: number, steps = 8) => {
        for (let i = 1; i <= steps; i++)
          await send("touchMove", x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps);
      },
      up: () => send("touchEnd"),
    };
  }

  async function startCommentMode(page: Page) {
    await page.evaluate(() =>
      (window as unknown as { Pinwren: { open(m: string): void } }).Pinwren.open("comment"),
    );
    await expect(page.locator("pinwren-root .hint")).toContainText("Long-press to comment");
  }

  test("long-press pins a comment; a quick tap does not", async ({ page }) => {
    const mock = await mockApi(page);
    await ready(page);
    await startCommentMode(page);
    const t = await touchscreen(page);
    const h1 = await box(page.getByTestId("hero-title"));
    const x = h1.x + 60;
    const y = h1.y + 20;

    await t.down(x, y);
    await page.waitForTimeout(120);
    await t.up();
    await page.waitForTimeout(200);
    await expect(composer(page)).toHaveCount(0);

    await t.down(x, y);
    await page.waitForTimeout(650); // past the 450 ms long-press
    await t.up();
    const c = composer(page);
    await expect(c).toBeVisible();
    await expect(c).toHaveClass(/sheet/);
    await c.getByLabel("Your comment").fill("Pinned with a long-press");
    await shot(page, "39-touch-long-press");
    await c.getByRole("button", { name: "Send" }).click();
    await expect(toast(page)).toHaveText("#1 sent");
    const a = mock.items[0]?.anchor as { attrs: { testId: string }; pin: Record<string, number> };
    expect(a.attrs.testId).toBe("hero-title");
    expect(a.pin.wPct).toBeUndefined();
  });

  test("long-press then drag selects a region", async ({ page }) => {
    const mock = await mockApi(page);
    await ready(page);
    await page.getByTestId("guji").scrollIntoViewIfNeeded();
    await startCommentMode(page);
    const t = await touchscreen(page);
    const g = await box(page.getByTestId("guji"));
    const x = g.x + 20;
    const y = g.y + 20;
    await t.down(x, y);
    await page.waitForTimeout(650);
    await t.move(x, y, x + 180, y + 70);
    await expect(page.locator("pinwren-root .area.draft")).toBeVisible();
    await shot(page, "40-touch-drag");
    await t.up();
    const c = composer(page);
    await expect(c).toBeVisible();
    await expect(c.getByLabel("Your comment")).toHaveAttribute(
      "placeholder",
      "What should change in this area?",
    );
    await c.getByLabel("Your comment").fill("Region by touch");
    await c.getByRole("button", { name: "Send" }).click();
    await expect(toast(page)).toHaveText("#1 sent");
    const a = mock.items[0]?.anchor as { attrs: { testId: string }; pin: Record<string, number> };
    expect(a.attrs.testId).toBe("guji");
    expect(a.pin.wPct).toBeGreaterThan(30);
    expect(a.pin.hPct).toBeGreaterThan(10);
  });
});
