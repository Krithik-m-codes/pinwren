import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { build } from "esbuild";

const ORIGIN = "http://react.test";
const WIDGET_DIST = fileURLToPath(new URL("../../widget/dist/", import.meta.url));
const SIG = "5a".repeat(32);

let bundle = "";
test.beforeAll(async () => {
  const r = await build({
    entryPoints: [fileURLToPath(new URL("./fixture/app.tsx", import.meta.url))],
    bundle: true,
    format: "esm",
    jsx: "automatic",
    write: false,
    define: { "process.env.NODE_ENV": '"development"' },
    logLevel: "warning",
  });
  bundle = r.outputFiles[0]?.text ?? "";
});

const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>React fixture</title></head>
<body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`;

/** Serve the app, the built widget and a minimal /w API on ORIGIN; returns the feedback POST bodies. */
async function serve(page: Page) {
  const posts: Record<string, unknown>[] = [];
  const gets: string[] = [];
  // Look inside the widget's closed shadow root.
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- re-invoked with the element as `this`
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init: ShadowRootInit) {
      return attach.call(this, { ...init, mode: "open" });
    };
  });
  await page.route(`${ORIGIN}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/") return route.fulfill({ contentType: "text/html", body: HTML });
    if (path === "/app.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (/^\/widget[\w.-]*\.js$/.test(path))
      return route.fulfill({
        contentType: "text/javascript",
        body: await readFile(`${WIDGET_DIST}${path.slice(1)}`),
      });
    if (path === "/w/config")
      return json(200, {
        project: { name: "Acme", slug: "acme", publicRead: true },
        widget: {},
        capture: {},
      });
    if (path === "/w/feedback" && req.method() === "GET") {
      gets.push(url.search);
      return json(200, { items: [] });
    }
    if (path === "/w/feedback" && req.method() === "POST") {
      posts.push(JSON.parse(req.postData() ?? "{}") as Record<string, unknown>);
      return json(201, { feedback: { id: `fb_${posts.length}`, number: posts.length, reporterToken: "t" } });
    }
    return json(404, { title: "Not found" });
  });
  return { posts, gets };
}

test("<Pinwren> in a React app: loads widget.js, identifies the user, opens from usePinwren(), unmounts cleanly", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const api = await serve(page);
  await page.goto(`${ORIGIN}/`);

  // ready flips usePinwren().ready; StrictMode's double mount leaves exactly one widget.
  const help = page.getByRole("button", { name: "Report a problem" });
  await expect(help).toBeEnabled();
  await expect(page.locator("pinwren-root")).toHaveCount(1);
  await expect(page.locator("pinwren-root .launcher")).toBeVisible();
  expect(new URLSearchParams(api.gets.at(-1)).get("urlPattern")).toBe("/dashboard/:id");

  await help.click();
  const report = page.getByRole("dialog", { name: "Report a bug" });
  await expect(report).toBeVisible();
  await expect(report.locator(".who")).toContainText("Ada Lovelace"); // pre-filled from `user`
  await report.getByLabel("Describe the bug").fill("Chart doesn't load");
  await report.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText("Thanks for report #1")).toBeVisible(); // onSubmit prop
  expect(api.posts[0]?.reporter).toEqual({
    name: "Ada Lovelace",
    email: "ada@example.com",
    externalId: "user_7",
    signature: SIG,
  });
  expect((api.posts[0]?.page as { urlPattern?: string }).urlPattern).toBe("/dashboard/:id");

  await page.getByRole("button", { name: "Remove widget" }).click();
  await expect(page.locator("pinwren-root")).toHaveCount(0);
  await page.getByRole("button", { name: "Add widget" }).click();
  await expect(page.locator("pinwren-root .launcher")).toBeVisible();
  expect(errors).toEqual([]);
  // widget.js was added once, from the endpoint.
  expect(await page.locator("script[data-pinwren-loader]").count()).toBe(1);
});
