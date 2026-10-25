// End-to-end API smoke test: node scripts/smoke.mjs [baseUrl]
//
// Start the server with:
//   PINWREN_TRUST_PROXY=1 GITHUB_API_URL=http://127.0.0.1:4790 PINWREN_DISABLE_SIGNUP=false
//   PINWREN_OUTBOUND_ALLOWLIST=127.0.0.1 PINWREN_ADMIN_EMAILS=smoke-admin@example.com,e2e-admin@example.com
// TRUST_PROXY=1: every request carries a per-run X-Forwarded-For, so per-address limits don't leak between
// runs. DISABLE_SIGNUP=false: the run signs up fresh accounts (sign-up closes after the first account
// otherwise). OUTBOUND_ALLOWLIST=127.0.0.1: webhook/tracker checks use local receivers; the security
// checks prove every other private address (127.0.0.2, 10/8, metadata…) is still refused.
// Instance-admin checks need PINWREN_ADMIN_EMAILS=smoke-admin@example.com (or SMOKE_ADMIN_EMAIL /
// SMOKE_ADMIN_PASSWORD pointing at an existing admin); otherwise they are skipped.
// Wave-4 SDK/MCP/CLI checks run the built packages:
//   pnpm --filter @pinwren/sdk --filter @pinwren/mcp --filter @pinwren/cli build
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { createRequire } from "node:module";
import { createServer as createTcpServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

const B = process.argv[2] ?? "http://localhost:3100";
const mainJar = { cookie: "" };
// The server runs with PINWREN_TRUST_PROXY=1, so the rightmost X-Forwarded-For entry is the client. One
// address per run keeps per-address limits (sign-in, failed tokens) from carrying over between runs.
const rand = () => Math.floor(Math.random() * 254) + 1;
const RUN_IP = `198.18.${rand()}.${rand()}`;
async function call(path, { method = "GET", json, rawBody, headers = {}, jar = mainJar } = {}) {
  const res = await fetch(B + path, {
    method,
    headers: {
      ...(json ? { "content-type": "application/json" } : {}),
      ...(jar.cookie ? { cookie: jar.cookie } : {}),
      origin: B,
      "x-forwarded-for": RUN_IP,
      ...headers,
    },
    body: rawBody ?? (json ? JSON.stringify(json) : undefined),
    redirect: "manual",
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) {
    const jarMap = new Map(
      jar.cookie ? jar.cookie.split("; ").map((c) => c.split(/=(.*)/s).slice(0, 2)) : [],
    );
    for (const c of set) {
      const [k, v] = c.split(";")[0].split(/=(.*)/s);
      jarMap.set(k, v);
    }
    jar.cookie = [...jarMap].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}
let passed = 0;
let failed = 0;
let skipped = 0;
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label} ${extra}`);
  if (cond) passed++;
  else {
    failed++;
    process.exitCode = 1;
  }
};
const skip = (label, why) => {
  skipped++;
  console.log(`SKIP  ${label} (${why})`);
};
async function waitFor(fn, ms = 20_000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) return null;
    await new Promise((r) => setTimeout(r, 400));
  }
}

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
// Wave 5: new projects keep pins private (publicRead false) and email reporters (notifyReporter true).
check(
  "new project defaults: private pins, reporter emails on",
  r.body.project.publicRead === false && r.body.project.notifyReporter === true,
  JSON.stringify({ publicRead: r.body.project.publicRead, notifyReporter: r.body.project.notifyReporter }),
);
// The widget checks below read pins and public replies: opt this project in.
r = await call(`/api/projects/${projectId}`, { method: "PATCH", json: { publicRead: true } });
check(
  "opt the test project into public pins",
  r.status === 200 && r.body.project.publicRead === true,
  r.status,
);

const site = "http://localhost:5173";
const W = (path, opts = {}) =>
  call(path, {
    ...opts,
    jar: { cookie: "" },
    headers: { "x-pinwren-key": publicKey, origin: site, ...(opts.headers ?? {}) },
  });
r = await W("/w/config");
check("widget config from allowed origin", r.status === 200, r.status);
const cfg = r.body;
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
const firstToken = r.body.feedback?.reporterToken;
r = await W("/w/feedback", { method: "POST", json: report });
check("resubmit with same clientId is idempotent", r.status === 200 && r.body.feedback.id === fid);
const replayHasToken = r.body.feedback?.reporterToken !== undefined;
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
const pin = r.body.items?.[0];

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
const teamCommentId = r.body.comment?.id;
r = await W(`/w/feedback/${fid}/comments`);
check("public reply visible in widget", r.body.items?.length === 1 && r.body.items[0].team === true);
r = await call(`/api/feedback/${fid}`);
check("activity recorded", r.body.activity.length >= 3, r.body.activity.length);

const saved = mainJar.cookie;
mainJar.cookie = "";
r = await call("/api/feedback");
check("inbox requires a session", r.status === 401, r.status);
mainJar.cookie = saved;

// =============================================================================================
// Wave 1
// =============================================================================================
console.log("\n— widget contract");
check(
  "config: defaults filled for an empty project",
  cfg.widget?.launcher?.position === "bottom-right" &&
    cfg.widget?.launcher?.offset?.x === 20 &&
    cfg.widget?.modes?.bug === true &&
    cfg.widget?.visitorsCanResolve === false &&
    cfg.capture?.console === "warnings" &&
    Array.isArray(cfg.capture?.maskSelectors),
);
r = await call(`/api/projects/${projectId}`, {
  method: "PATCH",
  json: {
    widgetConfig: { launcher: { position: "top-left", label: null } },
    captureConfig: { console: "all" },
  },
});
check(
  "project PATCH merges widget/capture config",
  r.status === 200 &&
    r.body.project.widgetConfig.launcher.position === "top-left" &&
    r.body.project.widgetConfig.launcher.label === null &&
    r.body.project.widgetConfig.launcher.shape === "round" &&
    r.body.project.captureConfig.console === "all",
  r.status,
);
r = await call(`/api/projects/${projectId}`, {
  method: "PATCH",
  json: { widgetConfig: { launcher: { position: "middle" } } },
});
check(
  "project PATCH rejects an invalid widget config",
  r.status === 400 && r.body.code === "INVALID_WIDGET_CONFIG",
);
{
  // Concurrent saves of different keys must both land (row-locked read-merge-write).
  const saves = await Promise.all([
    call(`/api/projects/${projectId}`, { method: "PATCH", json: { widgetConfig: { shortcuts: false } } }),
    call(`/api/projects/${projectId}`, { method: "PATCH", json: { widgetConfig: { readOnly: true } } }),
    call(`/api/projects/${projectId}`, { method: "PATCH", json: { captureConfig: { network: "off" } } }),
  ]);
  r = await call(`/api/projects/${projectId}`);
  const p = r.body.project;
  check(
    "concurrent project saves don't overwrite each other",
    saves.every((s) => s.status === 200) &&
      p.widgetConfig.shortcuts === false &&
      p.widgetConfig.readOnly === true &&
      p.captureConfig.network === "off",
    JSON.stringify({
      shortcuts: p.widgetConfig.shortcuts,
      readOnly: p.widgetConfig.readOnly,
      network: p.captureConfig.network,
    }),
  );
  r = await call(`/api/projects/${projectId}`, {
    method: "PATCH",
    json: { widgetConfig: { shortcuts: true, readOnly: false }, captureConfig: { network: "failures" } },
  });
}
r = await W("/w/config");
check(
  "config: stored values merged over defaults",
  r.body.widget?.launcher?.position === "top-left" && r.body.widget?.launcher?.icon === "pin",
);
check(
  "pins carry title/priority/replyCount",
  pin && "title" in pin && "priority" in pin && "replyCount" in pin,
);
check(
  "create returns a reporterToken once",
  typeof firstToken === "string" && firstToken.length >= 40 && !replayHasToken,
);

// Resolve from the page: visitor path off, reporter-token path on.
r = await call(`/api/projects/${projectId}`, {
  method: "PATCH",
  json: { widgetConfig: { visitorsCanResolve: false } },
});
const r2 = await W("/w/feedback", {
  method: "POST",
  json: { ...report, clientId: crypto.randomUUID(), screenshot: undefined },
});
const fid2 = r2.body.feedback?.id;
const token2 = r2.body.feedback?.reporterToken;
r = await W(`/w/feedback/${fid2}`, { method: "PATCH", json: { status: "resolved" } });
check(
  "resolve from page without token is 403",
  r.status === 403 && r.body.code === "RESOLVE_NOT_ALLOWED",
  r.status,
);
r = await W(`/w/feedback/${fid2}`, {
  method: "PATCH",
  json: { status: "resolved" },
  headers: { "x-pinwren-reporter-token": `${token2.slice(0, -2)}xx` },
});
check("resolve with a wrong token is 403", r.status === 403, r.status);
r = await W(`/w/feedback/${fid2}`, {
  method: "PATCH",
  json: { status: "resolved" },
  headers: { "x-pinwren-reporter-token": token2 },
});
check(
  "reporter resolves with their token",
  r.status === 200 && r.body.feedback?.status === "resolved",
  r.status,
);
r = await call(`/api/projects/${projectId}`, {
  method: "PATCH",
  json: { widgetConfig: { visitorsCanResolve: true } },
});
r = await W(`/w/feedback/${fid2}`, { method: "PATCH", json: { status: "open" } });
check(
  "visitor reopens when visitorsCanResolve",
  r.status === 200 && r.body.feedback?.status === "open",
  r.status,
);
r = await call(`/api/feedback/${fid2}`);
check(
  "page resolve/reopen written to activity as guest",
  r.body.activity?.filter((a) => a.type === "status_changed" && a.actorKind === "guest").length === 2,
);

r = await W(`/w/feedback/${fid}/comments`, {
  method: "POST",
  json: { body: "Still broken?", author: { name: "Maria" } },
});
check(
  "widget reply returns the contract shape",
  r.status === 201 &&
    r.body.comment?.authorName === "Maria" &&
    r.body.comment?.team === false &&
    r.body.comment?.body,
);

const pdf = `data:application/pdf;base64,${Buffer.from("%PDF-1.4\n%smoke\n").toString("base64")}`;
r = await W("/w/feedback", {
  method: "POST",
  json: {
    ...report,
    clientId: crypto.randomUUID(),
    attachments: [
      { name: "invoice.pdf", contentType: "application/pdf", dataUrl: pdf },
      { name: "pixel.png", contentType: "image/png", dataUrl: png },
    ],
  },
});
check("attachments accepted", r.status === 201, r.status);
const fid3 = r.body.feedback?.id;
r = await call(`/api/feedback/${fid3}`);
const att = r.body.assets?.filter((a) => a.kind === "attachment") ?? [];
check("attachments stored as kind attachment", att.length === 2 && att.some((a) => a.name === "invoice.pdf"));
const pdfAsset = att.find((a) => a.contentType === "application/pdf");
r = pdfAsset ? await call(`/api/assets/${pdfAsset.id}`) : { status: 0, headers: new Headers() };
check(
  "pdf attachment served as a download",
  r.status === 200 && (r.headers.get("content-disposition") ?? "").startsWith("attachment"),
);
r = await W("/w/feedback", {
  method: "POST",
  json: {
    ...report,
    clientId: crypto.randomUUID(),
    attachments: [
      { name: "x.pdf", contentType: "application/pdf", dataUrl: "data:application/pdf;base64,PHN2Zz4=" },
    ],
  },
});
check(
  "attachment with fake bytes rejected",
  r.status === 400 && r.body.code === "INVALID_ATTACHMENT",
  r.status,
);
r = await W("/w/feedback", {
  method: "POST",
  json: {
    ...report,
    clientId: crypto.randomUUID(),
    attachments: [1, 2, 3, 4].map((i) => ({ name: `${i}.png`, contentType: "image/png", dataUrl: png })),
  },
});
check("more than 3 attachments rejected", r.status === 400, r.status);
r = await W("/w/feedback", {
  method: "POST",
  json: {
    ...report,
    clientId: crypto.randomUUID(),
    attachments: [{ name: "x.png", contentType: "image/png", dataUrl: pdf }],
  },
});
check("attachment type mismatch rejected", r.status === 400, r.status);

// --- Invitations + a second member -----------------------------------------------------------------
console.log("\n— team");
const memberEmail = `smoke-member+${Date.now()}@example.com`;
r = await call("/api/auth/organization/invite-member", {
  method: "POST",
  json: { email: memberEmail, role: "member" },
});
check("invite a member (email queued, SMTP optional)", r.status === 200, r.status);
const invitationId = r.body?.id;
r = await call("/api/invitations");
check(
  "pending invitations listed",
  r.status === 200 && r.body.invitations?.some((i) => i.id === invitationId),
);
const memberJar = { cookie: "" };
r = await call("/api/auth/sign-up/email", {
  method: "POST",
  json: { name: "Smoke Member", email: memberEmail, password: "correct-horse-2" },
  jar: memberJar,
});
r = await call("/api/auth/organization/accept-invitation", {
  method: "POST",
  json: { invitationId },
  jar: memberJar,
});
check("invitee accepts", r.status === 200, r.status);
await call("/api/auth/organization/set-active", {
  method: "POST",
  json: { organizationId: orgId },
  jar: memberJar,
});
r = await call("/api/me", { jar: memberJar });
const memberId = r.body.user?.id;
check("member reaches the dashboard", r.status === 200 && r.body.role === "member");
r = await call("/api/invitations");
check("accepted invitation leaves the pending list", !r.body.invitations?.some((i) => i.id === invitationId));

// --- Comment permissions ---------------------------------------------------------------------------
r = await call(`/api/comments/${teamCommentId}`, { method: "PATCH", json: { body: "x" }, jar: memberJar });
check("member cannot edit someone else's comment", r.status === 403, r.status);
r = await call(`/api/comments/${teamCommentId}`, { method: "DELETE", jar: memberJar });
check("member cannot delete someone else's comment", r.status === 403, r.status);
r = await call(`/api/comments/${teamCommentId}`, { method: "PATCH", json: { body: "Fixed in v1.2.1" } });
check(
  "author edits own comment",
  r.status === 200 && r.body.comment?.editedAt && r.body.comment.body === "Fixed in v1.2.1",
);
r = await call(`/api/feedback/${fid}/comments`, {
  method: "POST",
  json: { body: "Member note", visibility: "internal" },
  jar: memberJar,
});
const memberComment = r.body.comment?.id;
r = await call(`/api/comments/${memberComment}`, {
  method: "PATCH",
  json: { body: "Edited" },
  jar: memberJar,
});
check("member edits own comment", r.status === 200);
r = await call(`/api/comments/${memberComment}`, { method: "DELETE" });
check("org owner deletes a member's comment", r.status === 204, r.status);

// --- Assignment, notifications, preferences ---------------------------------------------------------
r = await call(`/api/feedback/${fid}`, { method: "PATCH", json: { assigneeIds: ["not-a-member"] } });
check("assigning a non-member is rejected", r.status === 400, r.status);
r = await call(`/api/feedback/${fid}`, { method: "PATCH", json: { assigneeIds: [memberId] } });
check("assign to member", r.status === 200);
r = await call(`/api/feedback/${fid}`);
check(
  "detail includes assignee names",
  r.body.assignees?.[0]?.name === "Smoke Member" &&
    r.body.activity?.some(
      (a) => a.type === "assigneeIds_changed" && a.data.toUsers?.[0]?.name === "Smoke Member",
    ),
);
r = await waitFor(async () => {
  const n = await call("/api/notifications", { jar: memberJar });
  return n.body.items?.some((i) => i.type === "feedback.assigned") ? n : null;
});
check("assignee gets an in-app notification (job ran)", !!r, r ? `unread=${r.body.unreadCount}` : "timeout");
r = await call("/api/notifications/read", { method: "POST", json: { all: true }, jar: memberJar });
check("mark notifications read", r.status === 200 && r.body.updated >= 1);
r = await call("/api/notifications?unread=1", { jar: memberJar });
check("no unread left", r.body.unreadCount === 0 && r.body.items.length === 0);

r = await call("/api/notification-preferences");
const pref = r.body.preferences?.find((p) => p.projectId === projectId);
check("preferences default on", pref?.newFeedback === true && pref?.email === true);
r = await call("/api/notification-preferences", {
  method: "PUT",
  json: { projectId, newFeedback: false, email: false },
});
check(
  "preferences saved",
  r.status === 200 && r.body.preference?.newFeedback === false && r.body.preference?.assigned === true,
);
r = await call("/api/notification-preferences");
const pref2 = r.body.preferences?.find((p) => p.projectId === projectId);
check(
  "preferences round-trip",
  pref2?.newFeedback === false && pref2?.email === false && pref2?.replies === true,
);

// --- Webhooks ---------------------------------------------------------------------------------------
console.log("\n— webhooks");
const received = [];
const receiver = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => {
    body += c;
  });
  req.on("end", () => {
    received.push({ path: req.url, headers: req.headers, body });
    res.statusCode = req.url === "/fail" ? 500 : 200;
    res.end(req.url === "/fail" ? "nope" : "ok");
  });
});
// SMOKE_RECEIVER_HOST: the address the server uses to reach this script — 127.0.0.1 locally, the smoke
// container's name when the server runs in Docker (the receiver then listens on all interfaces).
const receiverHost = process.env.SMOKE_RECEIVER_HOST ?? "127.0.0.1";
const listenHost = receiverHost === "127.0.0.1" ? "127.0.0.1" : "0.0.0.0";
await new Promise((resolve) => receiver.listen(0, listenHost, resolve));
const hookBase = `http://${receiverHost}:${receiver.address().port}`;
const verify = (req, secret) => {
  const ts = req.headers["pinwren-timestamp"];
  const expected = `v1=${createHmac("sha256", secret).update(`${ts}.${req.body}`).digest("hex")}`;
  return req.headers["pinwren-signature"] === expected && Math.abs(Date.now() / 1000 - Number(ts)) < 300;
};

try {
  r = await call("/api/webhooks", {
    method: "POST",
    json: { url: `${hookBase}/hook`, events: ["feedback.created"], projectId },
    jar: memberJar,
  });
  check("members cannot manage webhooks", r.status === 403, r.status);
  r = await call("/api/webhooks", {
    method: "POST",
    json: {
      name: "Smoke",
      url: `${hookBase}/hook`,
      events: ["feedback.created", "comment.created"],
      projectId,
    },
  });
  check(
    "create generic webhook (secret shown once)",
    r.status === 201 && r.body.secret?.startsWith("whsec_"),
    r.status,
  );
  const hookId = r.body.webhook?.id;
  const secret = r.body.secret;
  r = await call("/api/webhooks");
  check(
    "webhook list never returns the secret",
    r.body.webhooks?.length === 1 && !JSON.stringify(r.body).includes(secret),
  );

  r = await call(`/api/webhooks/${hookId}/test`, { method: "POST" });
  const ping = received.find((x) => x.headers["pinwren-event"] === "ping");
  check(
    "test delivery succeeds",
    r.status === 200 && r.body.delivery?.status === "success" && r.body.delivery?.responseCode === 200,
  );
  check("test delivery is signed", ping && verify(ping, secret));

  r = await call("/api/webhooks", {
    method: "POST",
    json: { url: `${hookBase}/slack`, kind: "slack", events: ["feedback.created"], projectId },
  });
  check(
    "create slack webhook (no secret, url masked)",
    r.status === 201 && r.body.secret === null && !r.body.webhook.url.includes("/slack"),
  );
  r = await call("/api/webhooks", {
    method: "POST",
    json: { url: `${hookBase}/fail`, events: ["feedback.created"], projectId },
  });
  const failId = r.body.webhook?.id;

  r = await W("/w/feedback", {
    method: "POST",
    json: {
      ...report,
      clientId: crypto.randomUUID(),
      screenshot: undefined,
      body: "<!channel> *ping* @everyone",
    },
  });
  const fid4 = r.body.feedback?.id;
  const created = await waitFor(() =>
    received.find(
      (x) => x.path === "/hook" && x.headers["pinwren-event"] === "feedback.created" && x.body.includes(fid4),
    ),
  );
  check("feedback.created delivered by the job queue", !!created, created ? "" : "timeout");
  check("delivery signature verifies", created && verify(created, secret));
  const payload = created ? JSON.parse(created.body) : {};
  check(
    "payload is versioned with the feedback",
    payload.apiVersion && payload.event === "feedback.created" && payload.data?.feedback?.id === fid4,
  );
  const slack = await waitFor(() => received.find((x) => x.path === "/slack" && x.body.includes("channel")));
  const slackText = slack ? JSON.stringify(JSON.parse(slack.body)) : "";
  check(
    "slack payload escapes mentions",
    !!slack && !slackText.includes("<!channel>") && slackText.includes("plain_text"),
    slack ? "" : "timeout",
  );
  const retrying = await waitFor(async () => {
    const d = await call(`/api/webhooks/${failId}/deliveries`);
    return d.body.deliveries?.find((x) => x.status === "retrying" && x.nextRetryAt);
  });
  check(
    "failed delivery is scheduled for retry in ~1 min",
    retrying && Math.abs(new Date(retrying.nextRetryAt).getTime() - Date.now() - 60_000) < 20_000,
  );

  r = await call(`/api/webhooks/${hookId}/deliveries`);
  const d1 = r.body.deliveries?.find((x) => x.event === "feedback.created");
  check("delivery log lists the attempt", d1?.status === "success" && typeof d1.durationMs === "number");
  const before = received.length;
  r = await call(`/api/webhook-deliveries/${d1?.id}/redeliver`, { method: "POST" });
  check(
    "redeliver",
    r.status === 200 && r.body.delivery?.status === "success" && received.length === before + 1,
  );
  r = await call(`/api/webhooks/${failId}`, { method: "DELETE" });
  check("delete webhook", r.status === 204);
  // The receiver closes below; endpoints left behind would retry against it for days.
  for (const w of (await call("/api/webhooks")).body.webhooks ?? []) {
    await call(`/api/webhooks/${w.id}`, { method: "DELETE" });
  }
} finally {
  receiver.close();
}

// --- API tokens + public API -----------------------------------------------------------------------
console.log("\n— public API");
r = await call("/api/tokens", { method: "POST", json: { name: "read only", scopes: ["feedback:read"] } });
check(
  "create read token (secret shown once)",
  r.status === 201 && r.body.secret?.startsWith("pwt_"),
  r.status,
);
const readToken = r.body.secret;
const readTokenId = r.body.token?.id;
r = await call("/api/tokens", {
  method: "POST",
  json: { name: "writer", scopes: ["feedback:read", "feedback:write", "comments:write"], expiresInDays: 1 },
});
const writeToken = r.body.secret;
r = await call("/api/tokens");
check(
  "token list shows prefix, never the secret",
  r.body.tokens?.length === 2 && !JSON.stringify(r.body).includes(readToken),
);
const V = (path, token, opts = {}) =>
  call(`/api/v1${path}`, {
    ...opts,
    jar: { cookie: "" },
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
r = await V("/feedback?status=all", readToken);
check("v1 list with a valid token", r.status === 200 && r.body.items?.some((i) => i.id === fid));
r = await V(`/feedback/${fid}`, readToken);
check(
  "v1 get",
  r.status === 200 && r.body.feedback?.id === fid && r.body.feedback.reporterTokenHash === undefined,
);
r = await V("/feedback", `${readToken.slice(0, -4)}abcd`);
check("v1 rejects a wrong secret", r.status === 401, r.status);
r = await V("/feedback", null);
check("v1 rejects a missing token", r.status === 401, r.status);
r = await V(`/feedback/${fid}`, readToken, { method: "PATCH", json: { status: "in_progress" } });
check("v1 enforces scopes", r.status === 403 && r.body.code === "INSUFFICIENT_SCOPE", r.status);
r = await V(`/feedback/${fid}`, writeToken, { method: "PATCH", json: { status: "in_progress" } });
check("v1 patch with write scope", r.status === 200 && r.body.feedback?.status === "in_progress");
r = await V(`/feedback/${fid}/comments`, writeToken, {
  method: "POST",
  json: { body: "From CI", visibility: "internal" },
});
check("v1 comment", r.status === 201);
r = await call(`/api/tokens/${readTokenId}`, { method: "DELETE" });
r = await V("/feedback", readToken);
check("deleted token stops working", r.status === 401, r.status);

// --- Instance email settings -------------------------------------------------------------------------
console.log("\n— email");
r = await call("/api/admin/settings/email", { jar: memberJar });
check("non-admins cannot read instance settings", r.status === 403, r.status);
const adminJar = { cookie: "" };
const adminEmail = process.env.SMOKE_ADMIN_EMAIL ?? "smoke-admin@example.com";
const adminPassword = process.env.SMOKE_ADMIN_PASSWORD ?? "correct-horse-admin";
r = await call("/api/auth/sign-in/email", {
  method: "POST",
  json: { email: adminEmail, password: adminPassword },
  jar: adminJar,
});
if (r.status !== 200) {
  await call("/api/auth/sign-up/email", {
    method: "POST",
    json: { name: "Smoke Admin", email: adminEmail, password: adminPassword },
    jar: adminJar,
  });
  await call("/api/auth/organization/create", {
    method: "POST",
    json: { name: "Smoke Admin Org", slug: `smoke-admin-${Date.now()}` },
    jar: adminJar,
  });
}
r = await call("/api/auth/organization/list", { jar: adminJar });
if (Array.isArray(r.body) && r.body[0]) {
  await call("/api/auth/organization/set-active", {
    method: "POST",
    json: { organizationId: r.body[0].id },
    jar: adminJar,
  });
}
r = await call("/api/admin/settings/email", { jar: adminJar });
if (r.status === 403) {
  skip("instance email settings", "start the server with PINWREN_ADMIN_EMAILS=smoke-admin@example.com");
} else {
  const smtpFromEnv = r.body.email?.locked?.host;
  check("admin reads email settings", r.status === 200 && typeof r.body.email?.configured === "boolean");
  if (smtpFromEnv || r.body.email?.configured) {
    skip("email skipped when SMTP unset", "SMTP is configured on this instance");
  } else {
    r = await call("/api/admin/settings/email/test", { method: "POST", json: {}, jar: adminJar });
    check(
      "test email skipped cleanly when SMTP is unset",
      r.status === 200 && r.body.sent === false && r.body.skipped === true,
    );
    r = await call("/api/admin/settings/email", {
      method: "PATCH",
      json: { user: "smoke", password: "s3cret-smtp" },
      jar: adminJar,
    });
    check(
      "SMTP password is write-only",
      r.status === 200 &&
        r.body.email?.passwordSet === true &&
        !JSON.stringify(r.body).includes("s3cret-smtp"),
    );
    r = await call("/api/admin/settings/email", {
      method: "PATCH",
      json: { user: null, password: null },
      jar: adminJar,
    });
    check("SMTP password cleared", r.status === 200 && r.body.email?.passwordSet === false);
  }
}

// =============================================================================================
// Wave 3: panel actions, branding, email templates, privacy mode, issue sync, instance security
// =============================================================================================
const r0 = await call("/api/admin/settings/security", { jar: adminJar });
const isInstanceAdmin = r0.status === 200;
const security = r0.body.security;

// One local server plays every outside party: action/webhook receivers, a fake GitHub API (also the
// release feed for the update check — start the server with GITHUB_API_URL pointing here) and a fake
// self-managed GitLab under /gitlab. SMOKE_FAKE_API_PORT (default 4790) must match GITHUB_API_URL.
const fake = { requests: [], issues: new Map(), nextIssue: 100 };
const GH_TOKEN = "ghp_smoke_token_1234";
const GL_TOKEN = "glpat-smoke-token-5678";
const fakeServer = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => {
    body += c;
  });
  req.on("end", () => {
    const url = new URL(req.url, "http://fake");
    const entry = { method: req.method, path: url.pathname, headers: req.headers, body };
    fake.requests.push(entry);
    const json = (status, data) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(data));
    };
    const p = url.pathname;
    if (p === "/action") return json(200, { message: "Ticket ABC-1 created\nfor you" });
    if (p === "/action-fail") return json(500, { message: "Receiver is down" });
    if (p.endsWith("/releases/latest")) {
      return json(200, {
        tag_name: "v99.0.0",
        html_url: "https://github.com/Krithik-m-codes/pinwren/releases/tag/v99.0.0",
      });
    }
    const gh = /^\/repos\/([^/]+)\/([^/]+)(\/issues(?:\/(\d+))?)?$/.exec(p);
    if (gh) {
      if (req.headers.authorization !== `Bearer ${GH_TOKEN}`)
        return json(401, { message: "Bad credentials" });
      if (!gh[3]) return json(200, { full_name: `${gh[1]}/${gh[2]}` });
      if (req.method === "POST") {
        const number = fake.nextIssue++;
        fake.issues.set(`gh:${number}`, { ...JSON.parse(body), state: "open" });
        return json(201, { number, html_url: `https://github.example/${gh[1]}/${gh[2]}/issues/${number}` });
      }
      const issue = fake.issues.get(`gh:${gh[4]}`);
      if (!issue) return json(404, { message: "Not Found" });
      Object.assign(issue, JSON.parse(body));
      return json(200, { number: Number(gh[4]), state: issue.state });
    }
    const gl = /^\/gitlab\/api\/v4\/projects\/([^/]+)(\/issues(?:\/(\d+))?)?$/.exec(p);
    if (gl) {
      if (req.headers["private-token"] !== GL_TOKEN) return json(401, { message: "401 Unauthorized" });
      const path = decodeURIComponent(gl[1]);
      if (!gl[2]) return json(200, { path_with_namespace: path });
      if (req.method === "POST") {
        const iid = fake.nextIssue++;
        fake.issues.set(`gl:${iid}`, { ...JSON.parse(body), state: "opened" });
        return json(201, { iid, web_url: `https://gitlab.example/${path}/-/issues/${iid}` });
      }
      const issue = fake.issues.get(`gl:${gl[3]}`);
      if (!issue) return json(404, { message: "404 Not found" });
      const ev = JSON.parse(body).state_event;
      issue.state = ev === "close" ? "closed" : "opened";
      return json(200, { iid: Number(gl[3]), state: issue.state });
    }
    json(404, { message: "no route" });
  });
});
const fakePort = Number(process.env.SMOKE_FAKE_API_PORT ?? 4790);
const fakeUp = await new Promise((resolve) => {
  fakeServer.once("error", () => resolve(false));
  fakeServer.listen(fakePort, listenHost, () => resolve(true));
});
if (!fakeUp) await new Promise((resolve) => fakeServer.listen(0, listenHost, resolve));
const fakeBase = `http://${receiverHost}:${fakeServer.address().port}`;

try {
  // --- Panel actions (F-016) ------------------------------------------------------------------------
  console.log("\n— panel actions");
  const actions = [
    {
      id: "jira",
      label: "Create Jira ticket",
      kind: "link",
      url: "https://jira.example.com/create?summary={number}&page={url}&p={projectSlug}",
      icon: "ticket",
    },
    {
      id: "agent",
      label: "Send to agent",
      kind: "webhook",
      url: `${fakeBase}/action`,
      visibleTo: "everyone",
      icon: "bot",
    },
    { id: "broken", label: "Broken hook", kind: "webhook", url: `${fakeBase}/action-fail` },
    {
      id: "internal",
      label: "Internal docs",
      kind: "link",
      url: "https://wiki.example.com/{id}",
      visibleTo: "team",
    },
  ];
  r = await call(`/api/projects/${projectId}`, {
    method: "PATCH",
    json: { widgetConfig: { panelActions: actions } },
  });
  const savedActions = r.body.project?.widgetConfig?.panelActions ?? [];
  check(
    "panel actions saved; webhook actions forced to the team",
    r.status === 200 &&
      savedActions.length === 4 &&
      savedActions.find((a) => a.id === "agent")?.visibleTo === "team" &&
      savedActions.find((a) => a.id === "jira")?.visibleTo === "everyone",
    r.status,
  );
  check("project never returns the action secret", r.body.project && !("actionSecret" in r.body.project));
  r = await call(`/api/projects/${projectId}`, {
    method: "PATCH",
    json: {
      widgetConfig: { panelActions: [{ id: "x", label: "X", kind: "link", url: "javascript:alert(1)" }] },
    },
  });
  check(
    "javascript: action URL rejected",
    r.status === 400 && r.body.code === "INVALID_WIDGET_CONFIG",
    r.status,
  );
  r = await call(`/api/projects/${projectId}`, {
    method: "PATCH",
    json: {
      widgetConfig: {
        panelActions: [{ id: "x", label: "X", kind: "link", url: "https://x.example/{token}" }],
      },
    },
  });
  check("unknown placeholder rejected", r.status === 400, r.status);
  r = await W("/w/config");
  check(
    "widget config gets only visitor link actions (no webhook URLs)",
    r.body.widget?.panelActions?.length === 1 &&
      r.body.widget.panelActions[0].id === "jira" &&
      !JSON.stringify(r.body).includes("/action"),
  );
  check(
    "widget config carries the project slug for {projectSlug}",
    typeof r.body.project?.slug === "string" && r.body.project.slug.length > 0,
  );
  r = await call(`/api/feedback/${fid}`);
  check(
    "item detail lists every action + project slug",
    r.body.panelActions?.length === 4 && typeof r.body.feedback?.projectSlug === "string",
  );
  r = await call(`/api/projects/${projectId}/action-secret`, { jar: memberJar });
  check("members can't read the action secret", r.status === 403, r.status);
  r = await call(`/api/projects/${projectId}/action-secret`);
  const actionSecret = r.body.secret;
  check("admins reveal the action secret", r.status === 200 && actionSecret?.startsWith("whsec_"));
  const before3 = fake.requests.length;
  r = await call(`/api/feedback/${fid}/actions/agent`, { method: "POST", jar: memberJar });
  const actionReq = fake.requests.slice(before3).find((x) => x.path === "/action");
  check(
    "webhook action returns the receiver's message",
    r.status === 200 &&
      r.body.ok === true &&
      r.body.status === 200 &&
      r.body.message === "Ticket ABC-1 created for you",
    JSON.stringify(r.body),
  );
  check("webhook action is signed with the action secret", !!actionReq && verify(actionReq, actionSecret));
  const actionPayload = actionReq ? JSON.parse(actionReq.body) : {};
  check(
    "action payload carries the feedback and the action",
    actionPayload.event === "action.run" &&
      actionPayload.data?.feedback?.id === fid &&
      actionPayload.data?.action?.id === "agent",
  );
  r = await call(`/api/feedback/${fid}/actions/broken`, { method: "POST" });
  check(
    "failing receiver reported, not thrown",
    r.status === 200 && r.body.ok === false && r.body.status === 500,
  );
  r = await call(`/api/feedback/${fid}/actions/jira`, { method: "POST" });
  check("link actions don't run on the server", r.status === 400, r.status);
  r = await call(`/api/feedback/${fid}/actions/nope`, { method: "POST" });
  check("unknown action is 404", r.status === 404, r.status);
  r = await call(`/api/feedback/${fid}`);
  check(
    "action runs logged in activity",
    r.body.activity?.filter((a) => a.type === "action_run").length === 2 &&
      r.body.activity.some(
        (a) => a.type === "action_run" && a.data.ok === true && a.data.label === "Send to agent",
      ),
  );
  r = await call(`/api/projects/${projectId}/action-secret/rotate`, { method: "POST" });
  const rotated = r.body.secret;
  const before4 = fake.requests.length;
  await call(`/api/feedback/${fid}/actions/agent`, { method: "POST" });
  const afterRotate = fake.requests.slice(before4).find((x) => x.path === "/action");
  check(
    "rotated secret signs the next run",
    rotated &&
      rotated !== actionSecret &&
      !!afterRotate &&
      verify(afterRotate, rotated) &&
      !verify(afterRotate, actionSecret),
  );

  // --- Branding (F-094) ---------------------------------------------------------------------------
  console.log("\n— branding");
  r = await call("/api/branding", { jar: memberJar });
  check("members read the branding", r.status === 200 && "productName" in (r.body.branding ?? {}));
  r = await call("/api/branding", { method: "PATCH", json: { productName: "Hacked" }, jar: memberJar });
  check("members can't change the branding", r.status === 403, r.status);
  r = await call("/api/branding/assets", {
    method: "POST",
    json: { dataUrl: `data:image/svg+xml;base64,${Buffer.from("<svg onload=alert(1)>").toString("base64")}` },
  });
  check("SVG logos refused", r.status === 400, r.status);
  r = await call("/api/branding/assets", {
    method: "POST",
    json: { dataUrl: "data:image/png;base64,PHN2Zz4=" },
  });
  check("logo with fake PNG bytes refused", r.status === 400 && r.body.code === "INVALID_IMAGE", r.status);
  r = await call("/api/branding/assets", { method: "POST", json: { dataUrl: png } });
  const logo = r.body.asset;
  check("logo uploaded", r.status === 201 && logo?.url?.includes(`/api/brand-assets/${logo.id}`), r.status);
  r = await call("/api/branding", { method: "PATCH", json: { accent: "red" } });
  check("invalid accent refused", r.status === 400, r.status);
  r = await call("/api/branding", {
    method: "PATCH",
    json: { productName: "Acme Feedback", accent: "#e5484d", logoAssetId: logo?.id },
  });
  check(
    "branding saved",
    r.status === 200 &&
      r.body.branding?.productName === "Acme Feedback" &&
      r.body.branding?.accent === "#e5484d" &&
      r.body.branding?.logoUrl === logo?.url,
  );
  r = await call(`/api/brand-assets/${logo?.id}`, { jar: { cookie: "" } });
  check(
    "logo served without a session (emails, widget)",
    r.status === 200 &&
      r.headers.get("content-type") === "image/png" &&
      (r.headers.get("content-security-policy") ?? "").includes("sandbox"),
  );
  r = await call(`/api/projects/${projectId}`, {
    method: "PATCH",
    json: { widgetBranding: { hidePoweredBy: true, dialogAccent: "#112233", logoUrl: logo?.url } },
  });
  check(
    "project widget branding saved",
    r.status === 200 && r.body.project?.widgetBranding?.hidePoweredBy === true,
  );
  r = await call(`/api/projects/${projectId}`, {
    method: "PATCH",
    json: { widgetBranding: { logoUrl: "javascript:alert(1)" } },
  });
  check(
    "unsafe widget logo URL refused",
    r.status === 400 && r.body.code === "INVALID_WIDGET_BRANDING",
    r.status,
  );
  r = await W("/w/config");
  // "Hide Powered by" is Enterprise white-label (wave-4 §6): saved, but only applied with a licence
  // (checked at the end, once a licence is installed).
  check(
    "widget config carries branding (Powered by stays without white-label)",
    r.body.branding?.hidePoweredBy === false &&
      r.body.branding?.dialogAccent === "#112233" &&
      r.body.branding?.logoUrl === logo?.url,
  );

  // --- Email templates (F-020) --------------------------------------------------------------------
  console.log("\n— email templates");
  r = await call("/api/email-templates", { jar: memberJar });
  check("members can't edit email templates", r.status === 403, r.status);
  r = await call("/api/email-templates");
  const tpl = r.body.templates?.find((t) => t.key === "feedback_created");
  check(
    "templates listed with their variables",
    r.status === 200 &&
      ["feedback_created", "reporter_received", "mentioned", "digest"].every((k) =>
        r.body.templates.some((t) => t.key === k),
      ) &&
      tpl?.variables?.some((v) => v.name === "reporterName") &&
      tpl.customized === false,
  );
  r = await call("/api/email-templates/feedback_created", {
    method: "PUT",
    json: { subject: "New: {{title}}", body: "Hi {{secretToken}}" },
  });
  check("unknown variables refused", r.status === 400 && r.body.code === "UNKNOWN_VARIABLE", r.status);
  r = await call("/api/email-templates/feedback_created", {
    method: "PUT",
    json: {
      subject: "[{{productName}}] {{title}} from {{reporterName}}",
      body: "# Heads up\n\n**{{reporterName}}** wrote on [the page]({{pageUrl}}):\n\n> {{body}}\n\n<img src=x onerror=alert(1)>",
    },
  });
  check("template saved", r.status === 200 && r.body.template?.customized === true);
  r = await call("/api/email-templates/feedback_created/preview", {
    method: "POST",
    json: { variables: { reporterName: "<script>alert(1)</script>", pageUrl: "javascript:alert(2)" } },
  });
  const pv = r.body.preview ?? {};
  check(
    "preview escapes a <script> reporter name",
    r.status === 200 &&
      !pv.html?.includes("<script>") &&
      pv.html?.includes("&lt;script&gt;alert(1)&lt;/script&gt;") &&
      !pv.subject?.includes("\n"),
  );
  check(
    "preview: raw HTML in the template is text, unsafe link dropped",
    !pv.html?.includes("<img src=x") &&
      !/href="javascript/.test(pv.html ?? "") &&
      pv.html?.includes("<strong>"),
  );
  check(
    "preview uses the branding",
    pv.subject?.startsWith("[Acme Feedback]") &&
      pv.html?.includes("Sent by Acme Feedback") &&
      pv.html?.includes("#e5484d"),
  );
  r = await call("/api/email-templates/feedback_created/test", { method: "POST", json: {} });
  check("template test send answers cleanly", r.status === 200 && typeof r.body.sent === "boolean");
  r = await call("/api/email-templates/feedback_created", { method: "DELETE" });
  check(
    "reset to the default wording",
    r.status === 200 &&
      r.body.template?.customized === false &&
      r.body.template.subject === tpl?.defaultSubject,
  );

  // --- Privacy mode (F-021) -----------------------------------------------------------------------
  console.log("\n— privacy mode");
  r = await call("/api/projects", {
    method: "POST",
    json: { name: "Privacy site", allowedOrigins: ["localhost:5173"] },
  });
  const privacyProject = r.body.project;
  const PW = (path, opts = {}) =>
    call(path, {
      ...opts,
      jar: { cookie: "" },
      headers: { "x-pinwren-key": privacyProject.publicKey, origin: site, ...(opts.headers ?? {}) },
    });
  r = await call(`/api/projects/${privacyProject.id}`, {
    method: "PATCH",
    json: {
      widgetConfig: { privacyMode: true },
      captureConfig: { console: "all" },
      widgetRateLimitPerMin: 2,
    },
  });
  check(
    "privacy mode on shortens retention to 90 days",
    r.status === 200 &&
      r.body.project?.widgetConfig?.privacyMode === true &&
      r.body.project.retentionDays === 90,
  );
  r = await PW("/w/config");
  check(
    "privacy mode forces consent and caps console capture",
    r.body.widget?.consent?.enabled === true &&
      r.body.capture?.console === "errors" &&
      r.body.widget.privacyMode === true,
  );
  r = await PW("/w/feedback", {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.5" },
    json: {
      ...report,
      clientId: crypto.randomUUID(),
      screenshot: undefined,
      environment: {
        ...report.environment,
        userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/140.0.1",
      },
      metadata: { performance: { lcp: 1200 }, plan: "pro" },
      diagnostics: {
        console: [
          { level: "error", message: "TypeError", at: 1 },
          { level: "warn", message: "deprecated", at: 2 },
          { level: "log", message: "user=alice@example.com", at: 3 },
        ],
      },
    },
  });
  const pfid = r.body.feedback?.id;
  r = await call(`/api/feedback/${pfid}`);
  check(
    "server keeps only console errors",
    r.body.diagnostics?.console?.length === 1 && r.body.diagnostics.console[0].level === "error",
  );
  check(
    "server drops metadata.performance and the full user agent",
    r.body.feedback?.metadata?.plan === "pro" &&
      !("performance" in (r.body.feedback?.metadata ?? {})) &&
      r.body.feedback?.environment?.userAgent === "Chrome on Android" &&
      r.body.feedback?.environment?.browser === "Chrome",
    JSON.stringify(r.body.feedback?.environment),
  );
  if (security?.trustProxy === false) {
    skip(
      "IP truncation shares one rate-limit bucket per /24",
      "start the server with PINWREN_TRUST_PROXY=true",
    );
  } else {
    r = await PW("/w/feedback", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.99" },
      json: { ...report, clientId: crypto.randomUUID(), screenshot: undefined },
    });
    const second = r.status;
    r = await PW("/w/feedback", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.7" },
      json: { ...report, clientId: crypto.randomUUID(), screenshot: undefined },
    });
    check(
      "privacy mode truncates IPs (one /24 = one rate-limit bucket)",
      second === 201 && r.status === 429,
      `${second} ${r.status}`,
    );
  }

  // --- GitHub issue sync (F-076) ------------------------------------------------------------------
  console.log("\n— GitHub");
  const ghCreate = {
    provider: "github",
    token: GH_TOKEN,
    repo: "acme/site",
    apiUrl: fakeBase,
    labels: ["feedback"],
    autoCreate: "bugs",
  };
  r = await call(`/api/projects/${projectId}/integrations`, {
    method: "POST",
    json: ghCreate,
    jar: memberJar,
  });
  check("members can't add integrations", r.status === 403, r.status);
  r = await call(`/api/projects/${projectId}/integrations`, {
    method: "POST",
    json: { ...ghCreate, repo: "a/b/c" },
  });
  check("GitHub repo must be owner/name", r.status === 400, r.status);
  r = await call(`/api/projects/${projectId}/integrations`, { method: "POST", json: ghCreate });
  const gh = r.body.integration;
  const ghSecret = r.body.webhookSecret;
  check(
    "GitHub integration created (token hidden)",
    r.status === 201 &&
      gh?.tokenHint === `…${GH_TOKEN.slice(-4)}` &&
      !JSON.stringify(r.body).includes(GH_TOKEN),
    r.status,
  );
  r = await call(`/api/projects/${projectId}/integrations`, { method: "POST", json: ghCreate });
  check("one GitHub integration per project", r.status === 409, r.status);
  r = await call(`/api/integrations/${gh?.id}/test`, { method: "POST" });
  check(
    "test connection reaches the repository",
    r.body.ok === true && r.body.name === "acme/site",
    JSON.stringify(r.body),
  );
  r = await call(`/api/integrations/${gh?.id}/webhook-secret`);
  check(
    "webhook secret + URL revealed to admins",
    r.body.secret === ghSecret && r.body.url?.endsWith("/api/integrations/github/webhook"),
  );

  // A bug auto-creates an issue; the reporter's text is escaped in the body.
  r = await W("/w/feedback", {
    method: "POST",
    json: {
      ...report,
      clientId: crypto.randomUUID(),
      screenshot: undefined,
      body: "Pay fails <script>alert(1)</script> cc @everyone see #1",
      reporter: { name: "<img src=x onerror=alert(1)>" },
    },
  });
  const bugId = r.body.feedback?.id;
  const autoIssue = await waitFor(async () => {
    const d = await call(`/api/feedback/${bugId}`);
    return d.body.issues?.[0];
  });
  check(
    "bug auto-creates a GitHub issue (job)",
    !!autoIssue && autoIssue.provider === "github",
    autoIssue ? "" : "timeout",
  );
  const ghIssue = autoIssue ? fake.issues.get(`gh:${autoIssue.number}`) : null;
  check(
    "issue body escapes the reporter's text and links to the dashboard",
    !!ghIssue &&
      !ghIssue.body.includes("<script>") &&
      !ghIssue.body.includes("<img") &&
      !ghIssue.body.includes("@everyone") &&
      ghIssue.body.includes(`/inbox?status=all&org=`) &&
      ghIssue.body.includes(`&item=${bugId}`) &&
      !ghIssue.body.includes("/api/assets/") &&
      ghIssue.labels?.[0] === "feedback",
  );
  // Comments aren't auto-created ("bugs"); send one by hand.
  r = await call(`/api/feedback/${fid2}/issues`, {
    method: "POST",
    json: { integrationId: gh?.id },
    jar: memberJar,
  });
  const manual = r.body.issue;
  check(
    "Send to GitHub (any member)",
    r.status === 201 && manual?.url?.startsWith("https://github.example/"),
    r.status,
  );
  r = await call(`/api/feedback/${fid2}/issues`, { method: "POST", json: { integrationId: gh?.id } });
  check("sending again returns the same issue", r.body.issue?.number === manual?.number);
  r = await call(`/api/feedback/${fid2}`);
  check(
    "item detail shows the issue link and the integration",
    r.body.issues?.[0]?.url === manual?.url &&
      r.body.integrations?.some((i) => i.id === gh?.id) &&
      r.body.activity?.some((a) => a.type === "issue_linked"),
  );

  // Pinwren → GitHub: resolving closes the issue (job).
  await call(`/api/feedback/${fid2}`, { method: "PATCH", json: { status: "resolved" } });
  const closed = await waitFor(() => fake.issues.get(`gh:${manual?.number}`)?.state === "closed");
  check("resolving in Pinwren closes the GitHub issue", !!closed, closed ? "" : "timeout");

  // GitHub → Pinwren: signed webhooks reopen / close the item.
  const hook = async (payload, { secret = ghSecret, event = "issues" } = {}) => {
    const raw = JSON.stringify(payload);
    return call("/api/integrations/github/webhook", {
      method: "POST",
      jar: { cookie: "" },
      headers: {
        "content-type": "application/json",
        "x-github-event": event,
        "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`,
      },
      rawBody: raw,
    });
  };
  const reopen = {
    action: "reopened",
    issue: { number: manual?.number },
    repository: { full_name: "acme/site" },
  };
  r = await hook(reopen, { secret: "whsec_wrong" });
  check("GitHub webhook with a bad signature is rejected", r.status === 401, r.status);
  r = await call("/api/integrations/github/webhook", {
    method: "POST",
    jar: { cookie: "" },
    headers: { "content-type": "application/json", "x-github-event": "issues" },
    rawBody: JSON.stringify(reopen),
  });
  check("GitHub webhook without a signature is rejected", r.status === 401, r.status);
  r = await hook({ ...reopen, repository: { full_name: "acme/other" } });
  check("GitHub webhook for an unknown repo is rejected", r.status === 401, r.status);
  r = await hook({ zen: "hi", repository: { full_name: "acme/site" } }, { event: "ping" });
  check("GitHub ping verifies", r.status === 200 && r.body.event === "ping", r.status);
  const patchesBefore = fake.requests.filter((x) => x.method === "PATCH").length;
  r = await hook(reopen);
  check(
    "reopening the issue reopens the item",
    r.status === 200 && r.body.feedback?.status === "open",
    JSON.stringify(r.body),
  );
  r = await call(`/api/feedback/${fid2}`);
  check(
    "inbound change is written as the integration",
    r.body.feedback?.status === "open" &&
      r.body.activity?.some(
        (a) => a.type === "status_changed" && a.actorKind === "integration" && a.data.via === "github",
      ),
  );
  r = await hook({ ...reopen, action: "closed" });
  check("closing the issue resolves the item", r.status === 200 && r.body.feedback?.status === "resolved");
  await new Promise((res) => setTimeout(res, 2500));
  check(
    "inbound changes are not echoed back to GitHub",
    fake.requests.filter((x) => x.method === "PATCH").length === patchesBefore,
    JSON.stringify(fake.requests.filter((x) => x.method === "PATCH").slice(patchesBefore)),
  );
  // Replay protection (ADR 0021): a verified delivery is acted on once, by its X-GitHub-Delivery id.
  {
    const signed = (payload, deliveryId) => {
      const raw = JSON.stringify(payload);
      return call("/api/integrations/github/webhook", {
        method: "POST",
        jar: { cookie: "" },
        headers: {
          "content-type": "application/json",
          "x-github-event": "issues",
          "x-github-delivery": deliveryId,
          "x-hub-signature-256": `sha256=${createHmac("sha256", ghSecret).update(raw).digest("hex")}`,
        },
        rawBody: raw,
      });
    };
    const reopenId = crypto.randomUUID();
    r = await signed(reopen, reopenId);
    check("signed GitHub delivery acts once", r.status === 200 && r.body.feedback?.status === "open");
    r = await signed({ ...reopen, action: "closed" }, crypto.randomUUID());
    r = await signed(reopen, reopenId);
    const after = await call(`/api/feedback/${fid2}`);
    check(
      "replayed GitHub delivery (same id) is ignored",
      r.status === 200 && r.body.duplicate === true && after.body.feedback?.status === "resolved",
      JSON.stringify(r.body),
    );
  }

  // --- GitLab issue sync (F-077) ------------------------------------------------------------------
  console.log("\n— GitLab");
  r = await call(`/api/projects/${projectId}/integrations`, {
    method: "POST",
    json: {
      provider: "gitlab",
      token: "glpat-wrong-token-000",
      repo: "grp/sub/site",
      apiUrl: `${fakeBase}/gitlab`,
      labels: ["feedback", "pinwren"],
    },
  });
  const gl = r.body.integration;
  const glSecret = r.body.webhookSecret;
  check(
    "GitLab integration (self-managed URL, nested group)",
    r.status === 201 && gl?.autoCreate === "manual",
    r.status,
  );
  r = await call(`/api/integrations/${gl?.id}/test`, { method: "POST" });
  check(
    "a wrong token is reported by the connection test",
    r.body.ok === false && /token/.test(r.body.message ?? ""),
  );
  r = await call(`/api/integrations/${gl?.id}`, { method: "PATCH", json: { token: GL_TOKEN } });
  check("token replaced", r.status === 200 && r.body.integration?.tokenHint === `…${GL_TOKEN.slice(-4)}`);
  r = await call(`/api/feedback/${fid3}/issues`, { method: "POST", json: { integrationId: gl?.id } });
  const glIssue = r.body.issue;
  const glStored = glIssue ? fake.issues.get(`gl:${glIssue.number}`) : null;
  check(
    "Send to GitLab",
    r.status === 201 && glIssue?.provider === "gitlab" && glStored?.labels === "feedback,pinwren",
    r.status,
  );
  const glHook = (payload, token = glSecret) =>
    call("/api/integrations/gitlab/webhook", {
      method: "POST",
      jar: { cookie: "" },
      headers: {
        "content-type": "application/json",
        "x-gitlab-token": token,
        "x-gitlab-event": "Issue Hook",
      },
      rawBody: JSON.stringify(payload),
    });
  const glClose = {
    object_kind: "issue",
    project: { path_with_namespace: "grp/sub/site" },
    object_attributes: { iid: glIssue?.number, action: "close" },
  };
  r = await glHook(glClose, "not-the-secret");
  check("GitLab webhook with a wrong X-Gitlab-Token is rejected", r.status === 401, r.status);
  r = await glHook(glClose);
  check(
    "closing the GitLab issue resolves the item",
    r.status === 200 && r.body.feedback?.status === "resolved",
  );
  await call(`/api/feedback/${fid3}`, { method: "PATCH", json: { status: "open" } });
  const glReopened = await waitFor(() => fake.issues.get(`gl:${glIssue?.number}`)?.state === "opened");
  check("reopening in Pinwren reopens the GitLab issue", !!glReopened, glReopened ? "" : "timeout");

  // --- Instance security ----------------------------------------------------------------------------
  console.log("\n— instance security");
  r = await call("/api/admin/settings/security", { jar: memberJar });
  check("members can't read security settings", r.status === 403, r.status);
  if (!isInstanceAdmin) {
    skip(
      "security settings, update check",
      "start the server with PINWREN_ADMIN_EMAILS=smoke-admin@example.com",
    );
  } else {
    check(
      "admin reads security settings",
      typeof security.sessionDays === "number" && "enforceHttps" in security,
    );
    if (security.locked.sessionDays) {
      skip("session lifetime", "PINWREN_SESSION_DAYS locks it");
    } else {
      r = await call("/api/admin/settings/security", {
        method: "PATCH",
        json: { sessionDays: 0 },
        jar: adminJar,
      });
      check("session lifetime must be 1–90 days", r.status === 400, r.status);
      r = await call("/api/admin/settings/security", {
        method: "PATCH",
        json: { sessionDays: 2 },
        jar: adminJar,
      });
      check("session lifetime saved", r.status === 200 && r.body.security?.sessionDays === 2);
      const fresh = { cookie: "" };
      await call("/api/auth/sign-in/email", {
        method: "POST",
        json: { email, password: "correct-horse-1" },
        jar: fresh,
      });
      r = await call("/api/auth/get-session", { jar: fresh });
      const ttlDays = (new Date(r.body?.session?.expiresAt).getTime() - Date.now()) / 86_400_000;
      check("new sessions get the configured lifetime", ttlDays > 1.9 && ttlDays <= 2.01, ttlDays.toFixed(3));
      await call("/api/admin/settings/security", {
        method: "PATCH",
        json: { sessionDays: security.sessionDays },
        jar: adminJar,
      });
    }

    // Update check: skipped while any project uses privacy mode, then reads the (fake) release feed.
    r = await call("/api/admin/update-check", { method: "POST", jar: adminJar });
    check(
      "update check is off while a project uses privacy mode",
      r.body.checked === false && r.body.reason === "privacy_mode",
      JSON.stringify(r.body),
    );
    await call(`/api/projects/${privacyProject.id}`, { method: "PATCH", json: { archived: true } });
    r = await call("/api/admin/settings/security", { jar: adminJar });
    if (r.body.security?.privacyModeProjects > 0) {
      skip("update available", "another project on this instance uses privacy mode");
    } else if (!security.updateCheck) {
      skip("update available", "update check switched off on this instance");
    } else {
      r = await call("/api/admin/update-check", { method: "POST", jar: adminJar });
      if (r.body.state?.error) {
        skip(
          "update available",
          `release feed unreachable (${r.body.state.error}); set GITHUB_API_URL=${fakeBase}`,
        );
      } else {
        check(
          "update check reads the latest release",
          r.body.checked === true && r.body.state?.latest === "v99.0.0",
        );
        r = await call("/api/me", { jar: adminJar });
        check(
          "instance admins see Update available",
          r.body.instanceAdmin === true && r.body.update?.latest === "v99.0.0",
        );
        r = await call("/api/me");
        check("non-admins don't", r.body.update === null);
      }
    }

    // HTTPS enforcement: forwarded headers count only behind a trusted proxy.
    if (!security.trustProxy) {
      skip("HTTPS enforcement", "start the server with PINWREN_TRUST_PROXY=true");
    } else {
      const fwd = (proto) => ({ "x-forwarded-proto": proto, "x-forwarded-host": "feedback.example.com" });
      if (security.enforceHttps) {
        r = await call("/api/health", { headers: fwd("http"), jar: { cookie: "" } });
        check(
          "HTTPS on: plain-HTTP GET redirects to https",
          r.status === 308 && r.headers.get("location") === "https://feedback.example.com/api/health",
          r.status,
        );
        r = await call("/inbox", { headers: fwd("http"), jar: { cookie: "" } });
        check("HTTPS on: pages redirect too", r.status === 308, r.status);
        r = await call("/api/auth/sign-in/email", {
          method: "POST",
          headers: fwd("http"),
          json: { email, password: "x" },
          jar: { cookie: "" },
        });
        check(
          "HTTPS on: plain-HTTP POST refused",
          r.status === 403 && r.body.code === "HTTPS_REQUIRED",
          r.status,
        );
        r = await call("/api/health", { headers: fwd("https"), jar: { cookie: "" } });
        check(
          "HTTPS on: https requests pass with HSTS",
          r.status === 200 && (r.headers.get("strict-transport-security") ?? "").includes("max-age="),
        );
        r = await call("/api/health", { jar: { cookie: "" } });
        check("HTTPS on: localhost stays reachable", r.status === 200);
      } else {
        r = await call("/api/health", { headers: fwd("http"), jar: { cookie: "" } });
        check(
          "HTTPS off: plain HTTP is served, no HSTS",
          r.status === 200 && !r.headers.get("strict-transport-security"),
          r.status,
        );
      }
    }
  }
} finally {
  fakeServer.close();
}

// =============================================================================================
// Wave 4: real time, rounds + views, replay, identity, URL patterns, viewer role, SDK/MCP/CLI,
// consent, unsubscribe, licences (docs/contracts/wave-4.md)
// =============================================================================================
const root = fileURLToPath(new URL("..", import.meta.url));
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const w4report = (extra = {}) => ({
  ...report,
  clientId: crypto.randomUUID(),
  screenshot: undefined,
  diagnostics: undefined,
  reporter: undefined,
  ...extra,
});

/** Read an SSE stream into `events` until closed. */
async function openStream(jar, query = "", headers = {}) {
  const ctrl = new AbortController();
  const res = await fetch(`${B}/api/stream${query}`, {
    headers: { cookie: jar.cookie, accept: "text/event-stream", ...headers },
    signal: ctrl.signal,
  });
  const events = [];
  if (res.ok && res.body) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = {};
            for (const line of chunk.split("\n")) {
              const m = /^(\w+): ?(.*)$/.exec(line);
              if (m) ev[m[1]] = ev[m[1]] === undefined ? m[2] : `${ev[m[1]]}\n${m[2]}`;
            }
            if (ev.event)
              events.push({ event: ev.event, id: ev.id, data: JSON.parse(ev.data ?? "{}"), at: Date.now() });
          }
        }
      } catch {
        // aborted
      }
    })();
  }
  return {
    status: res.status,
    type: res.headers.get("content-type") ?? "",
    events,
    close: () => ctrl.abort(),
  };
}

console.log("\n— wave 4: health + real time");
// Wave 4 files many reports from one IP: lift the per-minute widget limit for the test project.
await call(`/api/projects/${projectId}`, { method: "PATCH", json: { widgetRateLimitPerMin: 1000 } });
r = await call("/api/health");
check("health reports the version", r.body.ok === true && typeof r.body.version === "string");

const otherProject = (
  await call("/api/projects", {
    method: "POST",
    json: { name: "Second site", allowedOrigins: ["localhost:5173"] },
  })
).body.project;
const stream = await openStream(mainJar);
check("SSE stream opens", stream.status === 200 && stream.type.includes("text/event-stream"), stream.status);
const scoped = await openStream(mainJar, `?projectIds=${otherProject.id}`);
await waitFor(
  () => stream.events.some((e) => e.event === "ping") && scoped.events.some((e) => e.event === "ping"),
  10_000,
);
check(
  "stream sends a ping at once",
  stream.events.some((e) => e.event === "ping"),
);
r = await call(`/api/stream?projectIds=${crypto.randomUUID()}`);
check("stream refuses another org's project", r.status === 404, r.status);

const t0 = Date.now();
r = await W("/w/feedback", { method: "POST", json: w4report({ body: "Realtime check", kind: "comment" }) });
const rtId = r.body.feedback?.id;
const created4 = await waitFor(
  () => stream.events.find((e) => e.event === "feedback.created" && e.data.id === rtId),
  5_000,
);
check(
  "feedback.created reaches the stream within 2 s of a widget submit",
  !!created4 && created4.at - t0 < 2_000 && created4.data.number > 0 && created4.data.projectId === projectId,
  created4 ? `${created4.at - t0} ms` : "timeout",
);
check(
  "stream scoped to another project doesn't get it",
  !scoped.events.some((e) => e.event === "feedback.created" && e.data.id === rtId),
);
const createdEventId = created4?.id;
await call(`/api/feedback/${rtId}`, { method: "PATCH", json: { status: "in_progress" } });
const upd = await waitFor(
  () => stream.events.find((e) => e.event === "feedback.updated" && e.data.id === rtId),
  5_000,
);
check("feedback.updated carries the change", upd?.data.changes?.status?.to === "in_progress");
await call(`/api/feedback/${rtId}/comments`, {
  method: "POST",
  json: { body: "On it", visibility: "internal" },
});
const cmt = await waitFor(
  () => stream.events.find((e) => e.event === "comment.created" && e.data.feedbackId === rtId),
  5_000,
);
check(
  "comment.created on the stream",
  cmt?.data.visibility === "internal" && cmt.data.authorName === "Smoke Tester",
);

r = await call("/api/presence", { method: "POST", json: { feedbackId: rtId }, jar: memberJar });
check("presence heartbeat accepted", r.status === 200, r.status);
const here = await waitFor(
  () =>
    stream.events.find(
      (e) =>
        e.event === "presence" && e.data.feedbackId === rtId && e.data.users.some((u) => u.id === memberId),
    ),
  5_000,
);
check("presence event lists who is viewing", !!here && here.data.users[0]?.name === "Smoke Member");
r = await call("/api/presence", { method: "POST", json: { feedbackId: null }, jar: memberJar });
const gone = await waitFor(
  () =>
    stream.events.find(
      (e) => e.event === "presence" && e.data.feedbackId === rtId && e.data.users.length === 0,
    ),
  5_000,
);
check("leaving clears presence", !!gone);
r = await call("/api/presence", { method: "POST", json: { feedbackId: crypto.randomUUID() } });
check("presence on an unknown item is 404", r.status === 404, r.status);

const resumed = await openStream(mainJar, "", { "last-event-id": createdEventId ?? "" });
await waitFor(() => resumed.events.some((e) => e.event === "feedback.updated" && e.data.id === rtId), 5_000);
check(
  "Last-Event-ID replays what came after",
  resumed.events.some((e) => e.event === "feedback.updated" && e.data.id === rtId) &&
    !resumed.events.some((e) => e.event === "feedback.created" && e.data.id === rtId),
);
resumed.close();
r = await W("/w/feedback", { method: "POST", json: w4report({ body: "Delete me" }) });
const delId = r.body.feedback?.id;
await call(`/api/feedback/${delId}`, { method: "DELETE" });
check(
  "feedback.deleted on the stream",
  !!(await waitFor(
    () => stream.events.find((e) => e.event === "feedback.deleted" && e.data.id === delId),
    5_000,
  )),
);
stream.close();
scoped.close();

// --- Rounds + views -------------------------------------------------------------------------------
console.log("\n— wave 4: review rounds + saved views");
r = await call(`/api/projects/${projectId}/rounds`, {
  method: "POST",
  json: { name: "Sprint 1", dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString() },
});
check("create a review round", r.status === 201 && r.body.round?.status === "active", r.status);
const round1 = r.body.round;
r = await W("/w/config");
check(
  "/w/config names the active round",
  r.body.activeRound?.id === round1?.id && r.body.activeRound.name === "Sprint 1",
);
r = await W("/w/feedback", {
  method: "POST",
  json: w4report({ body: '=HYPERLINK("http://evil.example","x") (paren) back\\slash ünïcode ✓' }),
});
const inRound = r.body.feedback?.id;
r = await call(`/api/feedback/${inRound}`);
check("ingest defaults to the active round", r.body.feedback?.roundId === round1?.id);
r = await call(`/api/projects/${projectId}/rounds`, { method: "POST", json: { name: "Sprint 2" } });
const round2 = r.body.round;
r = await W("/w/config");
check("two active rounds: no default", r.body.activeRound === null);
r = await W("/w/feedback", { method: "POST", json: w4report({ roundId: round2?.id }) });
const inRound2 = r.body.feedback?.id;
r = await call(`/api/feedback/${inRound2}`);
check("ingest honours roundId", r.body.feedback?.roundId === round2?.id);
r = await call(`/api/projects/${otherProject.id}/rounds`, { method: "POST", json: { name: "Elsewhere" } });
const foreignRound = r.body.round;
r = await call(`/api/feedback/${inRound2}`, { method: "PATCH", json: { roundId: foreignRound?.id } });
check(
  "moving into another project's round is refused",
  r.status === 400 && r.body.code === "INVALID_ROUND",
  r.status,
);
r = await call(`/api/feedback/${inRound2}`, { method: "PATCH", json: { roundId: round1?.id } });
check("PATCH feedback roundId", r.status === 200 && r.body.feedback?.roundId === round1?.id);
r = await call(`/api/feedback?status=all&roundId=${round1?.id}`);
check(
  "list filters by round",
  r.status === 200 && r.body.items.length === 2 && r.body.items.every((i) => i.roundId === round1?.id),
  r.body.items?.length,
);
r = await call(`/api/projects/${projectId}/rounds`);
const listed = r.body.rounds?.find((x) => x.id === round1?.id);
check(
  "rounds list with counts",
  listed?.counts?.total === 2 && listed.counts.open === 2,
  JSON.stringify(listed?.counts),
);
r = await call(`/api/rounds/${round2?.id}`, {
  method: "PATCH",
  json: { status: "closed", name: "Sprint 2 (done)" },
});
check("close a round", r.status === 200 && r.body.round?.status === "closed" && !!r.body.round.closedAt);
r = await W("/w/config");
check("one active round again", r.body.activeRound?.id === round1?.id);
const csvRes = await fetch(`${B}/api/rounds/${round1?.id}/export?format=csv`, {
  headers: { cookie: mainJar.cookie },
});
const csv = await csvRes.text();
check(
  "CSV export",
  csvRes.status === 200 &&
    (csvRes.headers.get("content-type") ?? "").startsWith("text/csv") &&
    (csvRes.headers.get("content-disposition") ?? "").startsWith("attachment") &&
    csv.includes("number,kind,status"),
);
check(
  "CSV neutralises formulas",
  csv.includes(`"'=HYPERLINK(""http://evil.example""`) && !/(^|,)=HYPERLINK/m.test(csv),
);
const pdfRes = await fetch(`${B}/api/rounds/${round1?.id}/export?format=pdf`, {
  headers: { cookie: mainJar.cookie },
});
const pdfBytes = Buffer.from(await pdfRes.arrayBuffer());
const pdfText = pdfBytes.toString("latin1");
check(
  "PDF export starts with %PDF",
  pdfRes.status === 200 &&
    pdfRes.headers.get("content-type") === "application/pdf" &&
    pdfText.startsWith("%PDF-") &&
    pdfText.trimEnd().endsWith("%%EOF"),
  pdfRes.status,
);
check(
  "PDF escapes untrusted text",
  pdfText.includes("\\(paren\\) back\\\\slash") && pdfText.includes("Sprint 1"),
);
r = await call(`/api/rounds/${round2?.id}`, { method: "DELETE" });
check("delete a round", r.status === 204, r.status);
r = await call(`/api/rounds/${round2?.id}`);
check("deleted round is gone", r.status === 404, r.status);
r = await call(`/api/rounds/${round1?.id}/export?format=docx`);
check("unknown export format refused", r.status === 400, r.status);

r = await call("/api/views", {
  method: "POST",
  json: {
    name: "Open bugs",
    filters: { status: "open", kind: "bug", projectId },
    layout: "board",
    shared: true,
  },
});
check(
  "create a shared view",
  r.status === 201 && r.body.view?.layout === "board" && r.body.view.mine === true,
  r.status,
);
const sharedView = r.body.view;
r = await call("/api/views", { method: "POST", json: { name: "Mine only", filters: { q: "checkout" } } });
const personalView = r.body.view;
r = await call("/api/views", { jar: memberJar });
check(
  "members see shared views, not others' personal ones",
  r.body.views?.some((v) => v.id === sharedView?.id) && !r.body.views.some((v) => v.id === personalView?.id),
);
r = await call(`/api/views/${sharedView?.id}`, {
  method: "PATCH",
  json: { name: "Hijacked" },
  jar: memberJar,
});
check("only the owner (or an admin) edits a shared view", r.status === 403, r.status);
r = await call(`/api/views/${personalView?.id}`, { method: "PATCH", json: { name: "Peek" }, jar: memberJar });
check("others' personal views are invisible", r.status === 404, r.status);
r = await call(`/api/views/${sharedView?.id}`, {
  method: "PATCH",
  json: { filters: { status: "all" }, layout: "list" },
});
check(
  "owner edits a view",
  r.status === 200 && r.body.view?.filters?.status === "all" && r.body.view.layout === "list",
);
r = await call("/api/views", { method: "POST", json: { name: "Bad", filters: { status: "nope" } } });
check("view filters are validated", r.status === 400, r.status);
r = await call(`/api/views/${personalView?.id}`, { method: "DELETE" });
check("delete a view", r.status === 204, r.status);

// --- Session replay ---------------------------------------------------------------------------------
console.log("\n— wave 4: session replay");
const now4 = Date.now();
const rrweb = [
  { type: 4, timestamp: now4, data: { href: `${site}/checkout`, width: 390, height: 844 } },
  {
    type: 2,
    timestamp: now4 + 10,
    data: {
      node: {
        type: 0,
        id: 1,
        childNodes: [
          {
            type: 2,
            id: 2,
            tagName: "button",
            attributes: { id: "pay" },
            childNodes: [{ type: 3, id: 3, textContent: "Pay <now>" }],
          },
        ],
      },
    },
  },
  { type: 3, timestamp: now4 + 1500, data: { source: 2, type: 2, id: 2 } },
];
const replayGz = gzipSync(Buffer.from(JSON.stringify(rrweb)));
const replay = {
  dataUrl: `data:application/gzip;base64,${replayGz.toString("base64")}`,
  durationMs: 1500,
  events: 3,
};
r = await W("/w/feedback", { method: "POST", json: w4report({ replay }) });
const noReplay = r.body.feedback?.id;
r = await call(`/api/feedback/${noReplay}`);
check("replay ignored while the project doesn't record replays", r.body.assets?.length === 0);
r = await call(`/api/projects/${projectId}`, {
  method: "PATCH",
  json: { captureConfig: { replay: { enabled: true, seconds: 90 } } },
});
check("enable replay capture", r.body.project?.captureConfig?.replay?.seconds === 90);
r = await W("/w/config");
check(
  "/w/config carries capture.replay",
  r.body.capture?.replay?.enabled === true && r.body.capture.replay.seconds === 90,
);
r = await call(`/api/projects/${projectId}`, {
  method: "PATCH",
  json: { captureConfig: { replay: { seconds: 500 } } },
});
check(
  "replay seconds stay within 30..120",
  r.status === 400 && r.body.code === "INVALID_CAPTURE_CONFIG",
  r.status,
);
r = await W("/w/feedback", {
  method: "POST",
  json: w4report({
    replay,
    body: "Pay button broken",
    diagnostics: {
      console: [{ level: "error", message: "TypeError: pay is not a function", at: now4 + 1600 }],
      network: [{ method: "POST", url: "/api/pay", status: 500, durationMs: 120, at: now4 + 1550 }],
    },
  }),
});
check("report with a replay accepted", r.status === 201, r.status);
const replayFid = r.body.feedback?.id;
r = await call(`/api/feedback/${replayFid}`);
const replayAsset = r.body.assets?.find((a) => a.kind === "replay");
check(
  "replay stored as an asset with its facts",
  replayAsset?.contentType === "application/gzip" &&
    replayAsset.meta?.durationMs === 1500 &&
    replayAsset.meta.events === 3,
);
const replayRes = await fetch(`${B}/api/assets/${replayAsset?.id}`, { headers: { cookie: mainJar.cookie } });
const replayBack = Buffer.from(await replayRes.arrayBuffer());
check("replay served back as gzip rrweb events", JSON.parse(gunzipSync(replayBack).toString()).length === 3);
r = await call("/api/feedback?status=all&limit=100");
check("list marks hasReplay", r.body.items?.find((i) => i.id === replayFid)?.hasReplay === true);
r = await W("/w/feedback", {
  method: "POST",
  json: w4report({
    replay: {
      ...replay,
      dataUrl: `data:application/gzip;base64,${Buffer.from("not gzip").toString("base64")}`,
    },
  }),
});
check("replay that isn't gzip refused", r.status === 400 && r.body.code === "INVALID_REPLAY", r.status);
const big = Buffer.alloc(10 * 1024 * 1024 + 1);
big[0] = 0x1f;
big[1] = 0x8b;
big[2] = 0x08;
r = await W("/w/feedback", {
  method: "POST",
  json: w4report({
    replay: { ...replay, dataUrl: `data:application/gzip;base64,${big.toString("base64")}` },
  }),
});
// The API answers 400 INVALID_REPLAY; until next.config raises middlewareClientMaxBodySize, Next's
// proxy cuts bodies at 10 MB first and the truncated JSON is a 400 as well.
check(
  "replay over 10 MB refused",
  r.status === 400 && (r.body.code === "INVALID_REPLAY" || r.body.code === "HTTP_ERROR"),
  `${r.status} ${r.body.code}`,
);

// --- Consent, identity, URL patterns ----------------------------------------------------------------
console.log("\n— wave 4: consent, signed identity, URL patterns");
r = await W("/w/feedback", {
  method: "POST",
  json: w4report({ consent: { version: "privacy-v3", acceptedAt: new Date().toISOString() } }),
});
r = await call(`/api/feedback/${r.body.feedback?.id}`);
check("consent record stored on the feedback", r.body.feedback?.consent?.version === "privacy-v3");
r = await call(`/api/projects/${projectId}/identity-secret`, { jar: memberJar });
check("members can't read the identity secret", r.status === 403, r.status);
r = await call(`/api/projects/${projectId}/identity-secret`);
const idSecret = r.body.secret;
check("identity secret created on first read", r.status === 200 && idSecret?.startsWith("idsec_"));
r = await call(`/api/projects/${projectId}/identity-secret`);
check("identity secret is stable", r.body.secret === idSecret);
const signId = (secret, id) => createHmac("sha256", secret).update(id).digest("hex");
const identified = (signature) =>
  W("/w/feedback", {
    method: "POST",
    json: w4report({
      reporter: { externalId: "user-42", name: "Signed Sam", email: "sam@example.com", signature },
    }),
  });
r = await identified(signId(idSecret, "user-42"));
const signedFid = r.body.feedback?.id;
r = await call(`/api/feedback/${signedFid}`);
check(
  "valid signature marks the reporter verified (signature not stored)",
  r.body.feedback?.reporterGuest?.verified === true &&
    !JSON.stringify(r.body).includes(signId(idSecret, "user-42")),
);
r = await W(`/w/feedback/${signedFid}/comments`, {
  method: "POST",
  json: {
    body: "Signed reply",
    author: { name: "Signed Sam", externalId: "user-42", signature: signId(idSecret, "user-42") },
  },
});
check(
  "signed widget reply is verified",
  r.status === 201 && r.body.comment?.authorVerified === true,
  r.status,
);
r = await W(`/w/feedback/${signedFid}/comments`);
check(
  "thread shows the verified reply",
  r.body.items?.some((c) => c.body === "Signed reply" && c.authorVerified === true),
);
r = await identified(signId(idSecret, "user-43"));
r = await call(`/api/feedback/${r.body.feedback?.id}`);
check("signature for another id: not verified", r.body.feedback?.reporterGuest?.verified === false);
r = await call(`/api/projects/${projectId}/identity-secret/rotate`, { method: "POST" });
check("rotate the identity secret", r.status === 200 && r.body.secret !== idSecret);
r = await identified(signId(idSecret, "user-42"));
r = await call(`/api/feedback/${r.body.feedback?.id}`);
check("old secret stops verifying after rotation", r.body.feedback?.reporterGuest?.verified === false);

for (const [path, pattern] of [
  ["/product/1", "/product/:id"],
  ["/product/2?color=red", "/product/:id"],
  ["/about", undefined],
]) {
  await W("/w/feedback", {
    method: "POST",
    json: w4report({
      kind: "comment",
      page: { url: `${site}${path}`, ...(pattern ? { urlPattern: pattern } : {}) },
    }),
  });
}
await W("/w/feedback", {
  method: "POST",
  json: w4report({ kind: "comment", page: { url: `${site}/product/3` } }),
});
r = await W(`/w/feedback?urlPattern=${encodeURIComponent("/product/:id")}`);
const patternUrls = (r.body.items ?? []).map((i) => i.pageUrl);
check(
  "pins by URL pattern group every matching page",
  r.status === 200 &&
    patternUrls.some((u) => u.includes("/product/1")) &&
    patternUrls.some((u) => u.includes("/product/2")) &&
    patternUrls.some((u) => u.includes("/product/3")) &&
    !patternUrls.some((u) => u.includes("/about")),
  patternUrls.length,
);
r = await W(`/w/feedback?urlPattern=${encodeURIComponent("/blog/*")}`);
check("pattern with no pages: no pins", r.status === 200 && r.body.items.length === 0);
r = await W(`/w/feedback?url=${encodeURIComponent(`${site}/checkout?b=2&a=1`)}`);
check("plain url pins still work", r.status === 200 && Array.isArray(r.body.items));

// --- Viewer role ----------------------------------------------------------------------------------------
console.log("\n— wave 4: viewer role");
const viewerEmail = `smoke-viewer+${Date.now()}@example.com`;
r = await call("/api/auth/organization/invite-member", {
  method: "POST",
  json: { email: viewerEmail, role: "viewer" },
});
check("invite a viewer", r.status === 200, r.status);
const viewerJar = { cookie: "" };
await call("/api/auth/sign-up/email", {
  method: "POST",
  json: { name: "Smoke Viewer", email: viewerEmail, password: "correct-horse-3" },
  jar: viewerJar,
});
await call("/api/auth/organization/accept-invitation", {
  method: "POST",
  json: { invitationId: r.body?.id },
  jar: viewerJar,
});
await call("/api/auth/organization/set-active", {
  method: "POST",
  json: { organizationId: orgId },
  jar: viewerJar,
});
r = await call("/api/me", { jar: viewerJar });
check("viewer reaches the dashboard", r.status === 200 && r.body.role === "viewer");
r = await call("/api/feedback?status=all", { jar: viewerJar });
check("viewer reads the inbox (200)", r.status === 200 && r.body.items.length > 0);
r = await call(`/api/feedback/${fid}`, { jar: viewerJar });
check("viewer reads an item (200)", r.status === 200);
r = await call(`/api/projects/${projectId}/rounds`, { jar: viewerJar });
check("viewer reads rounds (200)", r.status === 200);
r = await call(`/api/feedback/${fid}`, { method: "PATCH", json: { status: "open" }, jar: viewerJar });
check(
  "viewer can't change an item (403 READ_ONLY_ROLE)",
  r.status === 403 && r.body.code === "READ_ONLY_ROLE",
  r.status,
);
r = await call(`/api/feedback/${fid}/comments`, { method: "POST", json: { body: "hi" }, jar: viewerJar });
check("viewer can't comment", r.status === 403 && r.body.code === "READ_ONLY_ROLE", r.status);
r = await call(`/api/projects/${projectId}/rounds`, { method: "POST", json: { name: "x" }, jar: viewerJar });
check("viewer can't create rounds", r.status === 403 && r.body.code === "READ_ONLY_ROLE", r.status);
r = await call("/api/projects", { method: "POST", json: { name: "x" }, jar: viewerJar });
check("viewer can't create projects", r.status === 403 && r.body.code === "READ_ONLY_ROLE", r.status);
r = await call("/api/views", { method: "POST", json: { name: "x", shared: true }, jar: viewerJar });
check("viewer can't share a view", r.status === 403 && r.body.code === "READ_ONLY_ROLE", r.status);
r = await call("/api/views", { method: "POST", json: { name: "My view" }, jar: viewerJar });
check("viewer keeps personal views", r.status === 201, r.status);
r = await call("/api/presence", { method: "POST", json: { feedbackId: fid }, jar: viewerJar });
check("viewer shows up in presence", r.status === 200, r.status);
r = await call("/api/tokens", {
  method: "POST",
  json: { name: "viewer", scopes: ["feedback:read", "feedback:write", "comments:write"] },
  jar: viewerJar,
});
const viewerToken = r.body.secret;
r = await V(`/feedback/${fid}`, viewerToken);
check("viewer token reads (200)", r.status === 200, r.status);
r = await V(`/feedback/${fid}`, viewerToken, { method: "PATCH", json: { status: "open" } });
check(
  "viewer token can't write, whatever its scopes",
  r.status === 403 && r.body.code === "READ_ONLY_ROLE",
  r.status,
);

// --- SDK, MCP, CLI against the live server --------------------------------------------------------------
console.log("\n— wave 4: SDK, MCP, CLI");
const reqMcp = createRequire(join(root, "packages/mcp/package.json"));
const sdkDist = join(root, "packages/sdk/dist/index.js");
const mcpCli = join(root, "packages/mcp/dist/cli.js");
const pinwrenCli = join(root, "packages/cli/dist/cli.js");
if (process.env.SMOKE_SKIP_PACKAGES === "1") {
  // Running from a Linux container against a Windows checkout: pnpm's node_modules links don't resolve
  // there. Run this section from the host instead.
  skip("SDK / MCP / CLI", "SMOKE_SKIP_PACKAGES=1");
} else if (!existsSync(sdkDist) || !existsSync(mcpCli) || !existsSync(pinwrenCli)) {
  skip(
    "SDK / MCP / CLI",
    "build them first: pnpm --filter @pinwren/sdk --filter @pinwren/mcp --filter @pinwren/cli build",
  );
} else {
  const { Pinwren, PinwrenError } = await import(pathToFileURL(sdkDist).href);
  const pw = new Pinwren({ url: B, token: writeToken });
  const projects = await pw.projects.list();
  check(
    "SDK lists projects with open counts",
    projects.some((p) => p.id === projectId && typeof p.openCount === "number"),
  );
  const page1 = await pw.feedback.list({ projectId, status: "all", limit: 2 });
  check("SDK lists feedback with a cursor", page1.items.length === 2 && typeof page1.nextCursor === "string");
  let n = 0;
  for await (const _ of pw.feedback.iterate({ projectId, status: "all", limit: 5 })) n++;
  check("SDK iterates every page", n > 5, n);
  const detail = await pw.feedback.get(replayFid);
  check(
    "SDK gets an item with its assets",
    detail.feedback.id === replayFid && detail.assets.some((a) => a.kind === "replay"),
  );
  const updated = await pw.feedback.update(replayFid, { priority: "urgent" });
  check("SDK updates", updated.priority === "urgent");
  const repro = await pw.feedback.reproduction(replayFid);
  check(
    "reproduction context from replay + diagnostics",
    repro.replay?.summarized === true &&
      repro.markdown.includes('Clicked button\\#pay "Pay \\<now\\>"') &&
      repro.markdown.includes("Request failed: POST /api/pay → 500") &&
      repro.markdown.includes("Console error: TypeError") &&
      repro.steps.findIndex((s) => s.kind === "click") < repro.steps.findIndex((s) => s.kind === "network"),
    repro.markdown.slice(0, 120),
  );
  const rounds4 = await pw.rounds.list(projectId);
  check(
    "SDK lists rounds",
    rounds4.some((x) => x.id === round1?.id),
  );
  const asset = await pw.assets.get(replayAsset?.id);
  check(
    "SDK downloads assets",
    asset.contentType === "application/gzip" && asset.bytes.length === replayGz.length,
  );
  const err = await new Pinwren({ url: B, token: readToken }).feedback.list().catch((e) => e);
  check(
    "SDK raises PinwrenError",
    err instanceof PinwrenError && err.status === 401 && err.code === "INVALID_TOKEN",
  );

  // MCP over Streamable HTTP at /mcp, with the official client.
  const { Client } = await import(
    pathToFileURL(reqMcp.resolve("@modelcontextprotocol/sdk/client/index.js")).href
  );
  const { StreamableHTTPClientTransport } = await import(
    pathToFileURL(reqMcp.resolve("@modelcontextprotocol/sdk/client/streamableHttp.js")).href
  );
  const { StdioClientTransport } = await import(
    pathToFileURL(reqMcp.resolve("@modelcontextprotocol/sdk/client/stdio.js")).href
  );
  const mcpText = (res) => res.content?.map((c) => c.text).join("") ?? "";
  r = await call("/mcp", {
    method: "POST",
    json: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    jar: { cookie: "" },
  });
  check("/mcp needs a token", r.status === 401 && r.body.code === "INVALID_TOKEN", r.status);
  r = await call("/mcp", {
    method: "POST",
    json: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    headers: { authorization: `Bearer ${writeToken.slice(0, -3)}xyz` },
    jar: { cookie: "" },
  });
  check("/mcp refuses a wrong token", r.status === 401, r.status);
  const http = new Client({ name: "smoke", version: "1.0.0" });
  await http.connect(
    new StreamableHTTPClientTransport(new URL(`${B}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${writeToken}` } },
    }),
  );
  const tools = (await http.listTools()).tools.map((t) => t.name).sort();
  check(
    "MCP (HTTP) exposes the 7 tools",
    JSON.stringify(tools) ===
      JSON.stringify(
        [
          "add_comment",
          "get_feedback",
          "get_reproduction_context",
          "list_projects",
          "resolve_feedback",
          "search_feedback",
          "update_feedback",
        ].sort(),
      ),
    tools.join(","),
  );
  let res = await http.callTool({ name: "list_projects", arguments: {} });
  check(
    "MCP list_projects",
    JSON.parse(mcpText(res)).some((p) => p.id === projectId),
  );
  res = await http.callTool({
    name: "search_feedback",
    arguments: { projectId, status: "all", text: "Pay button", limit: 5 },
  });
  check(
    "MCP search_feedback",
    JSON.parse(mcpText(res)).items.some((i) => i.id === replayFid),
  );
  res = await http.callTool({ name: "get_feedback", arguments: { id: replayFid } });
  const got = JSON.parse(mcpText(res));
  check(
    "MCP get_feedback: thread, errors, asset URLs",
    got.id === replayFid &&
      got.console.length === 1 &&
      got.failingRequests.length === 1 &&
      got.assets[0]?.url.includes("/api/v1/assets/"),
  );
  res = await http.callTool({ name: "get_reproduction_context", arguments: { id: replayFid } });
  check(
    "MCP get_reproduction_context is Markdown",
    mcpText(res).startsWith("# Reproduce #") && mcpText(res).includes("## Steps"),
  );
  res = await http.callTool({ name: "add_comment", arguments: { id: replayFid, body: "Looking (via MCP)" } });
  check("MCP add_comment", !res.isError && JSON.parse(mcpText(res)).visibility === "internal");
  res = await http.callTool({ name: "update_feedback", arguments: { id: replayFid, status: "in_review" } });
  check("MCP update_feedback", JSON.parse(mcpText(res)).status === "in_review");
  res = await http.callTool({
    name: "resolve_feedback",
    arguments: { id: replayFid, note: "Fixed in https://example.com/pr/1" },
  });
  check("MCP resolve_feedback with a note", JSON.parse(mcpText(res)).status === "resolved");
  r = await call(`/api/feedback/${replayFid}`);
  check(
    "resolution note saved as internal comment",
    r.body.comments?.some((c) => c.body.includes("/pr/1") && c.visibility === "internal"),
  );
  res = await http.callTool({ name: "get_feedback", arguments: { id: crypto.randomUUID() } });
  check("MCP reports API errors as tool errors", res.isError === true && mcpText(res).includes("NOT_FOUND"));
  await http.close();
  const viewerMcp = new Client({ name: "smoke-viewer", version: "1.0.0" });
  await viewerMcp.connect(
    new StreamableHTTPClientTransport(new URL(`${B}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${viewerToken}` } },
    }),
  );
  res = await viewerMcp.callTool({ name: "update_feedback", arguments: { id: replayFid, status: "open" } });
  check("MCP respects the viewer role", res.isError === true && mcpText(res).includes("READ_ONLY_ROLE"));
  await viewerMcp.close();

  // The stdio binary, as `npx @pinwren/mcp` runs it.
  const stdio = new Client({ name: "smoke-stdio", version: "1.0.0" });
  await stdio.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [mcpCli],
      env: { ...process.env, PINWREN_URL: B, PINWREN_TOKEN: writeToken },
      stderr: "ignore",
    }),
  );
  check("MCP (stdio) lists the tools", (await stdio.listTools()).tools.length === 7);
  res = await stdio.callTool({ name: "search_feedback", arguments: { projectId, status: "all", limit: 3 } });
  check("MCP (stdio) search_feedback", JSON.parse(mcpText(res)).items.length === 3);
  await stdio.close();

  // CLI
  const runCli = (args) => {
    const out = spawnSync(process.execPath, [pinwrenCli, ...args], { encoding: "utf8", timeout: 60_000 });
    return { code: out.status, stdout: out.stdout, stderr: out.stderr };
  };
  let cli = runCli(["doctor", "--url", B, "--key", publicKey, "--origin", site, "--json"]);
  let doc = JSON.parse(cli.stdout || "{}");
  check(
    "CLI doctor: server, widget.js and config OK",
    cli.code === 0 &&
      doc.ok === true &&
      doc.checks?.some((c) => c.name === "server" && c.detail.includes("Pinwren")),
    cli.stdout || cli.stderr,
  );
  cli = runCli(["doctor", "--url", B, "--key", publicKey, "--origin", "https://evil.example", "--json"]);
  doc = JSON.parse(cli.stdout || "{}");
  check(
    "CLI doctor flags an origin that isn't allowed",
    cli.code === 1 &&
      doc.checks?.some((c) => c.name === "widget config" && !c.ok && c.detail.includes("allowed origins")),
  );
  cli = runCli(["status", "--url", B, "--token", writeToken, "--json"]);
  const st = JSON.parse(cli.stdout || "{}");
  check(
    "CLI status lists projects and open counts",
    cli.code === 0 && st.user === "Smoke Tester" && st.projects?.some((p) => p.id === projectId),
    cli.stderr,
  );
  cli = runCli(["init", "--url", B, "--key", publicKey, "--framework", "html"]);
  check("CLI init prints the snippet", cli.code === 0 && cli.stdout.includes(`data-project="${publicKey}"`));
}

// --- Reporter unsubscribe -------------------------------------------------------------------------------
console.log("\n— wave 4: reporter unsubscribe");
r = await call(`/api/unsubscribe?token=nope`, { jar: { cookie: "" } });
check("bad unsubscribe token refused", r.status === 400, r.status);
r = await call("/api/admin/settings/email", { jar: adminJar });
if (r.status !== 200) {
  skip(
    "unsubscribe suppresses reporter email",
    "needs an instance admin (PINWREN_ADMIN_EMAILS=smoke-admin@example.com)",
  );
} else if (r.body.email?.locked?.host || r.body.email?.configured) {
  skip("unsubscribe suppresses reporter email", "SMTP is configured on this instance");
} else {
  // A tiny SMTP sink plays the mail server.
  const mails = [];
  const smtp = createTcpServer((sock) => {
    let buf = "";
    let data = false;
    let cur = { to: [], raw: "" };
    sock.write("220 smoke ESMTP\r\n");
    sock.on("data", (d) => {
      buf += d.toString("latin1");
      for (;;) {
        if (data) {
          const end = buf.indexOf("\r\n.\r\n");
          if (end < 0) return;
          cur.raw = buf.slice(0, end);
          buf = buf.slice(end + 5);
          mails.push(cur);
          cur = { to: [], raw: "" };
          data = false;
          sock.write("250 OK\r\n");
          continue;
        }
        const i = buf.indexOf("\r\n");
        if (i < 0) return;
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === "EHLO" || verb === "HELO") sock.write("250-smoke\r\n250 8BITMIME\r\n");
        else if (verb === "RCPT") {
          cur.to.push((/<([^>]*)>/.exec(line)?.[1] ?? "").toLowerCase());
          sock.write("250 OK\r\n");
        } else if (verb === "DATA") {
          data = true;
          sock.write("354 go ahead\r\n");
        } else if (verb === "QUIT") {
          sock.end("221 bye\r\n");
          return;
        } else sock.write("250 OK\r\n");
      }
    });
  });
  await new Promise((res) => smtp.listen(0, listenHost, res));
  try {
    await call("/api/admin/settings/email", {
      method: "PATCH",
      json: {
        host: receiverHost,
        port: smtp.address().port,
        secure: false,
        from: "Pinwren <noreply@example.com>",
      },
      jar: adminJar,
    });
    await call(`/api/projects/${projectId}`, { method: "PATCH", json: { notifyReporter: true } });
    // Only replies here: the "report received" confirmation would add one email per reporter.
    await call(`/api/projects/${projectId}/notifications`, {
      method: "PATCH",
      json: { reporter: { received: false } },
    });
    const stamp = Date.now();
    const leaver = `leaver+${stamp}@example.com`;
    const stayer = `stayer+${stamp}@example.com`;
    const fileReport = async (to) =>
      (await W("/w/feedback", { method: "POST", json: w4report({ reporter: { name: "R", email: to } }) }))
        .body.feedback?.id;
    const leaverFid = await fileReport(leaver);
    const stayerFid = await fileReport(stayer);
    const reply = (id, body) =>
      call(`/api/feedback/${id}/comments`, { method: "POST", json: { body, visibility: "public" } });
    const mailsTo = (to) => mails.filter((m) => m.to.includes(to));
    await reply(leaverFid, "First reply");
    const first = await waitFor(() => mailsTo(leaver)[0], 60_000);
    const headers = (first?.raw ?? "").split("\r\n\r\n")[0].replace(/\r\n[ \t]+/g, " ");
    const listUnsub = /^List-Unsubscribe: <([^>]+)>/im.exec(headers)?.[1];
    check(
      "reporter email carries List-Unsubscribe + one-click headers",
      !!listUnsub &&
        /^List-Unsubscribe-Post: List-Unsubscribe=One-Click/im.test(headers) &&
        listUnsub.includes("/api/unsubscribe?token="),
      first ? "" : "no email (timeout)",
    );
    const unsubPath = listUnsub
      ? new URL(listUnsub).pathname + new URL(listUnsub).search
      : "/api/unsubscribe?token=x";
    r = await call(unsubPath, { jar: { cookie: "" } });
    check(
      "GET shows a confirmation, doesn't unsubscribe",
      r.status === 200 && String(r.body).includes('<form method="post"') && String(r.body).includes(leaver),
    );
    r = await call(unsubPath, {
      method: "POST",
      rawBody: "List-Unsubscribe=One-Click",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      jar: { cookie: "" },
    });
    check(
      "one-click POST unsubscribes",
      r.status === 200 && String(r.body).includes("unsubscribed"),
      r.status,
    );
    await reply(leaverFid, "Second reply");
    await reply(stayerFid, "Reply to the stayer");
    await waitFor(() => mailsTo(stayer).length >= 1, 30_000);
    await sleep(4_000);
    check(
      "the next reporter email to them is suppressed",
      mailsTo(leaver).length === 1,
      mailsTo(leaver).length,
    );
    check("other reporters still get theirs", mailsTo(stayer).length === 1, mailsTo(stayer).length);
  } finally {
    await call("/api/admin/settings/email", {
      method: "PATCH",
      json: { host: null, port: null, secure: null, from: null },
      jar: adminJar,
    });
    // Back to the defaults (reporter emails on since wave 5); later sections read them.
    await call(`/api/projects/${projectId}/notifications`, {
      method: "PATCH",
      json: { reporter: { received: true } },
    });
    smtp.close();
  }
}

// --- Enterprise licence ----------------------------------------------------------------------------------
console.log("\n— wave 4: enterprise licence");
r = await call("/api/admin/license", { jar: adminJar });
if (r.status !== 200) {
  skip("licence checks", "needs an instance admin (PINWREN_ADMIN_EMAILS=smoke-admin@example.com)");
} else if (r.body.license?.source === "file") {
  skip("licence checks", "PINWREN_LICENSE_FILE is set on this instance");
} else {
  const { signLicense } = await import(pathToFileURL(join(root, "tools/sign-license/lib.mjs")).href);
  const devKey = readFileSync(join(root, "tools/sign-license/dev-private-key.pem"), "utf8");
  const day = 86_400_000;
  const lic = (fromDays, toDays, extra = {}) =>
    signLicense(
      {
        kid: "dev-2026",
        lid: `lic_smoke_${Date.now()}`,
        customer: "Smoke GmbH",
        features: ["white_label", "sso"],
        limits: { seats: 50 },
        issuedAt: new Date(Date.now() + fromDays * day).toISOString(),
        expiresAt: new Date(Date.now() + toDays * day).toISOString(),
        graceDays: 30,
        ...extra,
      },
      devKey,
    );
  const install = (text) =>
    call("/api/admin/license", { method: "POST", json: { license: text }, jar: adminJar });
  const previewHtml = async () =>
    (await call("/api/email-templates/feedback_created/preview", { method: "POST", json: {} })).body.preview
      ?.html ?? "";
  await call("/api/admin/license", { method: "DELETE", jar: adminJar });
  r = await call("/api/me/entitlements");
  check(
    "no licence: Community, nothing gated in",
    r.body.edition === "community" && r.body.status === "none" && r.body.features.length === 0,
  );
  check("Community emails say Powered by Pinwren", (await previewHtml()).includes("Powered by Pinwren"));
  r = await call("/api/admin/license", { method: "POST", json: { license: lic(-1, 365) } });
  check("only instance admins upload licences", r.status === 403, r.status);
  r = await install(lic(-1, 365));
  check(
    "valid licence accepted",
    r.status === 200 &&
      r.body.license?.status === "valid" &&
      r.body.license.features.includes("white_label") &&
      r.body.license.details?.customer === "Smoke GmbH",
    r.status,
  );
  r = await call("/api/me/entitlements", { jar: memberJar });
  check(
    "members read entitlements",
    r.status === 200 && r.body.edition === "enterprise" && r.body.seats.limit === 50,
  );
  r = await W("/w/config");
  check("white-label: stored hidePoweredBy now applies", r.body.branding?.hidePoweredBy === true);
  check("white-label: emails drop Powered by", !(await previewHtml()).includes("Powered by Pinwren"));
  const [body, sig] = lic(-1, 365).split(".");
  const forged = Buffer.from(
    JSON.stringify({
      ...JSON.parse(Buffer.from(body, "base64url").toString()),
      customer: "Mallory",
      limits: { seats: 9999 },
    }),
  ).toString("base64url");
  r = await install(`${forged}.${sig}`);
  check(
    "tampered licence refused",
    r.status === 400 && r.body.code === "INVALID_LICENSE" && /signature/.test(r.body.title),
    r.status,
  );
  r = await install(lic(-1, 365, { kid: "someone-else" }));
  check(
    "licence from an unknown key refused",
    r.status === 400 && r.body.code === "INVALID_LICENSE",
    r.status,
  );
  r = await install(lic(-400, -5));
  check(
    "expired within grace: still in force, with a deadline",
    r.status === 200 &&
      r.body.license?.status === "grace" &&
      r.body.license.readOnly === false &&
      r.body.license.features.includes("white_label"),
    r.body.license?.status,
  );
  r = await W("/w/config");
  check("grace: white-label still applies", r.body.branding?.hidePoweredBy === true);
  r = await install(lic(-400, -40));
  check(
    "expired after grace: read-only",
    r.status === 200 && r.body.license?.status === "expired" && r.body.license.readOnly === true,
  );
  r = await W("/w/config");
  check("after grace: configured white-label keeps working", r.body.branding?.hidePoweredBy === true);
  r = await call(`/api/projects/${projectId}`, {
    method: "PATCH",
    json: { widgetBranding: { hidePoweredBy: false } },
  });
  check(
    "after grace: white-label can't be changed",
    r.status === 403 && r.body.code === "LICENSE_READ_ONLY",
    r.status,
  );
  r = await call(`/api/projects/${projectId}`, {
    method: "PATCH",
    json: { widgetBranding: { dialogAccent: "#223344" } },
  });
  check("after grace: everything else still editable", r.status === 200);
  r = await call("/api/admin/license", { method: "DELETE", jar: adminJar });
  check("remove the licence", r.status === 200 && r.body.license?.status === "none");
  r = await W("/w/config");
  check("without the licence hidePoweredBy is ignored again", r.body.branding?.hidePoweredBy === false);
}

// --- Pre-release security fixes (ADR 0021) ----------------------------------------------------------------
// Each check is an attack that used to work. Runs last: the invitation flood queues ~30 emails. The server allowlists 127.0.0.1 for outbound requests
// (PINWREN_OUTBOUND_ALLOWLIST=127.0.0.1) so the smoke receivers work; 127.0.0.2 and every other private
// address must still be refused.
console.log("\n— security (ADR 0021)");
{
  const secHits = [];
  const secServer = createServer((req, res) => {
    secHits.push(req.url);
    // An "internal service" whose response must never be shown back.
    res.statusCode = req.url.startsWith("/repos/") ? 404 : 200;
    res.end("TOPSECRET internal response");
  });
  await new Promise((resolve) => secServer.listen(0, "127.0.0.1", resolve));
  const secPort = secServer.address().port;
  const ip = () => `203.0.${rand()}.${rand()}`;
  try {
    // HIGH 1 — SSRF: webhooks.
    r = await call("/api/webhooks", {
      method: "POST",
      json: { url: `http://127.0.0.2:${secPort}/hook`, events: ["feedback.created"] },
    });
    const blockedHook = r.body.webhook?.id;
    r = await call(`/api/webhooks/${blockedHook}/test`, { method: "POST" });
    check(
      "SSRF: webhook test to a loopback address is blocked before connecting",
      r.status === 200 &&
        r.body.delivery?.status === "failed" &&
        /^blocked/.test(r.body.delivery?.error ?? "") &&
        !secHits.includes("/hook"),
      JSON.stringify(r.body.delivery),
    );
    for (const target of [
      "http://169.254.169.254/latest/meta-data/",
      `http://[::ffff:127.0.0.2]:${secPort}/x`,
      "http://10.0.0.1/",
    ]) {
      await call(`/api/webhooks/${blockedHook}`, { method: "PATCH", json: { url: target } });
      r = await call(`/api/webhooks/${blockedHook}/test`, { method: "POST" });
      check(
        `SSRF: webhook to ${new URL(target).host} is blocked`,
        /^blocked/.test(r.body.delivery?.error ?? ""),
        r.body.delivery?.error,
      );
    }
    await call(`/api/webhooks/${blockedHook}`, { method: "DELETE" });
    r = await call("/api/webhooks", {
      method: "POST",
      json: { url: `http://127.0.0.1:${secPort}/allowed`, events: ["feedback.created"] },
    });
    const allowedHook = r.body.webhook?.id;
    r = await call(`/api/webhooks/${allowedHook}/test`, { method: "POST" });
    check(
      "webhook test returns status only, never the receiver's response body",
      r.body.delivery?.status === "success" &&
        r.body.delivery?.responseBody === null &&
        !JSON.stringify(r.body).includes("TOPSECRET"),
    );
    r = await call(`/api/webhooks/${allowedHook}/deliveries`);
    check("delivery log never echoes response bodies", !JSON.stringify(r.body).includes("TOPSECRET"));
    await call(`/api/webhooks/${allowedHook}`, { method: "DELETE" });

    // A dedicated project for the rest.
    r = await call("/api/projects", {
      method: "POST",
      json: { name: "Security", allowedOrigins: ["localhost:5173"] },
    });
    const secProject = r.body.project;
    await call(`/api/projects/${secProject.id}`, {
      method: "PATCH",
      json: {
        publicRead: true,
        widgetConfig: {
          panelActions: [
            { id: "ssrf", label: "SSRF", kind: "webhook", url: `http://127.0.0.2:${secPort}/action` },
            {
              id: "team",
              label: "Team link",
              kind: "link",
              url: "https://team.example/{id}",
              visibleTo: "team",
            },
          ],
        },
      },
    });
    const SW = (path, opts = {}) =>
      call(path, {
        ...opts,
        jar: { cookie: "" },
        headers: { "x-pinwren-key": secProject.publicKey, origin: site, ...(opts.headers ?? {}) },
      });
    const mini = (extra = {}) => ({
      clientId: crypto.randomUUID(),
      kind: "comment",
      body: "security smoke",
      page: { url: `${site}/sec` },
      environment: { userAgent: "smoke", viewport: { w: 10, h: 10 }, dpr: 1 },
      ...extra,
    });
    r = await SW("/w/feedback", { method: "POST", json: mini(), headers: { "x-forwarded-for": ip() } });
    const secFid = r.body.feedback?.id;

    // HIGH 1 — SSRF: panel actions and tracker URLs.
    r = await call(`/api/feedback/${secFid}/actions/ssrf`, { method: "POST" });
    check(
      "SSRF: webhook panel action to a loopback address is blocked",
      r.status === 200 &&
        r.body.ok === false &&
        /^blocked/.test(r.body.error ?? "") &&
        !secHits.includes("/action"),
      JSON.stringify(r.body),
    );
    r = await call(`/api/projects/${secProject.id}/integrations`, {
      method: "POST",
      json: {
        provider: "github",
        token: "ghp_smoke_token_1",
        repo: "a/b",
        apiUrl: `http://127.0.0.2:${secPort}`,
      },
    });
    r = await call(`/api/integrations/${r.body.integration?.id}/test`, { method: "POST" });
    check(
      "SSRF: tracker base URL to a loopback address is blocked",
      r.body.ok === false && /blocked/.test(r.body.message ?? ""),
      r.body.message,
    );
    r = await call(`/api/projects/${secProject.id}/integrations`, {
      method: "POST",
      json: {
        provider: "gitlab",
        token: "glpat-smoke-token-1",
        repo: "a/b",
        apiUrl: `http://127.0.0.1:${secPort}`,
      },
    });
    r = await call(`/api/integrations/${r.body.integration?.id}/test`, { method: "POST" });
    check(
      "tracker test never echoes a non-JSON response body",
      r.body.ok === false && !JSON.stringify(r.body).includes("TOPSECRET"),
      r.body.message,
    );

    // HIGH 1 — configuration writes are org-admin only.
    r = await call(`/api/projects/${secProject.id}`, {
      method: "PATCH",
      json: {
        widgetConfig: {
          panelActions: [{ id: "x", label: "x", kind: "webhook", url: "https://evil.example/" }],
        },
      },
      jar: memberJar,
    });
    check(
      "members can't change project settings (webhook actions)",
      r.status === 403 && r.body.code === "ADMIN_REQUIRED",
      r.status,
    );
    r = await call(`/api/projects/${secProject.id}/rotate-key`, { method: "POST", jar: memberJar });
    check("members can't rotate the project key", r.status === 403, r.status);
    r = await call(`/api/projects/${secProject.id}`, { jar: memberJar });
    const memberActions = r.body.project?.widgetConfig?.panelActions ?? [];
    check(
      "members don't see webhook action URLs",
      memberActions.length === 2 && memberActions.find((a) => a.id === "ssrf")?.url === "",
    );
    r = await call(`/api/feedback/${secFid}`, { jar: viewerJar });
    check(
      "viewers see no team-only or webhook actions on an item",
      r.status === 200 && r.body.panelActions?.length === 0,
      JSON.stringify(r.body.panelActions),
    );

    // HIGH 2 — a spoofed first X-Forwarded-For entry no longer gives a fresh rate-limit bucket.
    const real = ip();
    const statuses = [];
    for (let i = 0; i < 11; i++) {
      r = await SW("/w/feedback", {
        method: "POST",
        json: mini(),
        headers: { "x-forwarded-for": `6.6.6.${i + 1}, ${real}`, "x-real-ip": `7.7.7.${i + 1}` },
      });
      statuses.push(r.status);
    }
    check(
      "spoofed X-Forwarded-For / X-Real-IP can't dodge the per-address limit",
      statuses.slice(0, 10).every((s) => s === 201) && statuses[10] === 429,
      statuses.join(","),
    );

    // HIGH 2 — Better Auth's limiter uses the same trusted address: rotating the spoofed first entry
    // doesn't reset the sign-in budget.
    const authIp = ip();
    const signIns = [];
    for (let i = 0; i < 11; i++) {
      const res = await call("/api/auth/sign-in/email", {
        method: "POST",
        jar: { cookie: "" },
        json: { email: "nobody@example.com", password: "wrong-password" },
        headers: { "x-forwarded-for": `6.6.${i}.6, ${authIp}`, "x-real-ip": `7.7.${i}.7` },
      });
      signIns.push(res.status);
    }
    check("sign-in attempts are rate-limited per real address", signIns.at(-1) === 429, signIns.join(","));

    // MEDIUM 5 — bodies are capped before they're read; reports must declare their length.
    const raw = (path, headers, body) =>
      new Promise((resolve) => {
        const req = httpRequest(B + path, { method: "POST", headers }, (res) => {
          let text = "";
          res.on("data", (c) => (text += c));
          res.on("end", () => resolve({ status: res.statusCode, text }));
        });
        req.on("error", (e) => resolve({ status: 0, text: String(e) }));
        if (body) req.write(body);
        req.end();
      });
    r = await raw(
      "/w/feedback",
      {
        "x-pinwren-key": secProject.publicKey,
        origin: site,
        "content-type": "application/json",
        "transfer-encoding": "chunked",
        "x-forwarded-for": ip(),
      },
      JSON.stringify(mini()),
    );
    check("widget report without Content-Length is refused (411)", r.status === 411, r.status);
    r = await call("/api/integrations/github/webhook", {
      method: "POST",
      jar: { cookie: "" },
      headers: { "content-type": "application/json", "x-github-event": "issues", "x-forwarded-for": ip() },
      rawBody: JSON.stringify({ pad: "x".repeat(2 * 1024 * 1024) }),
    });
    check("oversized inbound webhook refused before parsing (413)", r.status === 413, r.status);
    r = await call(`/api/projects/${secProject.id}`, {
      method: "PATCH",
      json: { name: "x".repeat(3 * 1024 * 1024) },
    });
    check("oversized dashboard request refused (413)", r.status === 413, r.status);

    // MEDIUM 6 — CSRF and content type.
    r = await call("/api/projects", {
      method: "POST",
      json: { name: "csrf" },
      headers: { origin: "https://evil.example" },
    });
    check(
      "cross-site cookie request is refused",
      r.status === 403 && r.body.code === "CROSS_SITE_REQUEST",
      r.status,
    );
    r = await call("/api/projects", { method: "POST", json: { name: "csrf" }, headers: { origin: "" } });
    check(
      "cookie request without an origin is refused",
      r.status === 403 && r.body.code === "CROSS_SITE_REQUEST",
      r.status,
    );
    r = await call("/api/projects", {
      method: "POST",
      rawBody: JSON.stringify({ name: "csrf" }),
      headers: { "content-type": "text/plain" },
    });
    check("non-JSON body on a JSON route is refused (415)", r.status === 415, r.status);
    const page = await fetch(`${B}/sign-in`, { redirect: "manual" });
    const csp = page.headers.get("content-security-policy") ?? "";
    check(
      "dashboard pages send a CSP that forbids framing, plugins and foreign scripts",
      csp.includes("frame-ancestors 'none'") &&
        csp.includes("object-src 'none'") &&
        /script-src 'self'/.test(csp) &&
        !/script-src[^;]*https?:/.test(csp),
      csp,
    );

    // MEDIUM 4 — template test emails only go to the caller, and are rate-limited.
    r = await call("/api/email-templates/feedback_created/test", {
      method: "POST",
      json: { to: "victim@example.com" },
    });
    check(
      "template test can't email someone else",
      r.status === 400 && r.body.code === "RECIPIENT_NOT_ALLOWED",
      r.status,
    );
    let mailStatus = 0;
    for (let i = 0; i < 12 && mailStatus !== 429; i++) {
      mailStatus = (await call("/api/email-templates/feedback_created/test", { method: "POST", json: {} }))
        .status;
    }
    check("template test sends are rate-limited", mailStatus === 429, mailStatus);
    // A throwaway workspace takes the flood: the limit is per organisation, and later sections still
    // invite from the main one.
    const floodOrg = (
      await call("/api/auth/organization/create", {
        method: "POST",
        json: { name: "Invite flood", slug: `flood-${Date.now()}`, keepCurrentActiveOrganization: true },
      })
    ).body?.id;
    let inviteStatus = 0;
    for (let i = 0; i < 35 && inviteStatus !== 429; i++) {
      inviteStatus = (
        await call("/api/auth/organization/invite-member", {
          method: "POST",
          json: { email: `flood-${i}-${Date.now()}@example.com`, role: "member", organizationId: floodOrg },
        })
      ).status;
    }
    check("invitations are rate-limited per organisation", inviteStatus === 429, inviteStatus);

    // HIGH 3 — no admin by claiming: with PINWREN_ADMIN_EMAILS set there's nothing to claim.
    r = await call("/api/setup");
    check("setup is not open on a configured instance", r.status === 200 && r.body.needed === false);
    r = await call("/api/setup/claim", { method: "POST", json: { token: `pws_${"x".repeat(40)}` } });
    // Wave 5 (ADR 0021 amendment): the first account is the administrator; the token claim is gone.
    check("setup-token claim is gone", r.status === 410 && r.body.code === "SETUP_TOKEN_REMOVED", r.status);

    // LOW — page URLs are http(s) only; deleted items' threads vanish from the page.
    r = await SW("/w/feedback", {
      method: "POST",
      json: mini({ page: { url: "javascript:alert(document.cookie)//" } }),
      headers: { "x-forwarded-for": ip() },
    });
    check("javascript: page URL is refused", r.status === 400, r.status);
    r = await SW(`/w/feedback/${secFid}/comments`, {
      method: "POST",
      json: { body: "public reply" },
      headers: { "x-forwarded-for": ip() },
    });
    r = await SW(`/w/feedback/${secFid}/comments`);
    const before = r.body.items?.length ?? 0;
    await call(`/api/feedback/${secFid}`, { method: "DELETE" });
    r = await SW(`/w/feedback/${secFid}/comments`);
    check(
      "a deleted item's replies are gone from the widget",
      before === 1 && r.status === 200 && r.body.items?.length === 0,
      `${before} ${r.body.items?.length}`,
    );

    // LOW — failed Bearer tokens are rate-limited per address (API and MCP).
    const tokIp = ip();
    let tokStatus = 0;
    for (let i = 0; i < 22 && tokStatus !== 429; i++) {
      tokStatus = (
        await call("/api/v1/feedback", {
          jar: { cookie: "" },
          headers: { authorization: `Bearer pwt_${"x".repeat(40)}${i}`, "x-forwarded-for": tokIp },
        })
      ).status;
    }
    check("repeated bad API tokens are rate-limited", tokStatus === 429, tokStatus);
    r = await call("/mcp", {
      method: "POST",
      jar: { cookie: "" },
      json: { jsonrpc: "2.0", id: 1, method: "initialize" },
      headers: {
        authorization: `Bearer pwt_${"y".repeat(40)}`,
        "x-forwarded-for": tokIp,
        accept: "application/json, text/event-stream",
      },
    });
    check("…and MCP shares the same budget", r.status === 429, r.status);

    // HIGH 2 — the per-project intake cap holds however many addresses send.
    r = await call("/api/projects", {
      method: "POST",
      json: { name: "Flood", allowedOrigins: ["localhost:5173"] },
    });
    const flood = r.body.project;
    let floodStatus = 0;
    let sent = 0;
    for (; sent < 140 && floodStatus !== 429; sent++) {
      const res = await call("/w/feedback", {
        method: "POST",
        jar: { cookie: "" },
        json: mini(),
        headers: { "x-pinwren-key": flood.publicKey, origin: site, "x-forwarded-for": ip() },
      });
      floodStatus = res.status;
      if (res.status === 429) r = res;
    }
    check(
      "per-project intake cap stops a report flood from many addresses",
      floodStatus === 429 && r.body.code === "PROJECT_RATE_LIMITED" && sent <= 121,
      `${floodStatus} after ${sent}`,
    );
    await call(`/api/projects/${flood.id}`, { method: "PATCH", json: { archived: true } });
    await call(`/api/projects/${secProject.id}`, { method: "PATCH", json: { archived: true } });
  } finally {
    secServer.closeAllConnections();
    secServer.close();
  }
}

// =============================================================================================
// Wave 5 foundation (docs/contracts/wave-5.md): shared schema + update paths
// =============================================================================================
{
  console.log("\n— wave 5: foundation");
  const mk = await W("/w/feedback", {
    method: "POST",
    json: { ...report, clientId: crypto.randomUUID(), screenshot: undefined },
  });
  const a = mk.body.feedback?.id;
  const mk2 = await W("/w/feedback", {
    method: "POST",
    json: { ...report, clientId: crypto.randomUUID(), screenshot: undefined },
  });
  const b = mk2.body.feedback?.id;
  check("wave-5 items created", typeof a === "string" && typeof b === "string", `${mk.status} ${mk2.status}`);

  r = await call(`/api/feedback/${a}`, {
    method: "PATCH",
    json: { dueAt: "2030-01-15T09:00:00+01:00", kind: "idea" },
  });
  check(
    "PATCH sets a due date and converts the kind",
    r.status === 200 &&
      r.body.feedback?.kind === "idea" &&
      String(r.body.feedback?.dueAt).startsWith("2030-01-15T08:00:00"),
    `${r.status} ${r.body.feedback?.dueAt}`,
  );
  r = await call(`/api/feedback/${a}`, { method: "PATCH", json: { dueAt: null } });
  check("PATCH clears the due date", r.status === 200 && r.body.feedback?.dueAt === null, r.status);

  r = await call(`/api/feedback/${a}`, { method: "PATCH", json: { duplicateOfId: a } });
  check("an item can't duplicate itself", r.status === 400 && r.body.code === "INVALID_DUPLICATE", r.status);
  r = await call(`/api/feedback/${a}`, { method: "PATCH", json: { duplicateOfId: b, status: "duplicate" } });
  check(
    "mark as duplicate of another item",
    r.status === 200 && r.body.feedback?.duplicateOfId === b && r.body.feedback?.status === "duplicate",
    r.status,
  );
  r = await call(`/api/feedback/${a}`, { method: "PATCH", json: { labelIds: [crypto.randomUUID()] } });
  check(
    "labels of another project are refused",
    r.status === 400 && r.body.code === "INVALID_LABEL",
    r.status,
  );
  r = await call(`/api/feedback/${a}`, { method: "PATCH", json: { labelIds: [] } });
  check(
    "an empty label list is accepted",
    r.status === 200 && Array.isArray(r.body.feedback?.labelIds),
    r.status,
  );
  r = await call(`/api/feedback/${a}`);
  check(
    "activity records the due date and the duplicate",
    r.body.activity?.some((x) => x.type === "dueAt_changed") &&
      r.body.activity?.some((x) => x.type === "duplicateOfId_changed"),
  );

  r = await call("/api/notifications/read", { method: "POST", json: { feedbackId: a } });
  check(
    "mark one item's notifications read",
    r.status === 200 && typeof r.body.updated === "number",
    r.status,
  );
  r = await call("/api/notifications/read", { method: "POST", json: { feedbackId: "nope" } });
  check("notifications/read validates feedbackId", r.status === 400, r.status);
  r = await call("/api/feedback?sort=priority&order=asc&hasReplay=0");
  check("list accepts sort/order/hasReplay", r.status === 200, r.status);
  r = await call("/api/feedback?sort=random");
  check("list refuses an unknown sort", r.status === 400, r.status);

  // BugPin notification columns (Notifications › General / › Reporter) with their defaults.
  r = await call(`/api/projects/${projectId}`);
  const np = r.body.project ?? {};
  check(
    "project carries notification recipients and reporter switches",
    r.status === 200 &&
      np.notifyMemberIds === null &&
      Array.isArray(np.notifyEmails) &&
      np.notifyEmails.length === 0 &&
      np.reporterEmailReceived === true &&
      np.reporterEmailStatus === true &&
      np.reporterEmailPriority === false &&
      np.reporterEmailAssigned === false,
    JSON.stringify({ s: r.status, m: np.notifyMemberIds, e: np.notifyEmails }),
  );
}

// =============================================================================================
// Wave 5 — install-onboarding (docs/contracts/wave-5.md §3.5): presets, refused origins, setup
// checklist, review links, project export, reporter erasure
// =============================================================================================
{
  console.log("\n— wave 5: install-onboarding");
  r = await call(`/api/projects/${projectId}`);
  check(
    "project payload has rejectedOrigins and the public URL",
    r.status === 200 &&
      Array.isArray(r.body.project?.rejectedOrigins) &&
      typeof r.body.project?.publicUrl === "string",
    `${r.status} ${r.body.project?.publicUrl}`,
  );

  // Presets: "what is this site for?"
  r = await call("/api/projects", {
    method: "POST",
    json: { name: "Preset public", allowedOrigins: [], preset: "public-site" },
  });
  const presetPublic = r.body.project;
  check(
    "preset public-site: private pins, visitors can't resolve",
    r.status === 201 &&
      presetPublic?.publicRead === false &&
      presetPublic?.widgetConfig?.visitorsCanResolve === false,
    r.status,
  );
  r = await call("/api/projects", {
    method: "POST",
    json: { name: "Preset review", allowedOrigins: [], preset: "review" },
  });
  const presetReview = r.body.project;
  check(
    "preset review: public pins, visitors can resolve",
    r.status === 201 &&
      presetReview?.publicRead === true &&
      presetReview?.widgetConfig?.visitorsCanResolve === true,
    r.status,
  );
  r = await call("/api/projects", { method: "POST", json: { name: "Bad preset", preset: "public" } });
  check("an unknown preset is refused", r.status === 400, r.status);
  r = await call("/api/projects", { method: "POST", json: { name: "By an editor" }, jar: memberJar });
  check("an Editor can't create projects", r.status === 403 && r.body.code === "FORBIDDEN_ROLE", r.status);
  for (const p of [presetPublic, presetReview]) {
    if (p?.id) await call(`/api/projects/${p.id}`, { method: "PATCH", json: { archived: true } });
  }

  // Refused origins: the widget area records them in the /w middleware; "Allow" is a normal PATCH that
  // drops whatever the new allowlist lets through.
  await W("/w/config", { headers: { origin: "https://refused.example" } });
  const refused = await waitFor(async () => {
    const p = (await call(`/api/projects/${projectId}`)).body.project;
    return p?.rejectedOrigins?.some((o) => o.origin === "https://refused.example") ? p : null;
  }, 3_000);
  if (refused) {
    r = await call(`/api/projects/${projectId}`, {
      method: "PATCH",
      json: { allowedOrigins: [...refused.allowedOrigins, "refused.example"] },
    });
    check(
      "Allow drops the origin from the refused list",
      r.status === 200 && !r.body.project.rejectedOrigins.some((o) => o.origin === "https://refused.example"),
      r.status,
    );
    await call(`/api/projects/${projectId}`, {
      method: "PATCH",
      json: { allowedOrigins: refused.allowedOrigins },
    });
  } else {
    skip("Allow drops the origin from the refused list", "the /w middleware records no refusals yet");
  }

  // First-run checklist, from real state.
  r = await call("/api/setup-checklist");
  const cl = r.body.checklist;
  check(
    "setup checklist: widget connected, feedback received, teammate added",
    r.status === 200 && cl?.steps.widget === true && cl?.steps.feedback === true && cl?.steps.team === true,
    JSON.stringify(cl?.steps),
  );
  check("setup checklist counts its steps", cl?.total === 6 && cl.done >= 3, `${cl?.done}/${cl?.total}`);
  r = await call("/api/setup-checklist", { jar: viewerJar });
  check("every role may read the checklist", r.status === 200, r.status);

  // Review links.
  r = await call(`/api/projects/${projectId}/review-links`, {
    method: "POST",
    json: { label: "Elsewhere", url: "https://not-allowed.example/" },
  });
  check(
    "a review link must point at an allowed site",
    r.status === 400 && r.body.code === "ORIGIN_NOT_ALLOWED",
    r.status,
  );
  r = await call(`/api/projects/${projectId}/review-links`, {
    method: "POST",
    json: { label: "Client round", url: `${site}/pricing?plan=pro`, expiresInDays: 7 },
  });
  const linkId = r.body.link?.id;
  const reviewToken = r.status === 201 ? new URL(r.body.url).searchParams.get("pinwren_review") : null;
  check(
    "create a review link (token shown once, in the URL)",
    r.status === 201 && !!reviewToken && r.body.url.includes("plan=pro") && r.body.link.url === null,
    r.status,
  );
  r = await call(`/api/projects/${projectId}/review-links`);
  check(
    "list review links without the token",
    r.status === 200 && r.body.links.some((l) => l.id === linkId && l.url === null && l.expiresAt),
    r.status,
  );
  r = await call(`/api/projects/${projectId}/review-links`, { jar: memberJar });
  check("review links are for Admins", r.status === 403, r.status);
  r = await W("/w/review-link", { headers: { "x-pinwren-review-token": reviewToken ?? "" } });
  check("the widget accepts a valid review token", r.status === 200 && r.body.ok === true, r.status);
  r = await W("/w/review-link", { headers: { "x-pinwren-review-token": "pwr_wrong" } });
  check("the widget refuses an unknown review token", r.status === 404, r.status);
  r = await call(`/api/review-links/${linkId}`, { method: "DELETE" });
  check("revoke a review link", r.status === 204, r.status);
  r = await W("/w/review-link", { headers: { "x-pinwren-review-token": reviewToken ?? "" } });
  check("a revoked review token stops working", r.status === 404, r.status);

  // Project data export (a background job).
  r = await call(`/api/projects/${projectId}/export`, { method: "POST", jar: memberJar });
  check("exports are for Admins", r.status === 403, r.status);
  r = await call(`/api/projects/${projectId}/export`, { method: "POST" });
  check("request a project export", r.status === 202 && r.body.export?.status === "pending", r.status);
  const ready = await waitFor(async () => {
    const e = (await call(`/api/projects/${projectId}/export`)).body.export;
    return e && (e.status === "ready" || e.status === "failed") ? e : null;
  }, 60_000);
  check(
    "the export job finishes with a download",
    ready?.status === "ready" && ready.items > 0 && typeof ready.downloadUrl === "string",
    JSON.stringify(ready),
  );
  if (ready?.downloadUrl) {
    const zip = await fetch(B + ready.downloadUrl, {
      headers: { cookie: mainJar.cookie, "x-forwarded-for": RUN_IP },
    });
    const bytes = new Uint8Array(await zip.arrayBuffer());
    check(
      "download the export zip",
      zip.status === 200 &&
        zip.headers.get("content-type") === "application/zip" &&
        bytes[0] === 0x50 &&
        bytes[1] === 0x4b &&
        new TextDecoder().decode(bytes).includes("feedback.json"),
      `${zip.status} ${bytes.length}`,
    );
  }

  // Erase everything a reporter sent.
  const gone = `erase+${Date.now()}@example.com`;
  r = await W("/w/feedback", {
    method: "POST",
    json: { ...report, clientId: crypto.randomUUID(), reporter: { name: "Gone", email: gone } },
  });
  const goneId = r.body.feedback?.id;
  check("a report to erase", r.status === 201, r.status);
  r = await call("/api/privacy/erase", { method: "POST", json: { email: gone }, jar: memberJar });
  check("erasure is for Admins", r.status === 403, r.status);
  r = await call("/api/privacy/erase", { method: "POST", json: { email: "not-an-email" } });
  check("erasure validates the address", r.status === 400, r.status);
  r = await call("/api/privacy/erase", {
    method: "POST",
    json: { email: gone.toUpperCase(), dryRun: true },
  });
  check(
    "a dry run counts without deleting",
    r.status === 200 && r.body.result?.feedback === 1 && r.body.result?.dryRun === true,
    JSON.stringify(r.body.result),
  );
  r = await call(`/api/feedback/${goneId}`);
  check("the dry run deleted nothing", r.status === 200, r.status);
  r = await call("/api/privacy/erase", { method: "POST", json: { email: gone } });
  check(
    "erase the reporter's data",
    r.status === 200 && r.body.result?.feedback === 1,
    JSON.stringify(r.body.result),
  );
  r = await call(`/api/feedback/${goneId}`);
  check("their report is gone", r.status === 404, r.status);
  r = await call("/api/privacy/erasures");
  check(
    "the erasure is recorded without the address",
    r.status === 200 && r.body.erasures?.[0]?.feedback === 1 && !JSON.stringify(r.body).includes(gone),
    r.status,
  );
}

// =============================================================================================
// Wave 5 — integrations (docs/contracts/wave-5.md §3.6): Teams / Telegram / ntfy channels, Linear and
// Jira issue sync with signed inbound webhooks
// =============================================================================================
{
  console.log("\n— wave 5: integrations");
  // One local server plays Teams, ntfy and a Jira Cloud site (PINWREN_OUTBOUND_ALLOWLIST=127.0.0.1).
  const hits = [];
  const jiraIssues = new Map();
  const party = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      const path = new URL(req.url, "http://x").pathname;
      hits.push({ method: req.method, path, headers: req.headers, body });
      const json = (status, data) => {
        res.statusCode = status;
        res.setHeader("content-type", "application/json");
        res.end(data === undefined ? "" : JSON.stringify(data));
      };
      if (path.startsWith("/rest/api/3/")) {
        const basic = `Basic ${Buffer.from("smoke@example.com:atl-smoke-token").toString("base64")}`;
        if (req.headers.authorization !== basic) return json(401, { errorMessages: ["Unauthorized"] });
        if (path === "/rest/api/3/project/WEB") return json(200, { key: "WEB", name: "Website" });
        if (path === "/rest/api/3/issue/createmeta/WEB/issuetypes")
          return json(200, {
            issueTypes: [
              { id: "10", name: "Task" },
              { id: "11", name: "Bug" },
            ],
          });
        if (path === "/rest/api/3/issue" && req.method === "POST") {
          const key = `WEB-${jiraIssues.size + 1}`;
          jiraIssues.set(key, { fields: JSON.parse(body).fields, category: "new" });
          return json(201, { id: "1", key });
        }
        const tr = /^\/rest\/api\/3\/issue\/(WEB-\d+)\/transitions$/.exec(path);
        if (tr) {
          if (req.method === "GET")
            return json(200, {
              transitions: [
                { id: "31", to: { statusCategory: { key: "done" } } },
                { id: "11", to: { statusCategory: { key: "new" } } },
              ],
            });
          const issue = jiraIssues.get(tr[1]);
          if (issue) issue.category = JSON.parse(body).transition.id === "31" ? "done" : "new";
          res.statusCode = 204;
          return res.end();
        }
        return json(404, { errorMessages: ["No route"] });
      }
      json(200, { id: "msg" });
    });
  });
  await new Promise((resolve) => party.listen(0, listenHost, resolve));
  const partyBase = `http://${receiverHost}:${party.address().port}`;
  const created = [];
  try {
    // --- Chat channels -------------------------------------------------------------------------------
    r = await call("/api/webhooks", {
      method: "POST",
      json: { kind: "teams", url: `${partyBase}/workflows/smoke`, events: ["feedback.created"] },
      jar: memberJar,
    });
    check("Editors can't add a Teams webhook", r.status === 403, r.status);
    r = await call("/api/webhooks", {
      method: "POST",
      json: {
        kind: "teams",
        name: "Teams",
        url: `${partyBase}/workflows/smoke`,
        events: ["feedback.created"],
      },
    });
    const teams = r.body.webhook;
    created.push(teams?.id);
    check(
      "Teams webhook: no signing secret, URL masked",
      r.status === 201 && r.body.secret === null && !teams.url.includes("/workflows/smoke"),
      r.status,
    );
    r = await call(`/api/webhooks/${teams?.id}/test`, { method: "POST" });
    const card = hits.findLast((h) => h.path === "/workflows/smoke");
    check(
      "Teams test posts an Adaptive Card",
      r.body.delivery?.status === "success" &&
        JSON.parse(card?.body ?? "{}").attachments?.[0]?.contentType ===
          "application/vnd.microsoft.card.adaptive",
      r.body.delivery?.status,
    );

    r = await call("/api/webhooks", {
      method: "POST",
      json: {
        kind: "telegram",
        events: ["feedback.created"],
        botToken: "123456789:AAbbccddeeffgghhiijjkkllmmnnooppqq",
      },
    });
    check("Telegram needs a chat id", r.status === 400, r.status);
    r = await call("/api/webhooks", {
      method: "POST",
      json: {
        kind: "telegram",
        events: ["feedback.created", "feedback.priority_changed"],
        botToken: "123456789:AAbbccddeeffgghhiijjkkllmmnnooppqq",
        chatId: "-1001234567890",
      },
    });
    const tg = r.body.webhook;
    created.push(tg?.id);
    check(
      "Telegram webhook: token encrypted and masked, chat shown",
      r.status === 201 &&
        tg.chatId === "-1001234567890" &&
        tg.url === "https://api.telegram.org/bot123456789:…ppqq" &&
        !JSON.stringify(r.body).includes("AAbbcc"),
      `${r.status} ${tg?.url}`,
    );
    r = await call(`/api/webhooks/${tg?.id}`, { method: "PATCH", json: { url: "https://example.com/x" } });
    check("a Telegram webhook takes no URL", r.status === 400, r.status);
    r = await call(`/api/webhooks/${tg?.id}`, { method: "PATCH", json: { chatId: "@pinwren_smoke" } });
    check(
      "move a Telegram webhook to another chat",
      r.status === 200 && r.body.webhook?.chatId === "@pinwren_smoke",
    );

    r = await call("/api/webhooks", {
      method: "POST",
      json: { kind: "ntfy", url: `${partyBase}/`, events: ["feedback.created"] },
    });
    check("ntfy needs a topic URL", r.status === 400, r.status);
    r = await call("/api/webhooks", {
      method: "POST",
      json: {
        kind: "ntfy",
        url: `${partyBase}/smoke-topic`,
        accessToken: "tk_smoke",
        events: ["feedback.created"],
      },
    });
    const nt = r.body.webhook;
    created.push(nt?.id);
    check("ntfy webhook with an access token", r.status === 201 && nt.hasSecret === true, r.status);
    r = await call(`/api/webhooks/${nt?.id}/test`, { method: "POST" });
    const pub = hits.findLast((h) => h.path === "/" && h.method === "POST");
    check(
      "ntfy test publishes JSON to the server root with the token",
      r.body.delivery?.status === "success" &&
        pub?.headers.authorization === "Bearer tk_smoke" &&
        JSON.parse(pub?.body ?? "{}").topic === "smoke-topic",
      r.body.delivery?.status,
    );
    r = await call(`/api/webhooks/${nt?.id}`, { method: "PATCH", json: { accessToken: null } });
    check("remove the ntfy access token", r.status === 200 && r.body.webhook?.hasSecret === false);
    r = await call(`/api/webhooks/${nt?.id}/rotate-secret`, { method: "POST" });
    check("ntfy has no signing secret to rotate", r.status === 400, r.status);

    // A real event reaches the chat channels (payload id = the domain event id, shared by every endpoint).
    const before = hits.length;
    r = await W("/w/feedback", {
      method: "POST",
      json: w4report({ body: "Integrations smoke", kind: "bug" }),
    });
    const intFid = r.body.feedback?.id;
    const fanned = await waitFor(
      () => hits.slice(before).filter((h) => h.path === "/workflows/smoke").length >= 1,
    );
    check("new feedback reaches Teams", !!fanned);

    // --- Linear --------------------------------------------------------------------------------------
    r = await call(`/api/projects/${projectId}/integrations`, {
      method: "POST",
      json: { provider: "linear", token: "lin_api_smoke_key", repo: "acme/site" },
    });
    check("Linear wants a team key", r.status === 400, r.status);
    r = await call(`/api/projects/${projectId}/integrations`, {
      method: "POST",
      json: { provider: "linear", token: "lin_api_smoke_key", repo: "eng", apiUrl: "https://linear.example" },
    });
    check("Linear has no base URL", r.status === 400, r.status);
    r = await call(`/api/projects/${projectId}/integrations`, {
      method: "POST",
      json: { provider: "linear", token: "lin_api_smoke_key", repo: "eng" },
    });
    const lin = r.body.integration;
    check(
      "connect Linear (team key upper-cased, inbound URL)",
      r.status === 201 && lin.repo === "ENG" && lin.webhookUrl.endsWith("/api/integrations/linear/webhook"),
      r.status,
    );
    const linSecret = "lin_wh_smoke_signing_secret_0123456789";
    r = await call(`/api/integrations/${lin?.id}`, { method: "PATCH", json: { webhookSecret: linSecret } });
    check("paste Linear's signing secret", r.status === 200, r.status);
    const linearBody = (ts) =>
      JSON.stringify({
        action: "update",
        type: "Issue",
        webhookTimestamp: ts,
        updatedFrom: { stateId: "s0" },
        data: { identifier: "ENG-999", number: 999, team: { key: "ENG" }, state: { type: "completed" } },
      });
    const linearPost = (raw, sig, delivery) =>
      call("/api/integrations/linear/webhook", {
        method: "POST",
        rawBody: raw,
        jar: { cookie: "" },
        headers: {
          "content-type": "application/json",
          "linear-signature": sig,
          "linear-delivery": delivery,
        },
      });
    const fresh = linearBody(Date.now());
    const sign = (secret, raw) => createHmac("sha256", secret).update(raw).digest("hex");
    r = await linearPost(fresh, sign("wrong-secret-0123456789", fresh), crypto.randomUUID());
    check("Linear webhook: wrong signature refused", r.status === 401, r.status);
    const stale = linearBody(Date.now() - 60 * 60 * 1000);
    r = await linearPost(stale, sign(linSecret, stale), crypto.randomUUID());
    check("Linear webhook: stale timestamp refused", r.status === 401, r.status);
    const delivery = crypto.randomUUID();
    r = await linearPost(fresh, sign(linSecret, fresh), delivery);
    check(
      "Linear webhook: verified (no linked issue → ignored)",
      r.status === 200 && r.body.ignored === true,
      r.status,
    );
    r = await linearPost(fresh, sign(linSecret, fresh), delivery);
    check(
      "Linear webhook: a replayed delivery is not acted on twice",
      r.status === 200 && r.body.duplicate === true,
    );
    await call(`/api/integrations/${lin?.id}`, { method: "DELETE" });

    // --- Jira (Enterprise) -----------------------------------------------------------------------------
    const jiraBody = {
      provider: "jira",
      token: "atl-smoke-token",
      email: "smoke@example.com",
      repo: "web",
      apiUrl: partyBase,
      autoCreate: "manual",
    };
    r = await call(`/api/projects/${projectId}/integrations`, {
      method: "POST",
      json: { ...jiraBody, email: undefined },
    });
    check("Jira needs the account email", r.status === 400, r.status);
    r = await call("/api/admin/license", { jar: adminJar });
    const canLicense =
      r.status === 200 && r.body.license?.source !== "file" && r.body.license?.status === "none";
    r = await call(`/api/projects/${projectId}/integrations`, { method: "POST", json: jiraBody });
    if (r.status === 201) {
      check("Jira accepted (this instance already has a licence with Jira)", true);
      await call(`/api/integrations/${r.body.integration.id}`, { method: "DELETE" });
    } else {
      check(
        "Jira without a licence is refused",
        r.status === 403 && r.body.code === "LICENSE_REQUIRED",
        r.status,
      );
    }
    if (!canLicense) {
      skip("Jira sync checks", "needs an instance admin and no licence installed");
    } else {
      const { signLicense } = await import(pathToFileURL(join(root, "tools/sign-license/lib.mjs")).href);
      const devKey = readFileSync(join(root, "tools/sign-license/dev-private-key.pem"), "utf8");
      const lic = signLicense(
        {
          kid: "dev-2026",
          lid: `lic_smoke_jira_${Date.now()}`,
          customer: "Smoke GmbH",
          features: ["jira"],
          limits: {},
          issuedAt: new Date(Date.now() - 86_400_000).toISOString(),
          expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
          graceDays: 30,
        },
        devKey,
      );
      const licensed = await call("/api/admin/license", {
        method: "POST",
        json: { license: lic },
        jar: adminJar,
      });
      // A production build trusts only the production key, so the dev-signed licence is refused there.
      if (licensed.status !== 200) {
        skip("Jira sync checks", `the development licence was refused (${licensed.status})`);
      } else
        try {
          r = await call(`/api/projects/${projectId}/integrations`, { method: "POST", json: jiraBody });
          const jira = r.body.integration;
          check(
            "connect Jira with a licence (project key upper-cased, email shown, token hidden)",
            r.status === 201 &&
              jira.repo === "WEB" &&
              jira.email === "smoke@example.com" &&
              !JSON.stringify(r.body).includes("atl-smoke-token"),
            r.status,
          );
          r = await call(`/api/integrations/${jira?.id}/test`, { method: "POST" });
          check(
            "Jira test connection",
            r.body.ok === true && r.body.name === "Website (WEB)",
            JSON.stringify(r.body),
          );
          r = await call(`/api/feedback/${intFid}/issues`, {
            method: "POST",
            json: { integrationId: jira?.id },
          });
          const issue = r.body.issue;
          const sent = [...jiraIssues.values()][0];
          check(
            "Send to Jira: a Bug with an ADF description and a link back",
            r.status === 201 &&
              issue.provider === "jira" &&
              issue.url === `${partyBase}/browse/WEB-1` &&
              sent?.fields.issuetype.id === "11" &&
              sent?.fields.description.type === "doc" &&
              JSON.stringify(sent.fields.description).includes(`item=${intFid}`),
            r.status,
          );
          r = await call(`/api/integrations/${jira?.id}/webhook-secret`);
          const jiraSecret = r.body.secret;
          const raw = JSON.stringify({
            webhookEvent: "jira:issue_updated",
            timestamp: Date.now(),
            changelog: { items: [{ field: "status" }] },
            issue: {
              key: "WEB-1",
              fields: { project: { key: "WEB" }, status: { statusCategory: { key: "done" } } },
            },
          });
          const jiraPost = (sig, id) =>
            call("/api/integrations/jira/webhook", {
              method: "POST",
              rawBody: raw,
              jar: { cookie: "" },
              headers: {
                "content-type": "application/json",
                "x-hub-signature": sig,
                "x-atlassian-webhook-identifier": id,
              },
            });
          r = await jiraPost(`sha256=${"0".repeat(64)}`, crypto.randomUUID());
          check("Jira webhook: wrong signature refused", r.status === 401, r.status);
          const hookId = crypto.randomUUID();
          r = await jiraPost(`sha256=${createHmac("sha256", jiraSecret).update(raw).digest("hex")}`, hookId);
          check(
            "Jira webhook: moving to Done resolves the item",
            r.status === 200 && r.body.feedback?.status === "resolved",
            JSON.stringify(r.body),
          );
          r = await jiraPost(`sha256=${createHmac("sha256", jiraSecret).update(raw).digest("hex")}`, hookId);
          check("Jira webhook: replay ignored", r.body.duplicate === true);
          // Reopening in Pinwren moves the Jira issue back (through the issues queue).
          await call(`/api/feedback/${intFid}`, { method: "PATCH", json: { status: "open" } });
          const reopened = await waitFor(() => jiraIssues.get("WEB-1")?.category === "new", 15_000);
          check("reopening the item reopens the Jira issue", !!reopened, jiraIssues.get("WEB-1")?.category);
          await call(`/api/integrations/${jira?.id}`, { method: "DELETE" });
        } finally {
          await call("/api/admin/license", { method: "DELETE", jar: adminJar });
        }
    }
  } finally {
    for (const id of created.filter(Boolean)) await call(`/api/webhooks/${id}`, { method: "DELETE" });
    party.close();
  }
}

// =============================================================================================
// Wave 5 — email-notifications (docs/contracts/wave-5.md §3.2): personal + project notification
// settings, watchers, mentions, bell paging, the per-user stream event, team unsubscribe, SMTP test
// with unsaved values and the delivery log
// =============================================================================================
{
  console.log("\n— wave 5: email + notifications");
  // Personal switches: per project (with the wave-5 kinds) and account-wide (digest, pause).
  r = await call("/api/notification-preferences");
  const pref0 = r.body.preferences?.find((p) => p.projectId === projectId);
  check(
    "notification preferences carry mentions, priority and emailConfigured",
    r.status === 200 &&
      typeof r.body.emailConfigured === "boolean" &&
      pref0?.mentioned === true &&
      pref0?.priorityChanges === true,
    r.status,
  );
  r = await call("/api/notification-preferences", {
    method: "PUT",
    json: { projectId, mentioned: false, priorityChanges: false },
  });
  check(
    "switch mentions and priority off for a project",
    r.status === 200 &&
      r.body.preference?.mentioned === false &&
      r.body.preference?.priorityChanges === false,
    r.status,
  );
  await call("/api/notification-preferences", {
    method: "PUT",
    json: { projectId, mentioned: true, priorityChanges: true },
  });
  r = await call("/api/me/preferences");
  check(
    "account email preferences default to instant and not paused",
    r.status === 200 &&
      r.body.preferences?.emailDigest === "off" &&
      r.body.preferences?.emailPaused === false,
    JSON.stringify(r.body),
  );
  r = await call("/api/me/preferences", {
    method: "PATCH",
    json: { emailDigest: "daily", emailPaused: true },
  });
  check(
    "choose a daily digest and pause email",
    r.status === 200 &&
      r.body.preferences?.emailDigest === "daily" &&
      r.body.preferences?.emailPaused === true,
    r.status,
  );
  r = await call("/api/me/preferences", { method: "PATCH", json: { emailDigest: "weekly" } });
  check("an unknown digest frequency is refused", r.status === 400, r.status);
  await call("/api/me/preferences", { method: "PATCH", json: { emailDigest: "off", emailPaused: false } });
  r = await call("/api/me/preferences", { method: "PATCH", json: { emailPaused: false }, jar: viewerJar });
  check("a viewer manages their own email preferences", r.status === 200, r.status);

  // Notifications › General / › Reporter (Admins change them; everyone reads).
  r = await call(`/api/projects/${projectId}/notifications`);
  check(
    "read a project's notification settings",
    r.status === 200 &&
      r.body.notifications?.memberIds === null &&
      r.body.notifications?.reporter?.enabled === true &&
      r.body.notifications?.reporter?.received === true &&
      r.body.notifications?.reporter?.priorityChanged === false &&
      Array.isArray(r.body.members) &&
      r.body.members.some((m) => m.userId === memberId),
    r.status,
  );
  r = await call(`/api/projects/${projectId}/notifications`, { jar: viewerJar });
  check("a viewer reads them too", r.status === 200, r.status);
  r = await call(`/api/projects/${projectId}/notifications`, {
    method: "PATCH",
    json: { emails: ["x@example.com"] },
    jar: memberJar,
  });
  check(
    "an Editor can't change them",
    r.status === 403 && r.body.code === "FORBIDDEN_ROLE",
    `${r.status} ${r.body.code}`,
  );
  r = await call(`/api/projects/${projectId}/notifications`, {
    method: "PATCH",
    json: { memberIds: [crypto.randomUUID()] },
  });
  check("recipients must be members", r.status === 400 && r.body.code === "INVALID_MEMBER", r.status);
  r = await call(`/api/projects/${projectId}/notifications`, {
    method: "PATCH",
    json: { emails: ["not-an-address"] },
  });
  check("extra addresses are validated", r.status === 400, r.status);
  r = await call(`/api/projects/${projectId}/notifications`, {
    method: "PATCH",
    json: { emails: ["Boss@Example.com", "boss@example.com"], reporter: { priorityChanged: true } },
  });
  check(
    "set extra addresses (normalised) and a reporter switch",
    r.status === 200 &&
      JSON.stringify(r.body.notifications?.emails) === JSON.stringify(["boss@example.com"]) &&
      r.body.notifications?.reporter?.priorityChanged === true &&
      r.body.notifications?.reporter?.received === true,
    JSON.stringify(r.body.notifications),
  );
  await call(`/api/projects/${projectId}/notifications`, {
    method: "PATCH",
    json: { memberIds: null, emails: [], reporter: { priorityChanged: false } },
  });

  // A new report reaches the bell with its kind and reporter, through the per-user stream event.
  // (The wave-1 section switched new-feedback notifications off for this project.)
  await call("/api/notification-preferences", { method: "PUT", json: { projectId, newFeedback: true } });
  await call("/api/notifications/read", { method: "POST", json: { all: true } });
  const live = await openStream(mainJar);
  const mk = await W("/w/feedback", {
    method: "POST",
    json: { ...report, clientId: crypto.randomUUID(), screenshot: undefined },
  });
  const item = mk.body.feedback?.id;
  check("a report for the notification checks", mk.status === 201 && typeof item === "string", mk.status);
  const created = await waitFor(async () => {
    const n = await call("/api/notifications?unread=1");
    return n.body.items?.find((x) => x.feedbackId === item && x.type === "feedback.created");
  });
  check(
    "the bell names the kind and the reporter",
    created?.data?.kind === "bug" && created?.data?.actorName === "Maria",
    JSON.stringify(created?.data),
  );
  const pushed = await waitFor(() =>
    live.events.find((e) => e.event === "notification.created" && e.data?.feedbackId === item),
  );
  check(
    "notification.created is pushed to the recipient's stream after the row exists",
    pushed?.data?.id === created?.id && pushed?.data?.orgId === orgId,
    JSON.stringify(pushed?.data ?? null),
  );
  live.close();

  // Paging and filters.
  r = await call("/api/notifications?limit=1");
  const first = r.body.items?.[0];
  check(
    "notifications page with a cursor",
    r.status === 200 && r.body.items?.length === 1 && typeof r.body.nextCursor === "string",
    r.status,
  );
  r = await call(`/api/notifications?limit=1&before=${encodeURIComponent(r.body.nextCursor ?? "")}`);
  check(
    "the next page continues after the cursor",
    r.status === 200 && r.body.items?.length === 1 && r.body.items[0].id !== first?.id,
    r.status,
  );
  r = await call(`/api/notifications?projectId=${projectId}&limit=100`);
  check(
    "filter notifications by project",
    r.status === 200 && r.body.items.every((x) => x.data?.projectId === projectId),
    r.status,
  );
  r = await call("/api/notifications?limit=500");
  check("the page size is capped", r.status === 400, r.status);

  // Follow an item: status and priority changes reach followers.
  r = await call(`/api/feedback/${item}/watch`, { method: "POST", jar: memberJar });
  check("follow an item", r.status === 200 && r.body.watching === true, r.status);
  r = await call(`/api/feedback/${item}/watch`, { method: "POST", jar: viewerJar });
  check("a viewer can follow too", r.status === 200 && r.body.watching === true, r.status);
  r = await call(`/api/feedback/${item}/watch`, { method: "DELETE", jar: viewerJar });
  check("unfollow", r.status === 200 && r.body.watching === false, r.status);
  r = await call(`/api/feedback/${crypto.randomUUID()}/watch`, { method: "POST" });
  check("following an unknown item is a 404", r.status === 404, r.status);
  await call(`/api/feedback/${item}`, { method: "PATCH", json: { status: "in_progress", priority: "high" } });
  const followed = await waitFor(async () => {
    const n = await call("/api/notifications?unread=1", { jar: memberJar });
    const mine = n.body.items?.filter((x) => x.feedbackId === item) ?? [];
    return mine.some((x) => x.type === "feedback.status_changed") &&
      mine.some((x) => x.type === "feedback.priority_changed")
      ? mine
      : null;
  });
  check(
    "followers hear about status and priority changes",
    !!followed,
    JSON.stringify(followed?.map((x) => x.type) ?? []),
  );

  // @mentions (the comment handler stores them; dispatch turns them into a mention notification).
  r = await call(`/api/feedback/${item}/comments`, {
    method: "POST",
    json: { body: "@Smoke Member can you check this?", visibility: "internal", mentions: [memberId] },
  });
  if (r.status !== 201 && r.status !== 200) {
    skip("mention notification", `comment with mentions answered ${r.status}`);
  } else {
    const mentioned = await waitFor(async () => {
      const n = await call("/api/notifications?unread=1", { jar: memberJar });
      return n.body.items?.find((x) => x.feedbackId === item && x.type === "comment.mentioned");
    });
    check("the mentioned member gets a mention notification", !!mentioned);
    const n = await call("/api/notifications?unread=1", { jar: memberJar });
    const replies = n.body.items?.filter(
      (x) =>
        x.feedbackId === item && x.type === "comment.created" && x.data?.commentId === r.body.comment?.id,
    );
    check("…and no second, plain reply notification for that comment", replies?.length === 0);
  }

  // Mark one item's notifications read, then trash it: only the deletion notice stays listed.
  r = await call("/api/notifications/read", { method: "POST", json: { feedbackId: item }, jar: memberJar });
  check("opening an item reads its notifications", r.status === 200 && r.body.updated >= 1, r.status);
  r = await call(`/api/feedback/${item}`, { method: "DELETE" });
  check("trash the followed item", r.status === 204, r.status);
  const trashed = await waitFor(async () => {
    const n = await call("/api/notifications?limit=100", { jar: memberJar });
    const about = n.body.items?.filter((x) => x.feedbackId === item) ?? [];
    return about.some((x) => x.type === "feedback.deleted") ? about : null;
  });
  check(
    "followers hear about the deletion; the item's other notifications leave the list",
    !!trashed && trashed.every((x) => x.type === "feedback.deleted"),
    JSON.stringify(trashed?.map((x) => x.type) ?? []),
  );

  // Signed links in team emails: forged tokens get nothing.
  r = await call("/api/unsubscribe/team?token=forged.token", { jar: { cookie: "" } });
  check("a forged team unsubscribe link is refused", r.status === 400, r.status);
  r = await call("/api/unsubscribe/team?token=forged.token", {
    method: "POST",
    rawBody: "List-Unsubscribe=One-Click",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    jar: { cookie: "" },
  });
  check("one-click POST with a forged token is refused", r.status === 400, r.status);
  r = await call("/api/email-assets/forged.token", { jar: { cookie: "" } });
  check("a forged screenshot link serves nothing", r.status === 404, r.status);

  // SMTP: test unsaved values (verify first), From validation, the delivery log.
  r = await call("/api/admin/settings/email", { jar: adminJar });
  if (r.status !== 200) {
    skip(
      "SMTP test + delivery log",
      "needs an instance admin (PINWREN_ADMIN_EMAILS=smoke-admin@example.com)",
    );
  } else {
    const configured = r.body.email?.configured === true;
    const hostLocked = r.body.email?.locked?.host === true;
    r = await call("/api/admin/settings/email", {
      method: "PATCH",
      json: { from: "not an address" },
      jar: adminJar,
    });
    check(
      "an invalid From is refused",
      r.status === 400 && r.body.code === "INVALID_FROM",
      `${r.status} ${r.body.code}`,
    );
    if (hostLocked) {
      skip("test with unsaved values", "SMTP_HOST is set by the environment");
    } else {
      // Nothing listens on port 9 here: verify() fails, nothing is saved, the reason is categorised.
      r = await call("/api/admin/settings/email/test", {
        method: "POST",
        json: { config: { host: "127.0.0.1", port: 9, secure: false, from: "Smoke <smoke@example.com>" } },
        jar: adminJar,
      });
      check(
        "test with unsaved values reports the connection failure",
        r.status === 200 &&
          r.body.sent === false &&
          r.body.skipped === false &&
          /Connection|refused/i.test(r.body.reason),
        JSON.stringify(r.body),
      );
      r = await call("/api/admin/settings/email", { jar: adminJar });
      check("the tested values were not saved", r.body.email?.host !== "127.0.0.1", r.body.email?.host);
    }
    r = await call("/api/admin/settings/email/deliveries?limit=20", { jar: adminJar });
    check(
      "list recent email deliveries",
      r.status === 200 && Array.isArray(r.body.items) && typeof r.body.skippedNotConfigured === "number",
      r.status,
    );
    r = await call("/api/admin/settings/email/deliveries?limit=20", { jar: memberJar });
    check("the delivery log is for instance admins", r.status === 403, r.status);
    if (!configured) {
      const logged = await waitFor(async () => {
        const d = await call("/api/admin/settings/email/deliveries?status=skipped&limit=50", {
          jar: adminJar,
        });
        return d.body.items?.find((x) => x.templateKey === "feedback_created");
      });
      check(
        "an email skipped for missing SMTP is logged with the reason",
        logged?.status === "skipped" && logged?.error === "SMTP is not configured" && !("payload" in logged),
        JSON.stringify(logged ?? null),
      );
      r = await call("/api/admin/settings/email/deliveries/resend-skipped", {
        method: "POST",
        jar: adminJar,
      });
      check(
        "resending skipped emails needs SMTP first",
        r.status === 409 && r.body.code === "EMAIL_NOT_CONFIGURED",
        `${r.status} ${r.body.code}`,
      );
      if (logged) {
        r = await call(`/api/admin/settings/email/deliveries/${logged.id}/resend`, {
          method: "POST",
          jar: adminJar,
        });
        check("resending one email also needs SMTP", r.status === 409, r.status);
      }
    } else {
      skip("skipped-email log", "SMTP is configured on this instance");
    }
  }
}

// =============================================================================================
// Wave 5 — accounts (docs/contracts/wave-5.md §3.1): first-run state, Users › Add User, roles,
// own account (profile, avatar, email), workspaces, instance administrators
// =============================================================================================
{
  console.log("\n— wave 5: accounts");
  const anon = { cookie: "" };
  r = await call("/api/setup", { jar: anon });
  check(
    "public setup state",
    r.status === 200 &&
      r.body.needed === false &&
      typeof r.body.signupOpen === "boolean" &&
      typeof r.body.emailConfigured === "boolean" &&
      r.body.appUrl === new URL(B).origin,
    JSON.stringify(r.body),
  );
  const mailOn = r.body.emailConfigured === true;

  r = await call("/api/me");
  check(
    "me carries appRole, setupNeeded, emailConfigured, signupOpen",
    r.status === 200 &&
      r.body.appRole === "admin" &&
      r.body.setupNeeded === false &&
      typeof r.body.emailConfigured === "boolean" &&
      typeof r.body.signupOpen === "boolean" &&
      typeof r.body.user?.emailVerified === "boolean",
    JSON.stringify({ appRole: r.body.appRole, setupNeeded: r.body.setupNeeded }),
  );
  const ownerId = r.body.user?.id;
  r = await call("/api/me", { jar: memberJar });
  check("a member is an Editor", r.status === 200 && r.body.appRole === "editor", r.body.appRole);
  r = await call("/api/members");
  check(
    "members list carries app roles",
    r.status === 200 && r.body.members?.every((m) => ["admin", "editor", "viewer"].includes(m.appRole)),
  );

  // Users › Add User
  const addedEmail = `smoke-added+${Date.now()}@example.com`;
  const addedPassword = "added-password-1";
  r = await call("/api/members", {
    method: "POST",
    json: { name: "Added Person", email: addedEmail, password: addedPassword, role: "viewer" },
    jar: memberJar,
  });
  check("Editors can't add users", r.status === 403 && r.body.code === "FORBIDDEN_ROLE", r.status);
  r = await call("/api/members", {
    method: "POST",
    json: { name: "Added Person", email: addedEmail, password: "short", role: "viewer" },
  });
  check("Add User needs an 8-character password", r.status === 400, r.status);
  r = await call("/api/members", {
    method: "POST",
    json: { name: "Added Person", email: addedEmail, password: addedPassword, role: "viewer" },
  });
  check(
    "Admin adds a user directly",
    r.status === 201 && r.body.member?.appRole === "viewer" && r.body.member?.email === addedEmail,
    r.status,
  );
  const addedId = r.body.member?.userId;
  r = await call("/api/members", {
    method: "POST",
    json: { name: "Again", email: addedEmail.toUpperCase(), password: addedPassword, role: "viewer" },
  });
  check("an existing address is EMAIL_TAKEN", r.status === 409 && r.body.code === "EMAIL_TAKEN", r.status);

  const addedJar = { cookie: "" };
  r = await call("/api/auth/sign-in/email", {
    method: "POST",
    json: { email: addedEmail, password: addedPassword },
    jar: addedJar,
  });
  check("the added user signs in with the Admin's password", r.status === 200, r.status);
  await call("/api/auth/organization/set-active", {
    method: "POST",
    json: { organizationId: orgId },
    jar: addedJar,
  });
  r = await call("/api/me", { jar: addedJar });
  check(
    "the added user is a verified Viewer of the workspace",
    r.status === 200 && r.body.appRole === "viewer" && r.body.user?.emailVerified === true,
    r.body.appRole,
  );
  r = await call(`/api/feedback/${fid}`, { method: "PATCH", json: { status: "open" }, jar: addedJar });
  check("the Viewer can't change reports", r.status === 403 && r.body.code === "READ_ONLY_ROLE", r.status);

  // Roles
  r = await call(`/api/members/${addedId}`, { method: "PATCH", json: { role: "editor" } });
  check("Admin changes a role", r.status === 200 && r.body.member?.appRole === "editor", r.status);
  r = await call(`/api/members/${ownerId}`, { method: "PATCH", json: { role: "viewer" } });
  check("nobody changes their own role", r.status === 400 && r.body.code === "OWN_ROLE", r.status);
  await call(`/api/members/${addedId}`, { method: "PATCH", json: { role: "admin" } });
  r = await call(`/api/members/${ownerId}`, { method: "PATCH", json: { role: "editor" }, jar: addedJar });
  check("the owner can't be demoted", r.status === 400 && r.body.code === "OWNER_LOCKED", r.status);
  r = await call(`/api/members/${ownerId}`, { method: "DELETE", jar: addedJar });
  check("the owner can't be removed", r.status === 400 && r.body.code === "OWNER_LOCKED", r.status);
  await call(`/api/members/${addedId}`, { method: "PATCH", json: { role: "editor" } });

  // Password reset
  r = await call(`/api/members/${addedId}/reset-link`, { method: "POST" });
  check(
    "only instance admins copy reset links",
    r.status === 403 && r.body.code === "INSTANCE_ADMIN_REQUIRED",
    r.status,
  );
  r = await call("/api/auth/request-password-reset", {
    method: "POST",
    json: { email: addedEmail, redirectTo: "/reset-password" },
    jar: anon,
  });
  check("password reset can be requested", r.status === 200 && r.body.status === true, r.status);

  // Own account
  r = await call("/api/me/profile", { method: "PATCH", json: { name: "Added Renamed" }, jar: addedJar });
  check("profile rename", r.status === 200 && r.body.user?.name === "Added Renamed", r.status);
  r = await call("/api/me/profile", { method: "PATCH", json: { name: " " }, jar: addedJar });
  check("an empty name is refused", r.status === 400, r.status);
  r = await call("/api/me/avatar", { method: "POST", json: { dataUrl: png }, jar: addedJar });
  const avatar = r.body.image;
  check(
    "avatar upload",
    r.status === 200 && typeof avatar === "string" && avatar.startsWith(`/api/avatars/${addedId}`),
    r.status,
  );
  r = await call("/api/me/avatar", {
    method: "POST",
    json: { dataUrl: `data:image/png;base64,${Buffer.from("<svg/>").toString("base64")}` },
    jar: addedJar,
  });
  check("a fake image is refused", r.status === 400 && r.body.code === "INVALID_IMAGE", r.status);
  if (typeof avatar === "string") {
    const res = await fetch(B + avatar, { headers: { cookie: mainJar.cookie, "x-forwarded-for": RUN_IP } });
    check(
      "teammates see the avatar",
      res.status === 200 && res.headers.get("content-type") === "image/png",
      res.status,
    );
    const out = await fetch(B + avatar, { headers: { cookie: adminJar.cookie, "x-forwarded-for": RUN_IP } });
    check("people outside the workspace don't", out.status === 404 || out.status === 401, out.status);
  }
  r = await call("/api/me/avatar", { method: "DELETE", jar: addedJar });
  check("avatar removed", r.status === 200 && r.body.image === null, r.status);
  r = await call("/api/me/profile", {
    method: "PATCH",
    json: { name: "x" },
    jar: addedJar,
    headers: { origin: "https://evil.example" },
  });
  check(
    "a cross-site write names PINWREN_URL",
    r.status === 403 && r.body.code === "CROSS_SITE_REQUEST" && String(r.body.title).includes("PINWREN_URL"),
    r.status,
  );

  if (mailOn) {
    skip("email change with the password", "SMTP is configured: the change goes through a link");
  } else {
    const newEmail = `smoke-moved+${Date.now()}@example.com`;
    r = await call("/api/me/email", {
      method: "POST",
      json: { newEmail, password: "wrong-password" },
      jar: addedJar,
    });
    check(
      "email change needs the password",
      r.status === 400 && r.body.code === "INVALID_PASSWORD",
      r.status,
    );
    r = await call("/api/me/email", {
      method: "POST",
      json: { newEmail: email, password: addedPassword },
      jar: addedJar,
    });
    check(
      "email change refuses a taken address",
      r.status === 409 && r.body.code === "EMAIL_TAKEN",
      r.status,
    );
    r = await call("/api/me/email", {
      method: "POST",
      json: { newEmail, password: addedPassword },
      jar: addedJar,
    });
    check("email changed without SMTP", r.status === 200 && r.body.user?.email === newEmail, r.status);
    r = await call("/api/auth/sign-in/email", {
      method: "POST",
      json: { email: newEmail, password: addedPassword },
      jar: { cookie: "" },
    });
    check("sign in with the new address", r.status === 200, r.status);
  }

  // An invitation waiting for someone who signs up on their own
  const inviteeEmail = `smoke-invitee+${Date.now()}@example.com`;
  const invited = await call("/api/auth/organization/invite-member", {
    method: "POST",
    json: { email: inviteeEmail, role: "viewer" },
  });
  const inviteeJar = { cookie: "" };
  await call("/api/auth/sign-up/email", {
    method: "POST",
    json: { name: "Smoke Invitee", email: inviteeEmail, password: "invitee-password-1" },
    jar: inviteeJar,
  });
  r = await call("/api/me/invitations", { jar: inviteeJar });
  check(
    "onboarding sees the pending invitation",
    r.status === 200 && r.body.invitations?.some((i) => i.organizationId === orgId && i.appRole === "viewer"),
    `invite ${invited.status} ${invited.body?.code ?? ""}`,
  );
  r = await call("/api/me/invitations", { jar: anon });
  check("invitations need a session", r.status === 401, r.status);

  // Workspace settings
  r = await call("/api/workspace", { method: "PATCH", json: { name: "Renamed" }, jar: memberJar });
  check("Editors can't rename the workspace", r.status === 403 && r.body.code === "FORBIDDEN_ROLE", r.status);
  r = await call("/api/workspace", { method: "PATCH", json: { name: "Smoke Org" } });
  check("Admin renames the workspace", r.status === 200 && r.body.workspace?.name === "Smoke Org", r.status);
  r = await call("/api/workspace/transfer", { method: "POST", json: { userId: ownerId }, jar: addedJar });
  check("only the owner transfers", r.status === 403, r.status);
  r = await call("/api/workspace", { method: "DELETE", json: { confirm: "not the name" } });
  check("delete needs the exact name", r.status === 400 && r.body.code === "CONFIRM_MISMATCH", r.status);
  r = await call("/api/auth/organization/create", {
    method: "POST",
    json: { name: "Smoke Throwaway", slug: `smoke-throwaway-${Date.now()}` },
  });
  const throwaway = r.body.id;
  await call("/api/auth/organization/set-active", { method: "POST", json: { organizationId: throwaway } });
  r = await call("/api/workspace", { method: "DELETE", json: { confirm: "Smoke Throwaway" } });
  check("the owner deletes a workspace", r.status === 204, r.status);
  r = await call("/api/auth/organization/list");
  check("a deleted workspace is gone", Array.isArray(r.body) && !r.body.some((o) => o.id === throwaway));
  await call("/api/auth/organization/set-active", { method: "POST", json: { organizationId: orgId } });

  // Removing someone
  r = await call(`/api/members/${addedId}`, { method: "DELETE" });
  check("Admin removes a user", r.status === 204, r.status);
  r = await call("/api/me", { jar: addedJar });
  check("a removed user loses the workspace", r.status === 403 || r.status === 409, r.status);

  // Instance administrators (Settings › Security)
  r = await call("/api/admin/instance-admins");
  check("the administrators list is for instance admins", r.status === 403, r.status);
  if (isInstanceAdmin) {
    r = await call("/api/admin/instance-admins", { jar: adminJar });
    check(
      "instance admins listed with their source",
      r.status === 200 &&
        r.body.admins?.some((a) => a.source === "env") &&
        Array.isArray(r.body.pendingEmails),
      r.status,
    );
    const envAdmin = r.body.admins?.find((a) => a.source === "env");
    if (envAdmin) {
      r = await call(`/api/admin/instance-admins/${envAdmin.id}`, { method: "DELETE", jar: adminJar });
      check("env-listed admins are locked", r.status === 409 && r.body.code === "ENV_LOCKED", r.status);
    }
  } else {
    skip("instance administrators", "start the server with PINWREN_ADMIN_EMAILS=smoke-admin@example.com");
  }
}

// =============================================================================================
// Wave 5 — widget look and feel (SitePing parity): the sidebar's "All pages" list carries each item's
// page URL, and a reporter deletes their own feedback from the page (DELETE /w/feedback/:id with the
// reporter token; it goes to the trash like a dashboard delete).
// =============================================================================================
{
  r = await W("/w/feedback", {
    method: "POST",
    json: {
      clientId: crypto.randomUUID(),
      kind: "question",
      body: "Smoke: is this the final pricing?",
      page: { url: `${site}/pricing`, title: "Pricing" },
      environment: { userAgent: "smoke", viewport: { w: 1280, h: 800 }, dpr: 1 },
    },
  });
  check("sidebar: a question from the page", r.status === 201 && !!r.body.feedback?.reporterToken, r.status);
  const own = r.body.feedback ?? {};
  r = await W("/w/feedback?include=closed");
  const listed = Array.isArray(r.body.items) ? r.body.items.find((i) => i.id === own.id) : undefined;
  check(
    "sidebar: All pages lists items with their page URL",
    r.status === 200 && typeof listed?.pageUrl === "string" && listed.pageUrl.includes("/pricing"),
    listed?.pageUrl,
  );
  r = await call(`/w/feedback/${own.id}`, {
    method: "OPTIONS",
    jar: { cookie: "" },
    headers: { origin: site, "access-control-request-method": "DELETE" },
  });
  check(
    "sidebar: CORS preflight allows DELETE",
    (r.headers.get("access-control-allow-methods") ?? "").includes("DELETE"),
    r.headers.get("access-control-allow-methods"),
  );
  r = await W(`/w/feedback/${own.id}`, { method: "DELETE" });
  check(
    "sidebar: delete without the reporter token is refused",
    r.status === 403 && r.body.code === "DELETE_NOT_ALLOWED",
    r.status,
  );
  r = await W(`/w/feedback/${own.id}`, {
    method: "DELETE",
    headers: { "x-pinwren-reporter-token": "not-the-token" },
  });
  check("sidebar: delete with someone else's token is refused", r.status === 403, r.status);
  r = await W(`/w/feedback/${own.id}`, {
    method: "DELETE",
    headers: { "x-pinwren-reporter-token": own.reporterToken },
  });
  check("sidebar: the reporter deletes their own feedback", r.status === 204, r.status);
  r = await W("/w/feedback?include=closed");
  check(
    "sidebar: a deleted item is gone from the page",
    r.status === 200 && !r.body.items.some((i) => i.id === own.id),
  );
  r = await W(`/w/feedback/${own.id}`, {
    method: "DELETE",
    headers: { "x-pinwren-reporter-token": own.reporterToken },
  });
  check("sidebar: deleting twice is a 404", r.status === 404, r.status);
  r = await call(`/api/feedback/${own.id}/restore`, { method: "POST" });
  check("sidebar: an Admin can restore it from the trash", r.status === 200, r.status);
}

// =============================================================================================
// Wave 5 — widget (docs/contracts/wave-5.md §3.3): private pins for their reporter, signed page links,
// re-pin, page grouping (tracking parameters, trailing slash, ignored parameters), capture geometry and
// annotations, refused origins, visitor resolve limited to the reporter
// =============================================================================================
{
  console.log("\n— wave 5: widget data");
  // A project that keeps pins private (the new default), on the same test site.
  r = await call("/api/projects", {
    method: "POST",
    json: { name: "Smoke private pins", allowedOrigins: [new URL(site).host] },
  });
  const priv = r.body.project;
  check("a new project keeps pins private", r.status === 201 && priv?.publicRead === false, r.status);
  const P = (path, opts = {}) =>
    call(path, {
      ...opts,
      jar: { cookie: "" },
      headers: { "x-pinwren-key": priv?.publicKey, origin: site, ...(opts.headers ?? {}) },
    });
  const anchor = (css) => ({
    v: 1,
    css,
    xpath: "/html/body/h1",
    text: { content: "Pricing", prefix: "", suffix: "" },
    tag: "h1",
    structure: { depth: 2, siblingIndex: 0, childTagsHash: "smoke" },
    rect: { x: 10, y: 20, w: 300, h: 40, vw: 1280, vh: 800, scrollY: 0 },
    pin: { xPct: 50, yPct: 50 },
  });

  // Refused origin: recorded on the project for the Install tab.
  r = await P("/w/config", { headers: { origin: "https://not-allowed.example" } });
  check(
    "a refused origin still gets 403",
    r.status === 403 && r.body.code === "ORIGIN_NOT_ALLOWED",
    r.status,
  );
  r = await call(`/api/projects/${priv?.id}`);
  check(
    "the refused origin is recorded with a count",
    r.body.project?.rejectedOrigins?.some((o) => o.origin === "https://not-allowed.example" && o.count >= 1),
    JSON.stringify(r.body.project?.rejectedOrigins),
  );

  // A bug report with capture geometry and a vector annotation layer, from a URL with trackers.
  r = await P("/w/feedback", {
    method: "POST",
    json: {
      clientId: crypto.randomUUID(),
      kind: "bug",
      body: "Price column overlaps",
      page: { url: `${site}/pricing/?utm_source=mail&gclid=abc&pinwren=x&pwt=y` },
      environment: { userAgent: "smoke", viewport: { w: 1280, h: 800 }, dpr: 1 },
      reporter: { name: "Rita", email: "rita@example.com" },
      screenshot: png,
      capture: { vw: 1280, vh: 800, scrollY: 120, mode: "visible" },
      annotations: {
        v: 1,
        width: 1,
        height: 1,
        shapes: [
          {
            tool: "highlighter",
            color: "#f5a524",
            size: "m",
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ],
          },
          { tool: "step", color: "#0090ff", size: "s", at: { x: 0.5, y: 0.5 }, n: 1 },
        ],
      },
      metadata: { plan: "pro" },
    },
  });
  check(
    "bug report with capture + annotations accepted",
    r.status === 201,
    `${r.status} ${r.body.title ?? ""}`,
  );
  const bugId = r.body.feedback?.id;
  const bugToken = r.body.feedback?.reporterToken;
  r = await call(`/api/feedback/${bugId}`);
  const shotAsset = r.body.assets?.find((a) => a.kind === "screenshot");
  check(
    "tracking params, deep-link params and the trailing slash are dropped from the page",
    r.body.feedback?.pageUrl === `${site}/pricing`,
    r.body.feedback?.pageUrl,
  );
  check(
    "the screenshot asset carries the capture geometry and the annotations",
    shotAsset?.capture?.mode === "visible" &&
      shotAsset?.capture?.scrollY === 120 &&
      shotAsset?.annotations?.shapes?.length === 2,
    JSON.stringify(shotAsset?.capture),
  );

  // Private pins: nothing for visitors, everything for the reporter.
  r = await P(`/w/feedback?url=${encodeURIComponent(`${site}/pricing`)}`);
  check(
    "private pins: visitors see nothing",
    r.status === 200 && r.body.items.length === 0,
    r.body.items?.length,
  );
  r = await P("/w/mine", { headers: { "x-pinwren-reporter-tokens": `${bugToken},not-a-token` } });
  check(
    "GET /w/mine returns the reporter's own items",
    r.status === 200 && r.body.items.length === 1 && r.body.items[0].id === bugId,
    r.status,
  );
  r = await P(`/w/mine?url=${encodeURIComponent(`${site}/pricing?utm_campaign=z`)}`, {
    headers: { "x-pinwren-reporter-tokens": bugToken },
  });
  check("GET /w/mine filters by page (normalised)", r.body.items?.length === 1, r.body.items?.length);
  r = await P(`/w/mine?url=${encodeURIComponent(`${site}/elsewhere`)}`, {
    headers: { "x-pinwren-reporter-tokens": bugToken },
  });
  check("GET /w/mine: other pages' items left out", r.body.items?.length === 0, r.body.items?.length);
  r = await P("/w/mine");
  check("GET /w/mine without tokens is empty", r.status === 200 && r.body.items.length === 0, r.status);

  await call(`/api/feedback/${bugId}/comments`, {
    method: "POST",
    json: { body: "Looking into it", visibility: "public" },
  });
  r = await P(`/w/feedback/${bugId}/comments`);
  check("private thread hidden without a token", r.status === 404, r.status);
  r = await P(`/w/feedback/${bugId}/comments`, { headers: { "x-pinwren-reporter-token": bugToken } });
  check("the reporter reads the team's reply", r.status === 200 && r.body.items?.length === 1, r.status);
  r = await P(`/w/feedback/${bugId}/comments`, {
    method: "POST",
    json: { body: "Thanks!" },
    headers: { "x-pinwren-reporter-token": bugToken },
  });
  check("the reporter replies on a private thread", r.status === 201, r.status);
  r = await P(`/w/feedback/${bugId}/comments`, { method: "POST", json: { body: "Spam" } });
  check("a stranger can't reply on a private thread", r.status === 404, r.status);

  // Visitor resolve: only the reporter, unless the project allows visitors.
  r = await P(`/w/feedback/${bugId}`, { method: "PATCH", json: { status: "resolved" } });
  check(
    "visitors can't resolve by default",
    r.status === 403 && r.body.code === "RESOLVE_NOT_ALLOWED",
    r.status,
  );
  r = await P(`/w/feedback/${bugId}`, {
    method: "PATCH",
    json: { status: "resolved" },
    headers: { "x-pinwren-reporter-token": bugToken },
  });
  check(
    "the reporter resolves their own item",
    r.status === 200 && r.body.feedback?.status === "resolved",
    r.status,
  );

  // Signed page links ("Open on page", reporter emails).
  const comment = await P("/w/feedback", {
    method: "POST",
    json: {
      clientId: crypto.randomUUID(),
      kind: "comment",
      body: "Heading too small",
      page: { url: `${site}/pricing` },
      anchor: anchor("h1"),
      environment: { userAgent: "smoke", viewport: { w: 1280, h: 800 }, dpr: 1 },
    },
  });
  const cid = comment.body.feedback?.id;
  r = await call(`/api/feedback/${cid}/page-link`, { method: "POST" });
  const link = r.body.url ? new URL(r.body.url) : null;
  const pwt = link?.searchParams.get("pwt");
  check(
    "page link: the page URL with ?pinwren=<id>&pwt=<token>",
    r.status === 200 && link?.searchParams.get("pinwren") === cid && !!pwt && !!r.body.expiresAt,
    r.status,
  );
  r = await call(`/api/feedback/${cid}/page-link`, { method: "POST", jar: viewerJar });
  check("viewers may get a page link", r.status === 200, r.status);
  r = await call(`/api/feedback/${cid}/page-link`, { method: "POST", json: { repin: true }, jar: viewerJar });
  check("viewers can't get a re-pin link", r.status === 403 && r.body.code === "FORBIDDEN_ROLE", r.status);
  r = await P(`/w/feedback/${cid}`, { headers: { "x-pinwren-link-token": pwt } });
  check(
    "the link opens the private item and its replies",
    r.status === 200 && r.body.item?.id === cid && Array.isArray(r.body.replies) && r.body.scope === "read",
    r.status,
  );
  r = await P(`/w/feedback/${bugId}`, { headers: { "x-pinwren-link-token": pwt } });
  check("a link opens only its own item", r.status === 404, r.status);
  r = await P(`/w/feedback/${cid}`, { headers: { "x-pinwren-link-token": `${pwt}x` } });
  check("a tampered link is a 404", r.status === 404, r.status);
  r = await P(`/w/feedback/${cid}/comments`, { headers: { "x-pinwren-link-token": pwt } });
  check("the link reads the thread", r.status === 200, r.status);

  // Re-pin: a team-issued link moves the pin from the page; the session route does it from the API.
  r = await P(`/w/feedback/${cid}/anchor`, {
    method: "PATCH",
    json: { anchor: anchor("main h1") },
    headers: { "x-pinwren-link-token": pwt },
  });
  check("a read link can't move the pin", r.status === 403 && r.body.code === "REPIN_NOT_ALLOWED", r.status);
  r = await call(`/api/feedback/${cid}/page-link`, { method: "POST", json: { repin: true }, jar: memberJar });
  const repinToken = r.body.url ? new URL(r.body.url).searchParams.get("pwt") : null;
  check("an Editor gets a re-pin link", r.status === 200 && !!repinToken, r.status);
  r = await P(`/w/feedback/${cid}`, { headers: { "x-pinwren-link-token": repinToken } });
  check("the re-pin link says so", r.body.scope === "repin", r.body.scope);
  r = await P(`/w/feedback/${cid}/anchor`, {
    method: "PATCH",
    json: { anchor: anchor("main h1") },
    headers: { "x-pinwren-link-token": repinToken },
  });
  check("the widget re-pins with the link", r.status === 200, r.status);
  r = await call(`/api/feedback/${cid}`);
  check("the new anchor is stored", r.body.feedback?.anchor?.css === "main h1", r.body.feedback?.anchor?.css);
  r = await call(`/api/feedback/${cid}/anchor`, { method: "PATCH", json: { anchor: anchor("h1") } });
  check("the team re-pins through the API", r.status === 200, r.status);
  r = await call(`/api/feedback/${cid}/anchor`, { method: "PATCH", json: { anchor: { v: 2 } } });
  check("a malformed anchor is refused", r.status === 400, r.status);
  r = await call(`/api/feedback/${cid}/anchor`, {
    method: "PATCH",
    json: { anchor: anchor("h1") },
    jar: viewerJar,
  });
  check("viewers can't re-pin", r.status === 403, r.status);

  // URL grouping: a project's own ignored parameters, and re-grouping the pages already stored.
  for (const sid of ["1", "2"]) {
    await P("/w/feedback", {
      method: "POST",
      json: {
        clientId: crypto.randomUUID(),
        kind: "comment",
        body: `Session ${sid}`,
        page: { url: `${site}/account?sid=${sid}` },
        environment: { userAgent: "smoke", viewport: { w: 1280, h: 800 }, dpr: 1 },
      },
    });
  }
  r = await call(`/api/projects/${priv?.id}`, {
    method: "PATCH",
    json: { widgetConfig: { ignoredQueryParams: ["sid", "bad param!"] } },
  });
  check("an invalid ignored parameter is refused", r.status === 400, r.status);
  r = await call(`/api/projects/${priv?.id}`, {
    method: "PATCH",
    json: { widgetConfig: { ignoredQueryParams: ["sid"] } },
  });
  check(
    "ignored parameters saved",
    r.body.project?.widgetConfig?.ignoredQueryParams?.includes("sid"),
    r.status,
  );
  r = await call(`/api/projects/${priv?.id}/pages/regroup`, { method: "POST", jar: memberJar });
  check("Editors can't re-group pages", r.status === 403 && r.body.code === "FORBIDDEN_ROLE", r.status);
  r = await call(`/api/projects/${priv?.id}/pages/regroup`, { method: "POST" });
  check(
    "re-grouping merges the two session pages",
    r.status === 200 && r.body.merged >= 2,
    JSON.stringify(r.body),
  );
  r = await call(`/api/feedback?projectId=${priv?.id}&status=all&page=${encodeURIComponent("/account")}`);
  check(
    "both items now share one page",
    r.body.items?.length === 2 && r.body.items.every((i) => i.pageUrl === `${site}/account`),
    JSON.stringify(r.body.items?.map((i) => i.pageUrl)),
  );

  if (priv?.id) await call(`/api/projects/${priv.id}`, { method: "PATCH", json: { archived: true } });
}

// =============================================================================================
// Wave 5 — triage (docs/contracts/wave-5.md §3.4): labels, list sort/cursor/total/search, duplicates,
// mentions, comment edit/delete, reproduction, export, and the Admin-only trash.
// =============================================================================================
{
  const report = async (body) =>
    (
      await W("/w/feedback", {
        method: "POST",
        json: {
          clientId: crypto.randomUUID(),
          kind: "bug",
          body,
          page: { url: `${site}/triage`, title: "Triage" },
          environment: { userAgent: "smoke", viewport: { w: 1280, h: 800 }, dpr: 1 },
        },
      })
    ).body.feedback?.id;
  const t1 = await report("Triage smoke: checkout button broken");
  const t2 = await report("Triage smoke: second item");
  check("triage: two reports", !!t1 && !!t2);

  r = await call(`/api/projects/${projectId}/labels`, {
    method: "POST",
    json: { name: "Smoke-Checkout", color: "#E5484D" },
  });
  check("labels: an Admin creates one", r.status === 201 && r.body.label?.color === "#e5484d", r.status);
  const labelId = r.body.label?.id;
  r = await call(`/api/projects/${projectId}/labels`, {
    method: "POST",
    json: { name: "smoke-checkout", color: "#000" },
  });
  check(
    "labels: names are unique ignoring case",
    r.status === 409 && r.body.code === "LABEL_EXISTS",
    r.status,
  );
  r = await call(`/api/projects/${projectId}/labels`, {
    method: "POST",
    json: { name: "x", color: "#000" },
    jar: viewerJar,
  });
  check("labels: viewers can't create", r.status === 403, r.status);
  r = await call(`/api/feedback/${t1}`, {
    method: "PATCH",
    json: { labelIds: [labelId], dueAt: new Date(Date.now() + 86_400_000).toISOString() },
    jar: memberJar,
  });
  check("labels: an Editor labels an item and sets a due date", r.status === 200, r.status);
  r = await call(`/api/feedback?status=all&labelId=${labelId}`);
  check(
    "labels: list filter, labels and due date on rows, total",
    r.status === 200 &&
      r.body.items.length === 1 &&
      r.body.items[0].labels?.[0]?.name === "Smoke-Checkout" &&
      !!r.body.items[0].dueAt &&
      r.body.total === 1,
  );
  r = await call(`/api/projects/${projectId}/labels`);
  check("labels: list with counts", r.body.labels?.find((l) => l.id === labelId)?.count === 1);
  r = await call(`/api/feedback/${t1}`);
  check(
    "detail: labels, replyReach, watching, duplicates",
    r.body.feedback?.labels?.length === 1 &&
      typeof r.body.replyReach?.publicRead === "boolean" &&
      typeof r.body.watching === "boolean" &&
      Array.isArray(r.body.duplicates),
  );

  await call(`/api/feedback/${t2}`, { method: "PATCH", json: { duplicateOfId: t1, status: "duplicate" } });
  r = await call(`/api/feedback/${t1}`);
  check(
    "duplicates: listed on the original",
    r.body.duplicates?.some((d) => d.id === t2),
  );
  r = await call(`/api/feedback/${t2}`);
  check("duplicates: the duplicate names its original", r.body.feedback?.duplicateOf?.id === t1);

  r = await call("/api/feedback?status=all&limit=1&sort=priority&order=desc");
  const c1 = r.body.nextCursor ?? "";
  r = await call(
    `/api/feedback?status=all&limit=1&sort=priority&order=desc&cursor=${encodeURIComponent(c1)}`,
  );
  check("list: the cursor pages a priority sort", r.status === 200 && r.body.items.length === 1, r.status);
  r = await call("/api/feedback?status=all&cursor=garbage");
  check("list: a bad cursor is 400", r.status === 400, r.status);
  r = await call(`/api/feedback?status=all&q=${encodeURIComponent("checko")}`);
  check(
    "search: prefix words match",
    r.body.items?.some((i) => i.id === t1),
  );
  const n1 = (await call(`/api/feedback/${t1}`)).body.feedback?.number;
  r = await call(`/api/feedback?status=all&q=${encodeURIComponent(`#${n1}`)}`);
  check(
    "search: #number matches",
    r.body.items?.some((i) => i.id === t1),
  );
  r = await call(`/api/feedback?status=all&assigneeId=me&projectId=${projectId}`);
  check("list: assigneeId=me is the caller", r.status === 200, r.status);

  r = await call(`/api/feedback/${t1}/comments`, {
    method: "POST",
    json: { body: "@Smoke Member look", mentions: [memberId] },
  });
  check(
    "mentions: a member is stored on the comment",
    r.status === 201 && r.body.comment?.mentions?.includes(memberId),
    r.status,
  );
  const cid = r.body.comment?.id;
  r = await call(`/api/feedback/${t1}/comments`, {
    method: "POST",
    json: { body: "x", mentions: ["not-a-member"] },
  });
  check(
    "mentions: a non-member is 400 INVALID_MENTION",
    r.status === 400 && r.body.code === "INVALID_MENTION",
    r.status,
  );
  r = await call(`/api/comments/${cid}`, { method: "PATCH", json: { body: "edited" } });
  check("comments: edit (emits comment.updated)", r.status === 200, r.status);
  r = await call(`/api/comments/${cid}`, { method: "DELETE" });
  check("comments: delete (emits comment.deleted)", r.status === 204, r.status);

  r = await call(`/api/feedback/${t1}/reproduction`);
  check(
    "copy as Markdown: reproduction context",
    r.status === 200 && typeof r.body.markdown === "string",
    r.status,
  );

  const raw = (path) => fetch(B + path, { headers: { cookie: mainJar.cookie, "x-forwarded-for": RUN_IP } });
  let res = await raw(`/api/feedback/export?format=csv&status=all&projectId=${projectId}`);
  const csv = await res.text();
  check(
    "export: CSV of the filtered list",
    res.status === 200 && csv.includes("number,project,kind") && csv.includes("Triage smoke"),
    res.status,
  );
  r = await call(`/api/feedback/export?format=json&ids=${t1}`);
  check("export: JSON of selected ids", r.status === 200 && r.body.items?.[0]?.id === t1, r.status);
  res = await raw(`/api/feedback/export?format=pdf&ids=${t1}`);
  check(
    "export: PDF",
    res.status === 200 && (res.headers.get("content-type") ?? "").includes("pdf"),
    res.status,
  );

  r = await call(`/api/feedback/${t2}`, { method: "DELETE", jar: memberJar });
  check("trash: Editors can't delete", r.status === 403 && r.body.code === "FORBIDDEN_ROLE", r.status);
  r = await call(`/api/feedback/${t2}/forever`, { method: "DELETE" });
  check(
    "trash: delete forever needs the trash first",
    r.status === 400 && r.body.code === "NOT_IN_TRASH",
    r.status,
  );
  r = await call(`/api/feedback/${t2}`, { method: "DELETE" });
  check("trash: an Admin moves it to the trash", r.status === 204, r.status);
  r = await call("/api/feedback?trash=1", { jar: memberJar });
  check("trash: Editors can't list it", r.status === 403, r.status);
  r = await call(`/api/feedback?trash=1&status=all&projectId=${projectId}`);
  check("trash: Admins list it", r.status === 200 && r.body.items.some((i) => i.id === t2 && !!i.deletedAt));
  r = await call(`/api/feedback/${t2}/restore`, { method: "POST" });
  check("trash: restore", r.status === 200, r.status);
  r = await call(`/api/feedback/${t2}`);
  check(
    "trash: delete and restore are in the timeline",
    r.body.activity?.some((e) => e.type === "restored") && r.body.activity?.some((e) => e.type === "deleted"),
  );
  await call(`/api/feedback/${t2}`, { method: "DELETE" });
  r = await call(`/api/feedback/${t2}/forever`, { method: "DELETE" });
  check("trash: delete forever", r.status === 204, r.status);
  r = await call(`/api/labels/${labelId}`, { method: "DELETE" });
  check("labels: delete", r.status === 204, r.status);
}

// =============================================================================================
// Wave 5 — review links / guest review (docs/contracts/wave-5.md §3.5): reports sent through a link carry
// it as their source, the inbox filters by it, and the link counts what came through it
// =============================================================================================
{
  console.log("\n— wave 5: review links (guest review)");
  r = await call(`/api/projects/${projectId}/review-links`, {
    method: "POST",
    json: { label: "Guest round", url: `${site}/` },
  });
  const guestLinkId = r.body.link?.id;
  const guestToken = r.status === 201 ? new URL(r.body.url).searchParams.get("pinwren_review") : null;
  check(
    "guest review: create a link (no expiry)",
    r.status === 201 && !!guestToken && r.body.link.expiresAt === null && r.body.link.feedbackCount === 0,
    r.status,
  );
  const guestReport = (extra = {}) => ({
    clientId: crypto.randomUUID(),
    kind: "comment",
    body: "The hero headline wraps badly",
    page: { url: `${site}/`, title: "Home" },
    environment: { userAgent: "smoke", viewport: { w: 1280, h: 800 }, dpr: 1 },
    reporter: { name: "Guest Reviewer", email: "guest@example.com" },
    ...extra,
  });
  r = await W("/w/feedback", {
    method: "POST",
    json: guestReport(),
    headers: { "x-pinwren-review-token": guestToken ?? "" },
  });
  const guestItem = r.body.feedback?.id;
  check("guest review: a guest sends feedback through the link", r.status === 201 && !!guestItem, r.status);
  r = await W("/w/feedback", { method: "POST", json: guestReport({ body: "Sent without a link" }) });
  const plainItem = r.body.feedback?.id;
  check("guest review: a report without a link still goes in", r.status === 201, r.status);
  r = await W("/w/feedback", {
    method: "POST",
    json: guestReport({ body: "Sent with a forged link" }),
    headers: { "x-pinwren-review-token": "pwr_forged-token-that-does-not-exist" },
  });
  const forgedItem = r.body.feedback?.id;
  check("guest review: a forged token doesn't refuse the report", r.status === 201, r.status);

  r = await call(`/api/feedback/${guestItem}`);
  check(
    "guest review: the item shows the link as its source",
    r.status === 200 &&
      r.body.feedback?.reviewLink?.id === guestLinkId &&
      r.body.feedback.reviewLink.label === "Guest round" &&
      r.body.activity?.some((e) => e.type === "created" && e.data?.reviewLink === "Guest round"),
    JSON.stringify(r.body.feedback?.reviewLink),
  );
  r = await call(`/api/feedback/${forgedItem}`);
  check("guest review: a forged token isn't attributed", r.body.feedback?.reviewLink === null);
  r = await call(`/api/feedback?projectId=${projectId}&status=all&reviewLinkId=${guestLinkId}`);
  check(
    "guest review: the inbox filters by review link",
    r.status === 200 &&
      r.body.items.length === 1 &&
      r.body.items[0].id === guestItem &&
      !r.body.items.some((i) => i.id === plainItem || i.id === forgedItem),
    r.body.items?.length,
  );
  r = await call("/api/feedback?reviewLinkId=not-a-uuid");
  check("guest review: a malformed filter is a 400", r.status === 400, r.status);
  r = await call(`/api/projects/${projectId}/review-links`);
  check(
    "guest review: the link counts what came through it",
    r.body.links?.find((l) => l.id === guestLinkId)?.feedbackCount === 1,
    JSON.stringify(r.body.links?.find((l) => l.id === guestLinkId)),
  );
  r = await call(`/api/review-links/${guestLinkId}`, { method: "DELETE" });
  check("guest review: revoke the link", r.status === 204, r.status);
  r = await call(`/api/review-links/${guestLinkId}`, { method: "DELETE" });
  check("guest review: revoking twice is a 404", r.status === 404, r.status);
  r = await W("/w/feedback", {
    method: "POST",
    json: guestReport({ body: "Sent after the link was revoked" }),
    headers: { "x-pinwren-review-token": guestToken ?? "" },
  });
  const lateItem = r.body.feedback?.id;
  r = await call(`/api/feedback/${lateItem}`);
  check(
    "guest review: a revoked link no longer marks reports",
    r.status === 200 && r.body.feedback?.reviewLink === null,
    r.status,
  );
  r = await call(`/api/feedback/${guestItem}`);
  check(
    "guest review: earlier items keep their source after a revoke",
    r.body.feedback?.reviewLink?.label === "Guest round",
  );
  r = await W("/w/review-link", { headers: { "x-pinwren-review-token": "not a token" } });
  check("guest review: a malformed token is refused unchecked", r.status === 404, r.status);
  for (const id of [guestItem, plainItem, forgedItem, lateItem].filter(Boolean)) {
    await call(`/api/feedback/${id}`, { method: "DELETE" });
  }
}

// =============================================================================================
// Wave 5 — sign-in methods: what the auth pages offer (GET /api/sign-in-methods), the instance switches
// (Settings › Security), passkeys / connected accounts through Better Auth, and refusals while a method is
// off. Google / GitHub need real OAuth apps, so only "not configured" is checked here.
// =============================================================================================
{
  console.log("\n— wave 5: sign-in methods");
  const anon = { cookie: "" };
  r = await call("/api/sign-in-methods", { jar: anon });
  const methods = r.body.methods;
  check(
    "sign-in methods: public, password always offered",
    r.status === 200 &&
      methods?.password === true &&
      ["magicLink", "passkey", "google", "github"].every((k) => typeof methods[k] === "boolean"),
    r.status,
  );
  r = await call("/api/admin/settings/sign-in", { jar: memberJar });
  check("sign-in methods: non-admins can't read the instance switches", r.status === 403, r.status);

  r = await call("/api/auth/list-accounts");
  check(
    "sign-in methods: the password account is listed",
    r.status === 200 && Array.isArray(r.body) && r.body.some((a) => a.providerId === "credential"),
    r.status,
  );
  r = await call("/api/auth/passkey/list-user-passkeys");
  check("sign-in methods: passkeys list (none yet)", r.status === 200 && Array.isArray(r.body), r.status);
  r = await call("/api/auth/passkey/list-user-passkeys", { jar: anon });
  check("sign-in methods: passkeys need a session", r.status === 401, r.status);

  for (const provider of ["google", "github"]) {
    if (methods?.[provider]) {
      skip(`sign-in methods: ${provider} refused when unconfigured`, `${provider} is configured here`);
      continue;
    }
    r = await call("/api/auth/sign-in/social", {
      method: "POST",
      json: { provider, callbackURL: "/inbox" },
      jar: anon,
    });
    check(`sign-in methods: ${provider} refused when unconfigured`, r.status === 404, r.status);
  }

  if (methods && !methods.magicLink) {
    r = await call("/api/auth/sign-in/magic-link", {
      method: "POST",
      json: { email: `nobody+${Date.now()}@example.com`, callbackURL: "/inbox" },
      jar: anon,
    });
    check(
      "sign-in methods: email links refused without SMTP (or switched off)",
      r.status === 400 && r.body.code === "MAGIC_LINK_DISABLED",
      `${r.status} ${r.body.code}`,
    );
  } else {
    r = await call("/api/auth/sign-in/magic-link", {
      method: "POST",
      json: { email: `nobody+${Date.now()}@example.com`, callbackURL: "/inbox" },
      jar: anon,
    });
    check(
      "sign-in methods: an email link answers the same for unknown addresses",
      r.status === 200,
      r.status,
    );
  }

  r = await call("/api/admin/settings/sign-in", { jar: adminJar });
  if (r.status === 403) {
    skip(
      "sign-in methods: instance switches",
      "start the server with PINWREN_ADMIN_EMAILS=smoke-admin@example.com",
    );
  } else {
    const before = r.body.signIn;
    check(
      "sign-in methods: admin reads the switches and provider callbacks",
      r.status === 200 &&
        typeof before?.magicLink === "boolean" &&
        typeof before?.passkeys === "boolean" &&
        before.providers?.length === 2 &&
        before.providers.every((p) => p.callbackUrl.endsWith(`/api/auth/callback/${p.id}`)),
      r.status,
    );
    r = await call("/api/admin/settings/sign-in", { method: "PATCH", json: {}, jar: adminJar });
    check("sign-in methods: an empty change is a 400", r.status === 400, r.status);
    r = await call("/api/admin/settings/sign-in", {
      method: "PATCH",
      json: { passkeys: false, googleClientSecret: "nope" },
      jar: adminJar,
    });
    check("sign-in methods: unknown fields are refused", r.status === 400, r.status);
    r = await call("/api/admin/settings/sign-in", {
      method: "PATCH",
      json: { passkeys: false },
      jar: adminJar,
    });
    check(
      "sign-in methods: switch passkeys off",
      r.status === 200 && r.body.signIn?.passkeys === false,
      r.status,
    );
    r = await call("/api/sign-in-methods", { jar: anon });
    check("sign-in methods: the sign-in page stops offering passkeys", r.body.methods?.passkey === false);
    r = await call("/api/auth/passkey/generate-authenticate-options", { jar: anon });
    check(
      "sign-in methods: passkey sign-in refused while off",
      r.status === 400 && r.body.code === "PASSKEYS_DISABLED",
      `${r.status} ${r.body.code}`,
    );
    r = await call("/api/auth/passkey/list-user-passkeys");
    check("sign-in methods: listing passkeys still works while off", r.status === 200, r.status);
    r = await call("/api/admin/settings/sign-in", {
      method: "PATCH",
      json: { passkeys: before?.passkeys ?? true, magicLink: before?.magicLink ?? true },
      jar: adminJar,
    });
    check("sign-in methods: restore the switches", r.status === 200, r.status);
    if (before?.passkeys !== false) {
      r = await call("/api/auth/passkey/generate-authenticate-options", { jar: anon });
      check(
        "sign-in methods: passkey sign-in options once back on",
        r.status === 200 && typeof r.body.challenge === "string",
        r.status,
      );
    }
  }
}

// =============================================================================================
// AI Triage & Enrichment (WP-27)
// =============================================================================================
console.log("\n— AI triage & enrichment");

const aiMockRequests = [];
const aiMockServer = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    aiMockRequests.push({ method: req.method, url: req.url, body });
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");

    let responseContent = { ok: true };
    if (body.includes("Target Locale:") || body.includes("text_to_translate")) {
      responseContent = { translatedText: "Texto traducido de prueba" };
    } else if (body.includes("summary") || body.includes("summarize")) {
      responseContent = {
        summary: "Checkout button fails on submit",
        suggestedTitle: "Fix checkout submit handler",
      };
    } else if (body.includes("severity") || body.includes("priority")) {
      responseContent = {
        suggestedPriority: "high",
        suggestedKind: "bug",
        confidence: 0.9,
        reasoning: "Error in checkout flow",
      };
    } else if (body.includes("reproduction") || body.includes("repro")) {
      responseContent = {
        steps: ["1. Open checkout page", "2. Click pay now"],
        notes: "Reproduced consistently",
      };
    } else if (body.includes("duplicate")) {
      responseContent = {
        isDuplicate: false,
        confidence: 0.1,
        reason: "Different error stack",
      };
    }

    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(responseContent),
            },
          },
        ],
      }),
    );
  });
});

await new Promise((resolve) => aiMockServer.listen(0, listenHost, resolve));
const aiMockBase = `http://${receiverHost}:${aiMockServer.address().port}`;

try {
  // 1. GET /api/settings/ai without session returns 401
  r = await call("/api/settings/ai", { jar: { cookie: "" } });
  check("AI settings: without session returns 401", r.status === 401, r.status);

  // Non-admin member cannot manage AI settings
  r = await call("/api/settings/ai", { jar: memberJar });
  check("AI settings: member cannot access AI settings", r.status === 403, r.status);

  // 2. PUT /api/settings/ai saves encrypted credentials
  const testSecretKey = "sk-smoke-secret-key-123456789";
  r = await call("/api/settings/ai", {
    method: "PUT",
    json: {
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: testSecretKey,
      baseUrl: `${aiMockBase}/v1`,
      enabled: true,
    },
  });
  check(
    "AI settings: save credentials (PUT)",
    r.status === 200 && r.body.hasKey === true && r.body.enabled === true,
    r.status,
  );

  r = await call("/api/settings/ai");
  check(
    "AI settings: read back masks raw API key",
    r.status === 200 &&
      r.body.provider === "openai" &&
      r.body.model === "gpt-4o-mini" &&
      r.body.hasKey === true &&
      !JSON.stringify(r.body).includes(testSecretKey),
    r.status,
  );

  // 3. POST /api/settings/ai/test tests connection
  r = await call("/api/settings/ai/test", {
    method: "POST",
    json: {
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: testSecretKey,
      baseUrl: `${aiMockBase}/v1`,
    },
  });
  check(
    "AI settings: test connection succeeds",
    r.status === 200 && r.body.ok === true && typeof r.body.latencyMs === "number",
    r.status,
  );

  // 4. GET /api/projects/:id/ai returns project AI configuration
  r = await call(`/api/projects/${projectId}/ai`);
  check(
    "project AI config: default configuration returned",
    r.status === 200 &&
      typeof r.body.enabled === "boolean" &&
      typeof r.body.autoSummary === "boolean" &&
      typeof r.body.autoSeverity === "boolean",
    r.status,
  );

  // PATCH /api/projects/:id/ai updates configuration
  r = await call(`/api/projects/${projectId}/ai`, {
    method: "PATCH",
    json: { enabled: true, autoSummary: true, autoSeverity: true },
  });
  check(
    "project AI config: patch settings",
    r.status === 200 && r.body.enabled === true && r.body.autoSummary === true,
    r.status,
  );

  // 5. Ingest feedback -> verify feedback_ai row creation and status
  const aiReport = {
    ...report,
    clientId: crypto.randomUUID(),
    body: "AI smoke: Payment modal fails to load after clicking checkout button",
    diagnostics: {
      console: [{ level: "error", message: "TypeError: failed to fetch stripe checkout", at: Date.now() }],
      network: [{ method: "POST", url: "/api/pay", status: 500, durationMs: 140, at: Date.now() }],
    },
  };
  r = await W("/w/feedback", { method: "POST", json: aiReport });
  check("AI ingest: submit feedback report via widget", r.status === 201, r.status);
  const aiFeedbackId = r.body.feedback?.id;

  const enriched = await waitFor(async () => {
    const detail = await call(`/api/feedback/${aiFeedbackId}`);
    return detail.body.ai && detail.body.ai.status !== "pending" ? detail : null;
  }, 20_000);

  check(
    "AI enrich: background worker enriched feedback",
    !!enriched && ["completed", "skipped"].includes(enriched.body.ai?.status),
    enriched ? `status=${enriched.body.ai?.status}` : "timeout",
  );

  // Feedback AI translate and apply endpoints
  r = await call(`/api/feedback/${aiFeedbackId}/ai/translate`, {
    method: "POST",
    json: { targetLocale: "es" },
  });
  check(
    "AI translate: translate feedback endpoint",
    r.status === 200 && typeof r.body.body === "string",
    r.status,
  );

  r = await call(`/api/feedback/${aiFeedbackId}/ai/apply`, {
    method: "POST",
    json: { applyTitle: true, applyPriority: true },
  });
  check("AI triage apply: apply suggestions endpoint", r.status === 200 && r.body.ok === true, r.status);
} finally {
  aiMockServer.close();
}

console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
console.log(process.exitCode ? "SMOKE FAILED" : "SMOKE OK");
