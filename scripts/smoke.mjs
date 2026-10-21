// End-to-end API smoke test: node scripts/smoke.mjs [baseUrl]
//
// Instance-admin checks need the server started with ANNOTA_ADMIN_EMAILS=smoke-admin@example.com
// (or SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD pointing at an existing admin); otherwise they are
// skipped. Webhook checks start a local HTTP receiver, so the server must be able to reach 127.0.0.1.
import { createHmac } from "node:crypto";
import { createServer } from "node:http";

const B = process.argv[2] ?? "http://localhost:3100";
const mainJar = { cookie: "" };
async function call(path, { method = "GET", json, headers = {}, jar = mainJar } = {}) {
  const res = await fetch(B + path, {
    method,
    headers: {
      ...(json ? { "content-type": "application/json" } : {}),
      ...(jar.cookie ? { cookie: jar.cookie } : {}),
      origin: B,
      ...headers,
    },
    body: json ? JSON.stringify(json) : undefined,
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

const site = "http://localhost:5173";
const W = (path, opts = {}) =>
  call(path, {
    ...opts,
    jar: { cookie: "" },
    headers: { "x-annota-key": publicKey, origin: site, ...(opts.headers ?? {}) },
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
    cfg.widget?.visitorsCanResolve === true &&
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
  headers: { "x-annota-reporter-token": `${token2.slice(0, -2)}xx` },
});
check("resolve with a wrong token is 403", r.status === 403, r.status);
r = await W(`/w/feedback/${fid2}`, {
  method: "PATCH",
  json: { status: "resolved" },
  headers: { "x-annota-reporter-token": token2 },
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
  const ts = req.headers["annota-timestamp"];
  const expected = `v1=${createHmac("sha256", secret).update(`${ts}.${req.body}`).digest("hex")}`;
  return req.headers["annota-signature"] === expected && Math.abs(Date.now() / 1000 - Number(ts)) < 300;
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
  const ping = received.find((x) => x.headers["annota-event"] === "ping");
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
    received.find((x) => x.headers["annota-event"] === "feedback.created" && x.body.includes(fid4)),
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
} finally {
  receiver.close();
}

// --- API tokens + public API -----------------------------------------------------------------------
console.log("\n— public API");
r = await call("/api/tokens", { method: "POST", json: { name: "read only", scopes: ["feedback:read"] } });
check(
  "create read token (secret shown once)",
  r.status === 201 && r.body.secret?.startsWith("ann_"),
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
  skip("instance email settings", "start the server with ANNOTA_ADMIN_EMAILS=smoke-admin@example.com");
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

console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
console.log(process.exitCode ? "SMOKE FAILED" : "SMOKE OK");
