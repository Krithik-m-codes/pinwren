import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type FullConfig, request } from "@playwright/test";
import { ADMIN, AUTH_DIR, SEED_FILE, type Seed, SITE_ORIGIN, STATE_FILE } from "./env";

/** A small fake marketing site — rendered once to get a real screenshot and real element boxes. */
const SITE_HTML = `<!doctype html><html><head><style>
  *{box-sizing:border-box;margin:0;font-family:Inter,system-ui,sans-serif}
  body{background:#fafafa;color:#18181b}
  header{display:flex;justify-content:space-between;align-items:center;padding:20px 64px;background:#fff;border-bottom:1px solid #e4e4e7}
  header b{font-size:20px} nav a{margin-left:28px;color:#52525b;text-decoration:none;font-size:15px}
  .hero{text-align:center;padding:64px 0 40px} .hero h1{font-size:44px;letter-spacing:-.02em} .hero p{margin-top:12px;color:#71717a;font-size:18px}
  .plans{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;padding:0 120px}
  .plan{background:#fff;border:1px solid #e4e4e7;border-radius:14px;padding:28px;height:330px}
  .plan h2{font-size:18px} .price{font-size:40px;font-weight:700;margin:14px 0} .plan li{color:#52525b;margin:8px 0 0 18px}
  .plan button{margin-top:26px;width:100%;height:44px;border:0;border-radius:10px;background:#18181b;color:#fff;font-size:15px}
  .pro{border:2px solid #5b5bd6} .pro button{background:#5b5bd6}
</style></head><body>
  <header><b>Acme</b><nav><a>Product</a><a>Pricing</a><a>Docs</a><a>Sign in</a></nav></header>
  <section class="hero"><h1 id="headline">Simple pricing for every team</h1><p>Start free. Upgrade when you grow.</p></section>
  <section class="plans">
    <div class="plan"><h2>Starter</h2><div class="price">$0</div><ul><li>1 project</li><li>Community support</li></ul><button id="start-free">Start free</button></div>
    <div class="plan pro" id="pro"><h2>Pro</h2><div class="price">$29</div><ul><li>Unlimited projects</li><li>Session replay</li><li>Email support</li></ul><button id="start-trial">Start trial</button></div>
    <div class="plan"><h2>Enterprise</h2><div class="price">Custom</div><ul><li>SSO &amp; SCIM</li><li>Audit log</li></ul><button id="contact">Contact sales</button></div>
  </section>
</body></html>`;

type Box = { x: number; y: number; w: number; h: number; vw: number; vh: number; scrollY: number };

function anchor(
  sel: string,
  tag: string,
  text: string,
  box: Box,
  pin: { xPct: number; yPct: number; wPct?: number; hPct?: number },
) {
  return {
    v: 1,
    css: sel,
    xpath: `//*[@id="${sel.replace("#", "")}"]`,
    text: { content: text, prefix: "", suffix: "" },
    tag,
    structure: { depth: 4, siblingIndex: 1, childTagsHash: "e2e" },
    rect: box,
    pin,
    attrs: { id: sel.replace("#", "") },
  };
}

const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const tinyPdf = `data:application/pdf;base64,${Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
).toString("base64")}`;

export default async function seed(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL ?? "http://localhost:3100";
  mkdirSync(AUTH_DIR, { recursive: true });

  // 1. Real screenshot + element boxes of the fake page at 1280×800.
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.setContent(SITE_HTML);
  const boxes = await page.evaluate(() => {
    const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
    for (const id of ["headline", "pro", "start-trial", "start-free"]) {
      const r = document.getElementById(id)?.getBoundingClientRect();
      if (r) out[id] = { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
    }
    return out;
  });
  const shot = `data:image/png;base64,${(await page.screenshot({ type: "png" })).toString("base64")}`;
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileShot = `data:image/png;base64,${(await page.screenshot({ type: "png" })).toString("base64")}`;
  await browser.close();
  const at = (id: string): Box => {
    const b = boxes[id];
    if (!b) throw new Error(`no box for ${id}`);
    return { ...b, vw: 1280, vh: 800, scrollY: 0 };
  };

  // 2. Admin session, a fresh workspace and project.
  const api = await request.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL } });
  let res = await api.post("/api/auth/sign-up/email", { data: ADMIN });
  if (!res.ok()) {
    res = await api.post("/api/auth/sign-in/email", {
      data: { email: ADMIN.email, password: ADMIN.password },
    });
    if (!res.ok()) throw new Error(`sign-in failed: ${res.status()} ${await res.text()}`);
  }
  const stamp = Date.now().toString(36);
  res = await api.post("/api/auth/organization/create", {
    data: { name: "Acme Studio", slug: `acme-e2e-${stamp}` },
  });
  if (!res.ok()) throw new Error(`org create failed: ${await res.text()}`);
  const org = (await res.json()) as { id: string };
  await api.post("/api/auth/organization/set-active", { data: { organizationId: org.id } });
  res = await api.post("/api/projects", {
    data: { name: "Marketing site", allowedOrigins: [new URL(SITE_ORIGIN).host] },
  });
  if (!res.ok()) throw new Error(`project create failed: ${await res.text()}`);
  const { project } = (await res.json()) as { project: { id: string; publicKey: string } };
  // A second project so the notification matrix and webhook scope have more than one row.
  await api.post("/api/projects", { data: { name: "Docs", allowedOrigins: [] } });
  // Screenshots on comments, so the page review has captures.
  await api.patch(`/api/projects/${project.id}`, { data: { captureConfig: { screenshotOnComment: true } } });

  // 3. Feedback through the public widget API, as the widget would send it.
  const env = (vw: number, vh: number) => ({
    userAgent: "Mozilla/5.0 (e2e) Chrome/140",
    browser: "Chrome 140",
    os: "Windows 11",
    viewport: { w: vw, h: vh },
    dpr: 1,
    locale: "en-GB",
    timezone: "Europe/London",
  });
  const post = async (body: Record<string, unknown>) => {
    const r = await api.post("/w/feedback", {
      headers: { "x-pinwren-key": project.publicKey, origin: SITE_ORIGIN },
      data: { clientId: randomUUID(), ...body },
    });
    if (!r.ok()) throw new Error(`widget post failed: ${r.status()} ${await r.text()}`);
    return ((await r.json()) as { feedback: { id: string; number: number } }).feedback;
  };
  const pricing = `${SITE_ORIGIN}/pricing`;
  const pro = at("pro");
  const region = await post({
    kind: "comment",
    body: "The Pro card feels cramped — the feature list needs more breathing room.",
    page: { url: pricing, title: "Pricing · Acme" },
    anchor: anchor("#pro", "div", "Pro $29", pro, { xPct: 8, yPct: 30, wPct: 84, hPct: 42 }),
    environment: env(1280, 800),
    reporter: { name: "Dana Reviewer", email: "dana@client.example" },
    screenshot: shot,
  });
  const pin = await post({
    kind: "question",
    title: "Is the trial 14 or 30 days?",
    body: "The button says Start trial but nothing says how long it is.",
    page: { url: pricing, title: "Pricing · Acme" },
    anchor: anchor("#start-trial", "button", "Start trial", at("start-trial"), { xPct: 70, yPct: 50 }),
    environment: env(1280, 800),
    reporter: { name: "Dana Reviewer" },
    screenshot: shot,
  });
  const headline = await post({
    kind: "idea",
    body: "Could the headline mention the free plan?",
    page: { url: pricing, title: "Pricing · Acme" },
    anchor: anchor("#headline", "h1", "Simple pricing for every team", at("headline"), {
      xPct: 20,
      yPct: 60,
    }),
    environment: env(1280, 800),
  });
  const mobile = await post({
    kind: "comment",
    body: "On my phone the plans stack and the Pro badge disappears.",
    page: { url: pricing, title: "Pricing · Acme" },
    anchor: anchor(
      "#pro",
      "div",
      "Pro $29",
      { x: 20, y: 600, w: 350, h: 330, vw: 390, vh: 844, scrollY: 0 },
      { xPct: 50, yPct: 10 },
    ),
    environment: env(390, 844),
    screenshot: mobileShot,
  });
  const bug = await post({
    kind: "bug",
    title: "Checkout button does nothing",
    body: "Clicked Pay now twice, nothing happened. Console shows a TypeError.",
    priority: "high",
    page: { url: `${SITE_ORIGIN}/checkout`, title: "Checkout · Acme" },
    environment: env(1280, 800),
    reporter: { name: "Sam Shopper", email: "sam@client.example" },
    diagnostics: {
      console: [
        {
          level: "error",
          message: "TypeError: Cannot read properties of undefined (reading 'total')",
          at: 1,
        },
        { level: "warn", message: "Stripe.js loaded over HTTP", at: 2 },
      ],
      network: [{ method: "POST", url: `${SITE_ORIGIN}/api/checkout`, status: 500, durationMs: 412, at: 3 }],
    },
    screenshot: shot,
    attachments: [
      { name: "receipt.pdf", contentType: "application/pdf", dataUrl: tinyPdf },
      { name: "pixel.png", contentType: "image/png", dataUrl: tinyPng },
    ],
  });
  const extra = await post({
    kind: "comment",
    body: "Footer links are hard to read on the dark background.",
    page: { url: `${SITE_ORIGIN}/about`, title: "About · Acme" },
    environment: env(1440, 900),
  });

  await api.storageState({ path: STATE_FILE });
  const data: Seed = {
    orgId: org.id,
    projectId: project.id,
    publicKey: project.publicKey,
    items: { region, pin, headline, mobile, bug, extra },
  };
  writeFileSync(SEED_FILE, JSON.stringify(data, null, 2));
  await api.dispose();
}
