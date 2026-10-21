import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { anchorFor, mockApi, seed } from "./mock";

const SHOTS = fileURLToPath(new URL("./__screenshots__/", import.meta.url));
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${SHOTS}${name}.png`, animations: "disabled" });

const HERO = "Small-batch coffee, roasted every Monday.";
const launcher = (page: Page) => page.locator("pinwren-root .launcher");
const composer = (page: Page) => page.getByRole("dialog", { name: "New comment" });
const pins = (page: Page) => page.locator("pinwren-root .pin:not(.draft)");

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error("element has no box");
  return b;
}

async function ready(page: Page, url = "/") {
  await page.goto(url);
  await expect(page.locator("pinwren-root")).toBeAttached();
  // The launcher appears once /w/config has loaded; with a hidden launcher wait for that request instead.
  await page.waitForFunction(() => !!(window as unknown as { Pinwren?: unknown }).Pinwren);
}

/** Drag from (x1,y1) to (x2,y2) in small steps, like a person would. */
async function drag(
  page: Page,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  before?: () => Promise<unknown>,
) {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 6 });
  await page.mouse.move(x2, y2, { steps: 6 });
  await before?.();
  await page.mouse.up();
}

/** Click the centre of a page element through the comment-mode shield (it intercepts pointer events). */
async function clickOn(page: Page, testId: string) {
  const b = await box(page.getByTestId(testId));
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

const near = (a: number, b: number, tol = 2) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

test("drag-select a region → composer → send → region overlay on the element", async ({ page }) => {
  const mock = await mockApi(page);
  await ready(page);
  await launcher(page).click();
  await shot(page, "01-menu");
  await page.getByRole("menuitem", { name: /Add a comment/ }).click();
  await expect(page.locator("pinwren-root .hint")).toBeVisible();

  const h1 = await box(page.getByTestId("hero-title"));
  const r = { x: h1.x + 24, y: h1.y + 8, w: 300, h: 70 };
  await drag(page, r.x, r.y, r.x + r.w, r.y + r.h, () => shot(page, "02-region-drag"));

  const c = composer(page);
  await expect(c).toBeVisible();
  // The composer sits under the region it belongs to.
  const cb = await box(c);
  expect(cb.y).toBeGreaterThan(r.y + r.h);
  await c.getByRole("radio", { name: "Bug" }).click();
  await c
    .getByLabel("Your comment")
    .fill("Headline wraps awkwardly — the second line is orphaned on tablets.");
  await c.getByLabel("Your name").fill("Sarah Miller");
  await shot(page, "03-composer");
  await c.getByRole("button", { name: "Send" }).click();

  await expect(page.locator("pinwren-root .toast")).toHaveText("#1 sent");
  const sent = mock.items[0];
  if (!sent) throw new Error("nothing was sent");
  expect(sent.kind).toBe("bug");
  expect((sent.anchor as { attrs: { testId: string } }).attrs.testId).toBe("hero-title");
  const pin = (sent.anchor as { pin: Record<string, number> }).pin;
  expect(pin.wPct).toBeGreaterThan(0);
  expect(pin.hPct).toBeGreaterThan(0);
  near(pin.xPct as number, (24 / h1.width) * 100, 0.5);

  const area = page.locator("pinwren-root .area");
  await expect(area).toBeVisible();
  const ab = await box(area);
  near(ab.x, r.x);
  near(ab.y, r.y);
  near(ab.width, r.w);
  near(ab.height, r.h);

  // Hover → compact preview with kind tag, text and author.
  await pins(page).first().hover();
  const preview = page.locator("pinwren-root .preview");
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("Bug");
  await expect(preview).toContainText("Headline wraps");
  await expect(preview).toContainText("Sarah M.");
  await shot(page, "04-region-preview");
  expect(await launcher(page).locator(".count").textContent()).toBe("1");
});

test("click pin → thread → reply", async ({ page }) => {
  const mock = await mockApi(page, {
    items: [
      seed({
        number: 1,
        body: "Can this headline be shorter?",
        anchor: anchorFor("hero-title", "h1", HERO, { xPct: 80, yPct: 30 }),
        replyCount: 1,
        replies: [
          {
            id: "c1",
            body: "Yes — copy update ships Friday.",
            createdAt: new Date().toISOString(),
            authorName: "Lumen team",
            team: true,
          },
        ],
      }),
    ],
  });
  await ready(page);
  await page.getByRole("button", { name: /Comment 1 by Sarah Miller/ }).click();
  const thread = page.getByRole("dialog", { name: "Comment #1" });
  await expect(thread).toBeVisible();
  await expect(thread).toContainText("Can this headline be shorter?");
  await expect(thread).toContainText("copy update ships Friday");
  await expect(thread.locator(".chip.team")).toHaveText("Team");
  await thread.getByLabel("Reply", { exact: true }).fill("Great, thanks!");
  await thread.getByLabel("Reply", { exact: true }).press("Control+Enter");
  await expect(thread).toContainText("Great, thanks!");
  expect(mock.items[0]?.replies).toHaveLength(2);
  await shot(page, "05-thread");
  await page.keyboard.press("Escape");
  await expect(thread).toBeHidden();
});

test("resolve hides the pin; Show resolved brings it back", async ({ page }) => {
  const mock = await mockApi(page, {
    items: [seed({ number: 1, anchor: anchorFor("hero-title", "h1", HERO, { xPct: 50, yPct: 50 }) })],
  });
  await ready(page);
  await expect(pins(page)).toHaveCount(1);
  await pins(page).first().click();
  await page.getByRole("button", { name: "Resolve" }).click();
  await expect(page.locator("pinwren-root .toast")).toHaveText("Resolved #1");
  expect(mock.items[0]?.status).toBe("resolved");
  await expect(pins(page).first()).toBeHidden();

  await launcher(page).click();
  await page.getByRole("menuitem", { name: /View comments/ }).click();
  await expect(page.locator("pinwren-root .panel")).toContainText("No comments here");
  await page.getByRole("switch", { name: "Show resolved" }).click();
  await expect(pins(page).first()).toBeVisible();
  await expect(pins(page).first()).toHaveClass(/resolved/);
  expect(mock.requests.some((r) => r.path.includes("include=closed"))).toBe(true);
  await page.getByRole("button", { name: "Resolved", exact: true }).click();
  await expect(page.locator("pinwren-root .panel .item")).toHaveCount(1);
  await shot(page, "06-panel-resolved");

  // Reopen from the thread.
  await page.locator("pinwren-root .panel .item").click();
  await page.getByRole("button", { name: "Reopen" }).click();
  await expect.poll(() => mock.items[0]?.status).toBe("open");
});

test("resolve needs visitorsCanResolve or the reporter token", async ({ page }) => {
  const mock = await mockApi(page, {
    widget: { visitorsCanResolve: false },
    items: [
      seed({ number: 1, anchor: anchorFor("guji", "article", "Ethiopia Guji", { xPct: 50, yPct: 50 }) }),
    ],
  });
  await ready(page);
  await pins(page).first().click();
  await expect(page.getByRole("dialog", { name: "Comment #1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resolve" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // A comment this browser sent carries its token, so it can be resolved.
  await page.keyboard.press("c");
  await clickOn(page, "nyeri");
  await composer(page).getByLabel("Your comment").fill("Mine");
  await composer(page).getByRole("button", { name: "Send" }).click();
  await expect(page.locator("pinwren-root .toast")).toHaveText("#2 sent");
  await page.getByRole("button", { name: /Comment 2 by/ }).click();
  await page.getByRole("button", { name: "Resolve" }).click();
  await expect.poll(() => mock.items[1]?.status).toBe("resolved");
  const patch = mock.requests.find((r) => r.method === "PATCH");
  expect(patch?.headers["x-pinwren-reporter-token"]).toBe("tok_2");
});

test("right-click comments only when enabled, never on inputs/links/modifiers", async ({ page }) => {
  await mockApi(page, { widget: { rightClickComment: true } });
  await ready(page);
  const copy = await box(page.locator("#hero-copy"));
  await page.mouse.click(copy.x + 40, copy.y + 10, { button: "right" });
  await expect(composer(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(composer(page)).toBeHidden();

  for (const sel of ["#email", "#shop-link"]) {
    const b = await box(page.locator(sel));
    await page.mouse.click(b.x + 5, b.y + 5, { button: "right" });
  }
  await page.keyboard.down("Shift");
  await page.mouse.click(copy.x + 40, copy.y + 10, { button: "right" });
  await page.keyboard.up("Shift");
  // A keyboard-invoked context menu (no right-button press) is left alone too.
  await page
    .locator("#hero-copy")
    .dispatchEvent("contextmenu", { clientX: copy.x + 40, clientY: copy.y + 10 });
  await page.waitForTimeout(300);
  await expect(composer(page)).toHaveCount(0);
});

test("right-click does nothing when disabled", async ({ page }) => {
  await mockApi(page);
  await ready(page);
  const copy = await box(page.locator("#hero-copy"));
  await page.mouse.click(copy.x + 40, copy.y + 10, { button: "right" });
  await page.waitForTimeout(300);
  await expect(composer(page)).toHaveCount(0);
});

test("Esc leaves comment mode and discards a draft", async ({ page }) => {
  const mock = await mockApi(page);
  await ready(page);
  await page.keyboard.press("c");
  await expect(page.locator("pinwren-root .hint")).toBeVisible();
  const hb = await box(page.getByTestId("hero-title"));
  await page.mouse.move(hb.x + 40, hb.y + 20);
  await expect(page.locator("pinwren-root .outline")).toBeVisible();
  await shot(page, "07-comment-mode-hover");
  await page.keyboard.press("Escape");
  await expect(page.locator("pinwren-root .hint")).toHaveCount(0);
  await expect(page.locator("pinwren-root .shield")).toHaveCount(0);

  await page.keyboard.press("c");
  await clickOn(page, "hero-title");
  await expect(composer(page)).toBeVisible();
  await expect(page.locator("pinwren-root .pin.draft")).toBeVisible();
  await composer(page).getByLabel("Your comment").fill("half-written");
  await page.keyboard.press("Escape");
  await expect(composer(page)).toContainText("Press Esc again");
  await page.keyboard.press("Escape");
  await expect(composer(page)).toHaveCount(0);
  await expect(page.locator("pinwren-root .pin.draft")).toHaveCount(0);
  expect(mock.requests.filter((r) => r.method === "POST")).toHaveLength(0);
});

test("read-only hides every create, reply and resolve control", async ({ page }) => {
  await mockApi(page, {
    widget: { readOnly: true, rightClickComment: true },
    items: [seed({ number: 1, anchor: anchorFor("hero-title", "h1", HERO, { xPct: 50, yPct: 50 }) })],
  });
  await ready(page);
  await launcher(page).click();
  await expect(page.getByRole("menuitem", { name: /View comments/ })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Add a comment/ })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: /Report a bug/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("c");
  await expect(page.locator("pinwren-root .hint")).toHaveCount(0);
  const copy = await box(page.locator("#hero-copy"));
  await page.mouse.click(copy.x + 40, copy.y + 10, { button: "right" });
  await expect(composer(page)).toHaveCount(0);
  await pins(page).first().click();
  const thread = page.getByRole("dialog", { name: "Comment #1" });
  await expect(thread).toBeVisible();
  await expect(thread.getByLabel("Reply", { exact: true })).toHaveCount(0);
  await expect(thread.getByRole("button", { name: "Resolve" })).toHaveCount(0);
});

test("panel lists page comments; Mine and search filter them", async ({ page }) => {
  await mockApi(page, {
    items: [
      seed({
        number: 1,
        body: "Guji price looks off",
        anchor: anchorFor("guji", "article", "Ethiopia Guji", { xPct: 90, yPct: 10 }),
      }),
      seed({
        number: 2,
        kind: "idea",
        reporterName: "Dev Patel",
        body: "Add tasting notes icons",
        anchor: anchorFor("huila", "article", "Colombia Huila", { xPct: 90, yPct: 10 }),
      }),
      seed({
        number: 3,
        body: "Lost comment",
        anchor: anchorFor("gone", "div", "Nothing", { xPct: 1, yPct: 1 }),
      }),
    ],
  });
  await ready(page);
  await page.keyboard.press("c");
  await clickOn(page, "nyeri");
  await composer(page).getByLabel("Your comment").fill("Kenya card needs a photo");
  await composer(page).getByRole("button", { name: "Send" }).click();
  await expect(page.locator("pinwren-root .toast")).toHaveText("#4 sent");

  await launcher(page).click();
  await page.getByRole("menuitem", { name: /View comments/ }).click();
  const items = page.locator("pinwren-root .panel .item");
  await expect(items).toHaveCount(4);
  await expect(page.locator("pinwren-root .panel")).toContainText("Not on this version of the page");
  await shot(page, "08-panel");
  await page.getByRole("button", { name: "Mine", exact: true }).click();
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText("Kenya card needs a photo");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByLabel("Search comments").fill("tasting");
  await expect(items).toHaveCount(1);
  await items.first().click();
  await expect(page.getByRole("dialog", { name: "Idea #2" })).toBeVisible();
});

test("pins stay attached to their elements when the page re-lays out", async ({ page }) => {
  const region = { xPct: 10, yPct: 20, wPct: 50, hPct: 30 };
  await mockApi(page, {
    items: [
      seed({ number: 1, anchor: anchorFor("huila", "article", "Colombia Huila", region) }),
      seed({ number: 2, anchor: anchorFor("hero-title", "h1", HERO, { xPct: 25, yPct: 50 }) }),
    ],
  });
  await ready(page);
  await expect(pins(page)).toHaveCount(2);
  for (const width of [1280, 600, 980]) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(150);
    const el = await box(page.getByTestId("huila"));
    const area = await box(page.locator("pinwren-root .area"));
    near(area.x, el.x + 0.1 * el.width);
    near(area.y, el.y + 0.2 * el.height);
    near(area.width, 0.5 * el.width);
    near(area.height, 0.3 * el.height);
    const h1 = await box(page.getByTestId("hero-title"));
    const marker = await box(page.getByRole("button", { name: /Comment 2 by/ }));
    // The point pin's tail (bottom-left corner) sits on the pinned point.
    near(marker.x, h1.x + 0.25 * h1.width, 3);
    near(marker.y + marker.height, h1.y + 0.5 * h1.height, 3);
    if (width === 600) await shot(page, "09-relayout-600");
  }
});

test("widget CSS survives a hostile page stylesheet", async ({ page }) => {
  await mockApi(page, {
    items: [
      seed({
        number: 1,
        anchor: anchorFor("hero-title", "h1", HERO, { xPct: 10, yPct: 10, wPct: 60, hPct: 80 }),
      }),
    ],
  });
  await ready(page, "/?hostile=1");
  await expect(launcher(page)).toBeVisible();
  const style = await launcher(page).evaluate((el) => {
    const s = getComputedStyle(el);
    return { position: s.position, width: s.width, radius: s.borderRadius, bg: s.backgroundColor };
  });
  expect(style).toEqual({ position: "fixed", width: "52px", radius: "999px", bg: "rgb(91, 91, 214)" });
  await launcher(page).click();
  await expect(page.getByRole("menuitem", { name: /Add a comment/ })).toBeVisible();
  const item = await page
    .getByRole("menuitem", { name: /Add a comment/ })
    .evaluate((el) => getComputedStyle(el).display);
  expect(item).toBe("flex");
  await shot(page, "10-hostile-css");
});

test("deep link ?pinwren=<id> opens that thread", async ({ page }) => {
  await mockApi(page, {
    items: [
      seed({
        number: 7,
        body: "Linked comment",
        anchor: anchorFor("nyeri", "article", "Kenya Nyeri", { xPct: 50, yPct: 50 }),
      }),
    ],
  });
  await ready(page, "/?pinwren=fb_7");
  await expect(page.getByRole("dialog", { name: "Comment #7" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Comment #7" })).toContainText("Linked comment");
});

test("JS API: open, on, identify, close, destroy", async ({ page }) => {
  await mockApi(page);
  await ready(page);
  await page.evaluate(() => {
    const w = window as unknown as {
      Pinwren: {
        on(e: string, cb: (d: unknown) => void): void;
        identify(u: object): void;
        open(m?: string): void;
      };
      events: string[];
    };
    w.events = [];
    for (const e of ["open", "close", "submit", "error"]) w.Pinwren.on(e, () => w.events.push(e));
    w.Pinwren.identify({ name: "Ada Lovelace", email: "ada@example.com" });
    w.Pinwren.open("comment");
  });
  await expect(page.locator("pinwren-root .hint")).toBeVisible();
  await clickOn(page, "guji");
  await expect(composer(page)).toContainText("Posting as Ada Lovelace");
  await composer(page).getByLabel("Your comment").fill("From the API");
  await composer(page).getByRole("button", { name: "Send" }).click();
  await expect(page.locator("pinwren-root .toast")).toHaveText("#1 sent");
  const events = await page.evaluate(() => (window as unknown as { events: string[] }).events);
  expect(events).toEqual(["open", "submit", "close"]);
  await page.evaluate(() =>
    (window as unknown as { Pinwren: { open(m: string): void } }).Pinwren.open("panel"),
  );
  await expect(page.locator("pinwren-root .panel")).toBeVisible();
  await page.evaluate(() => (window as unknown as { Pinwren: { close(): void } }).Pinwren.close());
  await expect(page.locator("pinwren-root .panel")).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { Pinwren: { destroy(): void } }).Pinwren.destroy());
  await expect(page.locator("pinwren-root")).toHaveCount(0);
});

test("consent notice shows once, with the privacy link", async ({ page }) => {
  await mockApi(page, {
    widget: { consent: { enabled: true, text: null, privacyUrl: "https://lumen.example/privacy" } },
  });
  await ready(page);
  await page.keyboard.press("c");
  await clickOn(page, "guji");
  const c = composer(page);
  await expect(c).toContainText("Sending shares your comment");
  await expect(c.getByRole("link", { name: "Privacy policy" })).toHaveAttribute(
    "href",
    "https://lumen.example/privacy",
  );
  await c.getByLabel("Your comment").fill("ok");
  await c.getByRole("button", { name: "Agree & send" }).click();
  await expect(page.locator("pinwren-root .toast")).toHaveText("#1 sent");
  await page.keyboard.press("c");
  await clickOn(page, "huila");
  await expect(composer(page)).not.toContainText("Sending shares your comment");
  await expect(composer(page).getByRole("button", { name: "Send", exact: true })).toBeVisible();
});

test("launcher config: pill, position, accent, hidden, modes", async ({ page }) => {
  await mockApi(page, {
    widget: {
      launcher: {
        shape: "pill",
        label: "Comments",
        position: "top-left",
        accent: "#e11d48",
        offset: { x: 24, y: 16 },
      },
      modes: { comment: true, bug: false },
    },
  });
  await ready(page);
  await expect(launcher(page)).toHaveText(/Comments/);
  const b = await box(launcher(page));
  near(b.x, 24);
  near(b.y, 16);
  expect(await launcher(page).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    "rgb(225, 29, 72)",
  );
  await launcher(page).click();
  await expect(page.getByRole("menuitem", { name: /Report a bug/ })).toHaveCount(0);
  await shot(page, "11-pill-launcher");
});

test("hidden launcher still opens via shortcut", async ({ page }) => {
  await mockApi(page, { widget: { launcher: { hidden: true } } });
  await ready(page);
  await expect.poll(() => page.locator("pinwren-root .launcher").count()).toBe(0);
  await page.waitForTimeout(200);
  await page.keyboard.press("c");
  await expect(page.locator("pinwren-root .hint")).toBeVisible();
});

test("small screens get a bottom-sheet composer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await mockApi(page, {
    items: [
      seed({
        number: 1,
        kind: "bug",
        anchor: anchorFor("hero-title", "h1", HERO, { xPct: 5, yPct: 5, wPct: 90, hPct: 90 }),
      }),
    ],
  });
  await ready(page);
  await launcher(page).click();
  await page.getByRole("menuitem", { name: /Add a comment/ }).click();
  await clickOn(page, "hero-title");
  await expect(composer(page)).toHaveClass(/sheet/);
  // Wait out the slide-up animation before measuring.
  await expect
    .poll(async () => Math.round((await box(composer(page))).y + (await box(composer(page))).height))
    .toBe(780);
  near((await box(composer(page))).x, 0);
  await shot(page, "12-mobile-sheet");
});

test("dark mode thread and panel", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await mockApi(page, {
    items: [
      seed({
        number: 3,
        kind: "bug",
        body: "Price wraps onto two lines on narrow cards.",
        anchor: anchorFor("guji", "article", "Ethiopia Guji", { xPct: 4, yPct: 55, wPct: 70, hPct: 30 }),
      }),
    ],
  });
  await ready(page);
  await pins(page).first().click();
  await expect(page.getByRole("dialog", { name: "Bug #3" })).toBeVisible();
  await shot(page, "13-dark-thread");
});

test("SPA navigation reloads pins for the new URL", async ({ page }) => {
  const mock = await mockApi(page);
  await ready(page);
  await expect.poll(() => mock.requests.filter((r) => r.path.startsWith("/feedback?")).length).toBe(1);
  await page.evaluate(() => {
    history.pushState({}, "", "/shop");
    document.body.append(document.createElement("div"));
  });
  await expect
    .poll(() => mock.requests.filter((r) => r.path.startsWith("/feedback?")).at(-1)?.path ?? "")
    .toContain(encodeURIComponent("http://localhost:5180/shop"));
});
