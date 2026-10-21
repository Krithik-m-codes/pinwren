// End-to-end API smoke test: node scripts/smoke.mjs [baseUrl]
const B = process.argv[2] ?? "http://localhost:3100";
let cookie = "";
async function call(path, { method = "GET", json, headers = {} } = {}) {
  const res = await fetch(B + path, {
    method,
    headers: { ...(json ? { "content-type": "application/json" } : {}), cookie, origin: B, ...headers },
    body: json ? JSON.stringify(json) : undefined,
    redirect: "manual",
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label} ${extra}`);
  if (!cond) process.exitCode = 1;
};

const email = `smoke+${Date.now()}@example.com`;
let r = await call("/api/health");
check("health", r.status === 200);
r = await call("/api/auth/sign-up/email", {
  method: "POST",
  json: { name: "Smoke Tester", email, password: "correct-horse-1" },
});
check("sign up", r.status === 200, r.status);
r = await call("/api/projects");
check("dashboard needs an org first", r.status === 409, r.body.code);
r = await call("/api/auth/organization/create", {
  method: "POST",
  json: { name: "Smoke Org", slug: `smoke-${Date.now()}` },
});
check("create org", r.status === 200, r.status);
const orgId = r.body.id;
r = await call("/api/auth/organization/set-active", { method: "POST", json: { organizationId: orgId } });
check("set active org", r.status === 200, r.status);
r = await call("/api/projects", {
  method: "POST",
  json: { name: "Demo site", allowedOrigins: ["localhost:5173"] },
});
check("create project", r.status === 201, r.status);
const { id: projectId, publicKey } = r.body.project;

const site = "http://localhost:5173";
const W = (path, opts = {}) =>
  call(path, { ...opts, headers: { "x-annota-key": publicKey, origin: site, ...(opts.headers ?? {}) } });
r = await W("/w/config");
check("widget config from allowed origin", r.status === 200, r.status);
r = await W("/w/config", { headers: { origin: "https://evil.example" } });
check("widget config from other origin is refused", r.status === 403, r.status);

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const clientId = crypto.randomUUID();
const report = {
  clientId,
  kind: "bug",
  body: "The checkout button does nothing on mobile",
  page: { url: `${site}/checkout?b=2&a=1#top`, title: "Checkout" },
  environment: {
    userAgent: "smoke",
    browser: "Chrome 140",
    os: "Android",
    viewport: { w: 390, h: 844 },
    dpr: 3,
  },
  reporter: { name: "Maria", email: "maria@example.com" },
  diagnostics: {
    console: [{ level: "error", message: "TypeError: x is undefined", at: Date.now() }],
    network: [{ method: "POST", url: "/api/pay", status: 500, durationMs: 230, at: Date.now() }],
  },
  screenshot: png,
};
r = await W("/w/feedback", { method: "POST", json: report });
check("widget submits a bug report", r.status === 201, r.status);
const fid = r.body.feedback?.id;
r = await W("/w/feedback", { method: "POST", json: report });
check("resubmit with same clientId is idempotent", r.status === 200 && r.body.feedback.id === fid);
r = await W("/w/feedback", {
  method: "POST",
  json: { ...report, clientId: crypto.randomUUID(), screenshot: "data:image/png;base64,PHN2Zz4=" },
});
check("fake image bytes are rejected with 400", r.status === 400, r.status);
r = await W(`/w/feedback?url=${encodeURIComponent(`${site}/checkout?a=1&b=2`)}`);
check(
  "pins listed for the page (URL normalised)",
  r.status === 200 && r.body.items.length === 1,
  r.body.items?.length,
);

r = await call("/api/feedback?status=active");
check("inbox lists the report", r.status === 200 && r.body.items.some((i) => i.id === fid));
r = await call(`/api/feedback/${fid}`);
check(
  "detail has screenshot + diagnostics",
  r.body.assets?.length === 1 && r.body.diagnostics?.console?.length === 1,
);
const assetId = r.body.assets[0].id;
r = await call(`/api/assets/${assetId}`);
check("screenshot served to the team", r.status === 200);
r = await call(`/api/feedback/${fid}`, { method: "PATCH", json: { status: "resolved", priority: "high" } });
check("resolve + prioritise", r.status === 200 && r.body.feedback.resolvedAt);
r = await call(`/api/feedback/${fid}/comments`, {
  method: "POST",
  json: { body: "Fixed in v1.2", visibility: "public" },
});
check("team reply", r.status === 201);
r = await W(`/w/feedback/${fid}/comments`);
check("public reply visible in widget", r.body.items?.length === 1 && r.body.items[0].team === true);
r = await call(`/api/feedback/${fid}`);
check("activity recorded", r.body.activity.length >= 3, r.body.activity.length);

const saved = cookie;
cookie = "";
r = await call("/api/feedback");
check("inbox requires a session", r.status === 401, r.status);
cookie = saved;
console.log(process.exitCode ? "\nSMOKE FAILED" : "\nSMOKE OK");
