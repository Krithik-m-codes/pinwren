import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { mockApi } from "./mock";

// Wave 4 (docs/contracts/wave-4.md): hashed chunks + manifest (§7), the editor split out of capture, session
// replay (§3), signed identity / page scope / visibility rules (§4) and the consent record (§6).

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const launcher = (page: Page) => page.locator("pinwren-root .launcher");
const composer = (page: Page) => page.getByRole("dialog", { name: "New comment" });
const report = (page: Page) => page.getByRole("dialog", { name: "Report a bug" });
const canvas = (page: Page) => page.locator("pinwren-root .ed canvas");
const toast = (page: Page) => page.locator("pinwren-root .toast").last();
const SIG = "3f".repeat(32);

type Manifest = {
  entry: string;
  chunks: Record<string, string>;
  files: Record<string, { raw: number; gzip: number; brotli: number }>;
};
const manifest = async () => JSON.parse(await readFile(`${DIST}manifest.json`, "utf8")) as Manifest;

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error("element has no box");
  return b;
}

async function ready(page: Page, url = "/") {
  await page.goto(url);
  await expect(launcher(page)).toBeVisible();
}

async function clickOn(page: Page, testId: string) {
  const b = await box(page.getByTestId(testId));
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

async function sendComment(page: Page, testId: string, text: string) {
  await page.keyboard.press("c");
  await clickOn(page, testId);
  await composer(page).getByLabel("Your comment").fill(text);
  await composer(page).getByRole("button", { name: /Send/ }).click();
}

async function openReport(page: Page) {
  await launcher(page).click();
  await page.getByRole("menuitem", { name: /Report a bug/ }).click();
  await expect(report(page)).toBeVisible();
}

/** Serve the fixture (and the widget files) as if it were the site at `origin`. */
async function serveAs(page: Page, origin: string) {
  await page.route(`${origin}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const res = await route.fetch({ url: `http://localhost:5180${path}` });
    await route.fulfill({ response: res });
  });
}

// --- §7 chunks ----------------------------------------------------------------------------------

test("hashed chunks: the manifest in widget.js names every file, within the size budgets", async ({
  page,
}) => {
  const m = await manifest();
  const core = await readFile(`${DIST}widget.js`, "utf8");
  expect(Object.keys(m.chunks).sort()).toEqual(
    [
      "capture",
      "editor",
      "flows",
      "panel",
      "replay",
      "report",
      ...["de", "es", "fr", "hi", "it", "ja", "nl", "pt-BR", "ru", "zh"].map((c) => `i18n-${c}`),
    ].sort(),
  );
  for (const file of Object.values(m.chunks)) {
    expect(file).toMatch(/^widget-[\w-]+\.[0-9a-f]{10}\.js$/);
    expect(core).toContain(file);
    expect(m.files[file]?.gzip).toBeGreaterThan(0);
  }
  const gz = (key: string) =>
    (key === "widget" ? m.files["widget.js"] : m.files[m.chunks[key] ?? ""])?.gzip ?? 0;
  expect(gz("widget")).toBeLessThanOrEqual(35 * 1024); // blueprint 05 §2: the speed dial and markers grew the core (wave 5)
  expect(gz("panel")).toBeLessThanOrEqual(15 * 1024);
  expect(gz("report")).toBeLessThanOrEqual(15 * 1024);
  expect(gz("editor")).toBeLessThanOrEqual(30 * 1024);
  expect(gz("replay")).toBeLessThanOrEqual(60 * 1024);
  expect(gz("flows")).toBeLessThanOrEqual(10 * 1024);
  // SnapDOM alone is ~88 KB gzip; this guards against the editor (or anything else) creeping back in.
  expect(gz("capture")).toBeLessThanOrEqual(92 * 1024);
  // The editor lives only in its own chunk.
  const capture = await readFile(`${DIST}${m.chunks.capture ?? ""}`, "utf8");
  expect(capture).not.toContain("__pinwrenEditor");
  expect(await readFile(`${DIST}${m.chunks.editor ?? ""}`, "utf8")).toContain("__pinwrenEditor");

  await mockApi(page);
  const requested: string[] = [];
  page.on("request", (r) => requested.push(new URL(r.url()).pathname));
  await ready(page);
  await launcher(page).hover();
  await expect.poll(() => requested).toContain(`/${m.chunks.panel ?? ""}`);
  // Only hashed chunk names are ever requested.
  expect(requested.filter((p) => p.startsWith("/widget-")).every((p) => /\.[0-9a-f]{10}\.js$/.test(p))).toBe(
    true,
  );
});

test("a bug report loads the report, capture and editor chunks; a missing editor falls back cleanly", async ({
  page,
}) => {
  const m = await manifest();
  await mockApi(page);
  const requested: string[] = [];
  page.on("request", (r) => requested.push(new URL(r.url()).pathname));
  await ready(page);
  expect(requested.some((p) => p.startsWith("/widget-editor."))).toBe(false);
  await openReport(page);
  await expect(canvas(page)).toBeVisible();
  for (const k of ["report", "capture", "editor"]) expect(requested).toContain(`/${m.chunks[k] ?? ""}`);
  expect(requested.some((p) => p.startsWith("/widget-replay."))).toBe(false); // replay is off by default
  await page.keyboard.press("Escape");

  // Second page: the editor chunk can't be fetched — the report still opens and can be sent without it.
  const p2 = await page.context().newPage();
  const mock2 = await mockApi(p2);
  await p2.route("**/widget-editor.*.js", (r) => r.abort());
  await ready(p2);
  await openReport(p2);
  await expect(report(p2)).toContainText("We couldn't capture this page");
  await report(p2)
    .getByRole("button", { name: /Send without/ })
    .click();
  await report(p2).getByLabel("Describe the bug").fill("No editor");
  await report(p2).getByRole("button", { name: "Send report" }).click();
  await expect(toast(p2)).toContainText("#1 sent");
  expect(mock2.items[0]?.payload?.screenshot).toBeUndefined();
});

// --- §3 session replay --------------------------------------------------------------------------

type Ev = { type: number; timestamp: number; data?: unknown };
function decodeReplay(dataUrl: string): Ev[] {
  expect(dataUrl).toMatch(/^data:application\/gzip;base64,/);
  const gz = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  return JSON.parse(gunzipSync(gz).toString("utf8")) as Ev[];
}

test("session replay: recorded on idle, inputs masked, attached to the bug report as gzip", async ({
  page,
}) => {
  const mock = await mockApi(page, { capture: { replay: { enabled: true, seconds: 30 } } });
  const requested: string[] = [];
  page.on("request", (r) => requested.push(new URL(r.url()).pathname));
  await ready(page);
  await expect.poll(() => requested.some((p) => /^\/widget-replay\.[0-9a-f]{10}\.js$/.test(p))).toBe(true);
  await page.getByLabel("Newsletter email").fill("secret-visitor@example.com");
  await page.mouse.move(200, 300);
  await page.mouse.move(600, 400, { steps: 5 });
  await page.evaluate(() => {
    const p = document.createElement("p");
    p.textContent = "Added after load";
    document.body.append(p);
  });
  await openReport(page);
  const row = report(page).locator(".summary li", { hasText: "Session replay" });
  await expect(row).toContainText("last 30 s");
  await expect(row.getByRole("switch", { name: "Include the session replay" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await report(page).getByLabel("Describe the bug").fill("With replay");
  await report(page).getByRole("button", { name: "Send report" }).click();
  await expect(toast(page)).toContainText("#1 sent");

  const replay = mock.items[0]?.payload?.replay as { dataUrl: string; durationMs: number; events: number };
  const events = decodeReplay(replay.dataUrl);
  expect(events.length).toBe(replay.events);
  expect(events[0]?.type).toBe(4); // Meta, then the full snapshot
  expect(events[1]?.type).toBe(2);
  expect(replay.durationMs).toBeGreaterThan(0);
  const json = JSON.stringify(events);
  expect(json).toContain("Added after load");
  expect(json).not.toContain("secret-visitor@example.com"); // maskAllInputs
  // The widget itself is blocked: rrweb keeps only an empty, sized placeholder for it.
  expect(json).toMatch(
    /"tagName":"pinwren-root","attributes":\{"rr_width":"[\d.]+px","rr_height":"[\d.]+px"\},"childNodes":\[\]/,
  );
});

test("the reporter can leave the replay out; privacy mode keeps replay off unless the site allows it", async ({
  page,
}) => {
  const mock = await mockApi(page, { capture: { replay: { enabled: true } } });
  await ready(page);
  await expect.poll(() => page.evaluate(() => "__pinwrenReplay" in window)).toBe(true);
  await page.mouse.move(300, 300, { steps: 3 });
  await openReport(page);
  await report(page).getByRole("switch", { name: "Include the session replay" }).click();
  await expect(report(page).locator(".summary li", { hasText: "Session replay" })).toHaveClass(/off/);
  await report(page).getByLabel("Describe the bug").fill("Without replay");
  await report(page).getByRole("button", { name: "Send report" }).click();
  await expect(toast(page)).toContainText("#1 sent");
  expect(mock.items[0]?.payload?.replay).toBeUndefined();

  const priv = await page.context().newPage();
  await mockApi(priv, { widget: { privacyMode: true }, capture: { replay: { enabled: true } } });
  const requested: string[] = [];
  priv.on("request", (r) => requested.push(new URL(r.url()).pathname));
  await ready(priv);
  await priv.waitForTimeout(1500);
  expect(requested.some((p) => p.startsWith("/widget-replay."))).toBe(false);

  const allowed = await page.context().newPage();
  const mock3 = await mockApi(allowed, {
    widget: { privacyMode: true },
    capture: { replay: { enabled: true } },
  });
  await ready(allowed, "/?allowReplay");
  await expect.poll(() => allowed.evaluate(() => "__pinwrenReplay" in window)).toBe(true);
  await allowed.getByTestId("hero-title").hover();
  await openReport(allowed);
  await report(allowed).getByLabel("Describe the bug").fill("Privacy replay");
  await report(allowed).getByRole("button", { name: "Send report" }).click();
  await expect(toast(allowed)).toContainText("#1 sent");
  const r = mock3.items[0]?.payload?.replay as { dataUrl: string };
  // Privacy mode masks all text, not just inputs.
  expect(JSON.stringify(decodeReplay(r.dataUrl))).not.toContain("Small-batch coffee");
});

test("destroy() stops the replay recorder", async ({ page }) => {
  await mockApi(page, { capture: { replay: { enabled: true } } });
  // Count stop() calls on the recorder the widget starts.
  await page.route("**/widget-replay.*.js", async (route) => {
    const res = await route.fetch();
    const body = `${await res.text()}
;(() => { const m = window.__pinwrenReplay, start = m.startReplay; window.__stops = 0;
  m.startReplay = (o) => { const r = start(o); const stop = r.stop; r.stop = () => { window.__stops++; stop(); }; window.__rec = r; return r; }; })();`;
    await route.fulfill({ response: res, body });
  });
  await ready(page);
  await expect.poll(() => page.evaluate(() => "__rec" in window)).toBe(true);
  expect(
    await page.evaluate(() => (window as unknown as { __rec: { freeze(): unknown } }).__rec.freeze()),
  ).not.toBeNull();
  await page.evaluate(() => (window as unknown as { Pinwren: { destroy(): void } }).Pinwren.destroy());
  expect(await page.evaluate(() => (window as unknown as { __stops: number }).__stops)).toBe(1);
  expect(
    await page.evaluate(() => (window as unknown as { __rec: { freeze(): unknown } }).__rec.freeze()),
  ).toBeNull();
  await expect(page.locator("pinwren-root")).toHaveCount(0);
});

// --- §4 identity, page scope, visibility --------------------------------------------------------

test("identify() with a signature is sent as a verified reporter on reports and replies", async ({
  page,
}) => {
  const mock = await mockApi(page);
  await ready(page);
  await page.evaluate(
    (sig) =>
      (window as unknown as { Pinwren: { identify(u: unknown, o: unknown): void } }).Pinwren.identify(
        { id: "user_42", name: "Maria Lopez", email: "maria@example.com" },
        { signature: sig },
      ),
    SIG,
  );
  await sendComment(page, "guji", "Signed comment");
  await expect(toast(page)).toHaveText("#1 sent");
  expect(mock.items[0]?.payload?.reporter).toEqual({
    name: "Maria Lopez",
    email: "maria@example.com",
    externalId: "user_42",
    signature: SIG,
  });

  // A bad signature is dropped (the id still goes); a reply carries the identity too.
  await page.evaluate(() =>
    (window as unknown as { Pinwren: { identify(u: unknown, o: unknown): void } }).Pinwren.identify(
      { id: "user_42", name: "Maria Lopez" },
      { signature: "nope" },
    ),
  );
  await page.locator("pinwren-root .pin:not(.draft)").first().click();
  const thread = page.locator("pinwren-root .card.thread");
  await thread.getByRole("textbox", { name: "Reply" }).fill("Signed reply?");
  await thread.getByRole("button", { name: "Send reply" }).click();
  await expect(thread).toContainText("Signed reply?");
  const replyReq = mock.requests.find((r) => r.method === "POST" && r.path.endsWith("/comments"));
  expect((replyReq?.body as { author: unknown }).author).toEqual({
    name: "Maria Lopez",
    email: "maria@example.com",
    externalId: "user_42",
  });
});

test("page scope from data-url-pattern and setPageScope(): pins listed and feedback sent by pattern", async ({
  page,
}) => {
  const mock = await mockApi(page);
  await ready(page, "/?urlPattern=/coffee/:slug");
  const pinsReq = () => mock.requests.filter((r) => r.method === "GET" && r.path.startsWith("/feedback?"));
  expect(new URL(`http://x${pinsReq()[0]?.path ?? ""}`).searchParams.get("urlPattern")).toBe("/coffee/:slug");
  await sendComment(page, "guji", "Scoped");
  await expect(toast(page)).toHaveText("#1 sent");
  expect((mock.items[0]?.payload?.page as { urlPattern?: string }).urlPattern).toBe("/coffee/:slug");

  const before = pinsReq().length;
  await page.evaluate(() =>
    (window as unknown as { Pinwren: { setPageScope(s: unknown): void } }).Pinwren.setPageScope({
      urlPattern: "/shop/*",
    }),
  );
  await expect.poll(() => pinsReq().length).toBe(before + 1);
  const scoped = (path = "") => new URL(`http://x${path}`).searchParams.get("urlPattern");
  expect(scoped(pinsReq().at(-1)?.path)).toBe("/shop/*");
  await page.evaluate(() =>
    (window as unknown as { Pinwren: { setPageScope(s: unknown): void } }).Pinwren.setPageScope(null),
  );
  await expect.poll(() => pinsReq().length).toBe(before + 2);
  expect(scoped(pinsReq().at(-1)?.path)).toBeNull();
  await sendComment(page, "huila", "Unscoped");
  await expect(toast(page)).toHaveText("#2 sent");
  expect((mock.items[1]?.payload?.page as { urlPattern?: string }).urlPattern).toBeUndefined();
});

test("visibility: non-production shows on localhost, hides on a production host unless forced", async ({
  page,
}) => {
  const widget = { visibility: { environments: "non-production" as const } };
  await mockApi(page, { widget });
  await ready(page); // localhost
  const shop = await page.context().newPage();
  await mockApi(shop, { widget });
  await serveAs(shop, "http://shop.lumen.example");
  const configLoaded = shop.waitForResponse((r) => r.url().endsWith("/w/config"));
  await shop.goto("http://shop.lumen.example/");
  await configLoaded;
  await expect(shop.locator("pinwren-root")).toHaveCount(0);
  await shop.keyboard.press("c");
  await expect(shop.locator("pinwren-root")).toHaveCount(0);

  const forced = await page.context().newPage();
  await mockApi(forced, { widget });
  await serveAs(forced, "http://shop.lumen.example");
  await forced.goto("http://shop.lumen.example/?forceShow");
  await expect(launcher(forced)).toBeVisible();

  const staging = await page.context().newPage();
  await mockApi(staging, { widget });
  await serveAs(staging, "http://staging.lumen.example");
  await staging.goto("http://staging.lumen.example/");
  await expect(launcher(staging)).toBeVisible();
});

test("visibility: hidden below minViewportWidth, back when the window grows; forceShow via init", async ({
  page,
}) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await mockApi(page, { widget: { visibility: { minViewportWidth: 768 } } });
  const configLoaded = page.waitForResponse((r) => r.url().endsWith("/w/config"));
  await page.goto("/");
  await configLoaded;
  await expect(launcher(page)).toBeHidden();
  await page.keyboard.press("c");
  await expect(page.locator("pinwren-root .hint")).toHaveCount(0);
  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(launcher(page)).toBeVisible();
  await page.keyboard.press("c");
  await expect(page.locator("pinwren-root .hint")).toBeVisible();
  await page.setViewportSize({ width: 500, height: 800 });
  await expect(launcher(page)).toBeHidden();
  await expect(page.locator("pinwren-root .hint")).toHaveCount(0); // comment mode was closed

  const forced = await page.context().newPage();
  await forced.setViewportSize({ width: 500, height: 800 });
  await mockApi(forced, {
    widget: { visibility: { minViewportWidth: 768, environments: "non-production" } },
  });
  await forced.goto("/?noAuto");
  await forced.evaluate(() => {
    const s = document.createElement("script");
    s.src = "/widget.js";
    s.onload = () =>
      (window as unknown as { Pinwren: { init(o: unknown): void } }).Pinwren.init({
        projectKey: "pk_test",
        endpoint: "http://localhost:5180",
        forceShow: true,
      });
    document.body.append(s);
  });
  await expect(launcher(forced)).toBeVisible();
});

// --- §6 consent ---------------------------------------------------------------------------------

test("consent record: version + acceptedAt sent once accepted, and on every later submission", async ({
  page,
}) => {
  const mock = await mockApi(page, {
    widget: { consent: { enabled: true, text: "We send your comment.", privacyUrl: null } },
  });
  await ready(page);
  await page.keyboard.press("c");
  await clickOn(page, "guji");
  await composer(page).getByLabel("Your comment").fill("First");
  await composer(page).getByRole("button", { name: "Agree & send" }).click();
  await expect(toast(page)).toHaveText("#1 sent");
  const c1 = mock.items[0]?.payload?.consent as { version: string; acceptedAt: string };
  expect(c1.version).toMatch(/^1-[0-9a-f]{8}$/);
  expect(Date.now() - Date.parse(c1.acceptedAt)).toBeLessThan(60_000);

  await openReport(page);
  await expect(report(page)).not.toContainText("We send your comment.");
  await report(page).getByLabel("Describe the bug").fill("Second");
  await report(page).getByRole("button", { name: "Send report" }).click();
  await expect(toast(page)).toContainText("#2 sent");
  expect(mock.items[1]?.payload?.consent).toEqual(c1);
});

test("no consent field without a consent notice", async ({ page }) => {
  const mock = await mockApi(page);
  await ready(page);
  await sendComment(page, "guji", "No notice");
  await expect(toast(page)).toHaveText("#1 sent");
  expect(mock.items[0]?.payload).not.toHaveProperty("consent");
});
