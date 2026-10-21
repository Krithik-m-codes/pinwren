// Load test for a running Pinwren stack. Run through docker/compose.loadtest.yml, or locally:
//   k6 run -e BASE=http://localhost:3200 loadtest/k6.js
//
// Scenarios (run concurrently):
//   widget_read   — visitors loading the widget config and the pins of a page
//   widget_ingest — visitors submitting comments and bug reports (some with a screenshot)
//   dashboard     — a signed-in team member triaging: list, open, change status
//   abuse         — one IP flooding the submit endpoint; must be throttled (429)
import { check, fail } from "k6";
import encoding from "k6/encoding";
import http from "k6/http";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE = __ENV.BASE || "http://pinwren:3000";
const SITE = "http://loadtest.local";
const DURATION = __ENV.DURATION || "2m";

const throttled = new Counter("abuse_throttled_429");
const abuseAccepted = new Counter("abuse_accepted");
const ingestOk = new Rate("ingest_ok");
const ingestTime = new Trend("ingest_duration", true);

export const options = {
  setupTimeout: "60s",
  scenarios: {
    widget_read: {
      executor: "constant-arrival-rate",
      exec: "widgetRead",
      rate: Number(__ENV.READ_RPS || 60),
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: 40,
      maxVUs: 200,
    },
    widget_ingest: {
      executor: "ramping-arrival-rate",
      exec: "widgetIngest",
      startRate: 2,
      timeUnit: "1s",
      preAllocatedVUs: 40,
      maxVUs: 200,
      stages: [
        { target: Number(__ENV.INGEST_RPS || 25), duration: "30s" },
        { target: Number(__ENV.INGEST_RPS || 25), duration: DURATION },
        { target: 0, duration: "10s" },
      ],
    },
    dashboard: {
      executor: "constant-arrival-rate",
      exec: "dashboard",
      rate: Number(__ENV.DASH_RPS || 10),
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: 10,
      maxVUs: 50,
    },
    abuse: {
      executor: "constant-arrival-rate",
      exec: "abuse",
      rate: 5,
      timeUnit: "1s",
      duration: "20s",
      startTime: "20s",
      preAllocatedVUs: 5,
    },
  },
  thresholds: {
    "http_req_failed{scenario:widget_read}": ["rate<0.01"],
    "http_req_failed{scenario:dashboard}": ["rate<0.01"],
    "http_req_duration{scenario:widget_read}": ["p(95)<300"],
    "http_req_duration{scenario:dashboard}": ["p(95)<500"],
    ingest_ok: ["rate>0.99"],
    ingest_duration: ["p(95)<800"],
    // The flood is ~100 requests from one IP; at most the per-minute allowance may get through.
    abuse_throttled_429: ["count>50"],
  },
};

// 1×1 PNG, and a ~60 KB PNG-shaped payload to exercise image upload sizes realistically.
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const pngHeader = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const bigBytes = new Uint8Array(60_000);
bigBytes.set(pngHeader);
for (let i = 8; i < bigBytes.length; i++) bigBytes[i] = (i * 31) % 251;
const BIG_PNG = `data:image/png;base64,${encoding.b64encode(bigBytes.buffer)}`;

const PAGES = ["/", "/pricing", "/checkout?step=2", "/blog/launch", "/account/settings"];

function uuid() {
  const h = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 32; i++) s += h[Math.floor(Math.random() * 16)];
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20, 32)}`;
}
const randomIp = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function json(method, path, body, headers = {}) {
  return http.request(method, `${BASE}${path}`, body ? JSON.stringify(body) : null, {
    headers: { "content-type": "application/json", ...headers },
    tags: { name: path.split("?")[0].replace(/[0-9a-f-]{36}/g, ":id") },
  });
}

export function setup() {
  const origin = { origin: BASE };
  const email = `load+${Date.now()}@example.com`;
  let r = json(
    "POST",
    "/api/auth/sign-up/email",
    { name: "Load Tester", email, password: "load-test-pass-1" },
    origin,
  );
  if (r.status !== 200) fail(`sign-up failed: ${r.status} ${r.body}`);
  const cookie = Object.entries(r.cookies)
    .map(([k, v]) => `${k}=${v[0].value}`)
    .join("; ");
  const auth = { ...origin, cookie };
  r = json("POST", "/api/auth/organization/create", { name: "Load Org", slug: `load-${Date.now()}` }, auth);
  if (r.status !== 200) fail(`org create failed: ${r.status} ${r.body}`);
  r = json("POST", "/api/auth/organization/set-active", { organizationId: r.json("id") }, auth);
  const sessionCookie =
    Object.entries(r.cookies)
      .map(([k, v]) => `${k}=${v[0].value}`)
      .join("; ") || cookie;
  const dash = { ...origin, cookie: sessionCookie };
  r = json("POST", "/api/projects", { name: "Load site", allowedOrigins: ["loadtest.local"] }, dash);
  if (r.status !== 201) fail(`project create failed: ${r.status} ${r.body}`);
  return { key: r.json("project.publicKey"), dash };
}

function widgetHeaders(key, ip) {
  return { "x-pinwren-key": key, origin: SITE, "x-forwarded-for": ip };
}

export function widgetRead(data) {
  const h = widgetHeaders(data.key, randomIp());
  const cfg = json("GET", "/w/config", null, h);
  check(cfg, { "config 200": (r) => r.status === 200 });
  const pins = json("GET", `/w/feedback?url=${encodeURIComponent(SITE + pick(PAGES))}`, null, h);
  check(pins, { "pins 200": (r) => r.status === 200 });
}

export function widgetIngest(data) {
  const isBug = Math.random() < 0.4;
  const withShot = isBug && Math.random() < 0.5;
  const body = {
    clientId: uuid(),
    kind: isBug ? "bug" : pick(["comment", "idea", "question"]),
    body: `Load test feedback ${Math.random().toString(36).slice(2)} — the button overlaps the footer on small screens.`,
    page: { url: SITE + pick(PAGES), title: "Load test page" },
    environment: {
      userAgent: "k6",
      browser: "Chrome 140",
      os: "Linux",
      viewport: { w: 1440, h: 900 },
      dpr: 2,
    },
    reporter: { name: "Load Bot" },
    anchor: isBug
      ? undefined
      : {
          v: 1,
          css: "main > section:nth-child(2) > button",
          xpath: "/html/body[1]/main[1]/section[2]/button[1]",
          text: { content: "Start a subscription", prefix: "", suffix: "" },
          tag: "button",
          structure: { depth: 4, siblingIndex: 1, childTagsHash: "abc" },
          rect: { x: 100, y: 400, w: 200, h: 40, vw: 1440, vh: 900, scrollY: 0 },
          pin: { xPct: 50, yPct: 50 },
        },
    diagnostics: isBug
      ? {
          console: [
            { level: "error", message: "TypeError: cannot read properties of undefined", at: Date.now() },
          ],
          network: [{ method: "POST", url: "/api/pay", status: 500, durationMs: 230, at: Date.now() }],
        }
      : undefined,
    screenshot: withShot ? (Math.random() < 0.5 ? BIG_PNG : TINY_PNG) : undefined,
  };
  const r = json("POST", "/w/feedback", body, widgetHeaders(data.key, randomIp()));
  ingestTime.add(r.timings.duration);
  ingestOk.add(r.status === 201);
  check(r, { "ingest 201": (res) => res.status === 201 });
}

export function dashboard(data) {
  const list = json("GET", "/api/feedback?status=active&limit=50", null, data.dash);
  check(list, { "list 200": (r) => r.status === 200 });
  const items = list.status === 200 ? list.json("items") : [];
  if (!items || items.length === 0) return;
  const item = pick(items);
  const detail = json("GET", `/api/feedback/${item.id}`, null, data.dash);
  check(detail, { "detail 200": (r) => r.status === 200 });
  if (Math.random() < 0.3) {
    const upd = json(
      "PATCH",
      `/api/feedback/${item.id}`,
      { status: pick(["in_progress", "in_review", "resolved"]) },
      data.dash,
    );
    check(upd, { "update 200": (r) => r.status === 200 });
  }
}

export function abuse(data) {
  const r = json(
    "POST",
    "/w/feedback",
    {
      clientId: uuid(),
      kind: "comment",
      body: "flood",
      page: { url: `${SITE}/` },
      environment: { userAgent: "k6", viewport: { w: 1, h: 1 }, dpr: 1 },
    },
    widgetHeaders(data.key, "203.0.113.7"),
  );
  if (r.status === 429) throttled.add(1);
  else if (r.status === 201) abuseAccepted.add(1);
}
