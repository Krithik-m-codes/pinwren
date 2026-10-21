// End-to-end API smoke test: node scripts/smoke.mjs [baseUrl]
//
// Instance-admin checks need the server started with PINWREN_ADMIN_EMAILS=smoke-admin@example.com
// (or SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD pointing at an existing admin); otherwise they are
// skipped. Webhook checks start a local HTTP receiver, so the server must be able to reach 127.0.0.1.
import { createHmac } from "node:crypto";
import { createServer } from "node:http";

const B = process.argv[2] ?? "http://localhost:3100";
const mainJar = { cookie: "" };
async function call(path, { method = "GET", json, rawBody, headers = {}, jar = mainJar } = {}) {
  const res = await fetch(B + path, {
    method,
    headers: {
      ...(json ? { "content-type": "application/json" } : {}),
      ...(jar.cookie ? { cookie: jar.cookie } : {}),
      origin: B,
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
    received.find((x) => x.headers["pinwren-event"] === "feedback.created" && x.body.includes(fid4)),
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
  check(
    "widget config carries branding",
    r.body.branding?.hidePoweredBy === true &&
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
      r.body.templates.length === 7 &&
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
      ghIssue.body.includes(`/inbox?status=all&item=${bugId}`) &&
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
  );

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

console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
console.log(process.exitCode ? "SMOKE FAILED" : "SMOKE OK");
