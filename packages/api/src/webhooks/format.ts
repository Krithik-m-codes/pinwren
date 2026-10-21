import { hmacSha256Hex } from "../crypto";

export const WEBHOOK_API_VERSION = "2026-11-01";

export type FeedbackPayload = {
  id: string;
  number: number;
  projectId: string;
  projectName: string;
  kind: string;
  status: string;
  priority: string;
  title: string | null;
  body: string;
  pageUrl: string | null;
  reporterName: string | null;
  assigneeIds: string[];
  createdAt: string;
  updatedAt: string;
  url: string;
};

export type CommentPayload = {
  id: string;
  body: string;
  visibility: string;
  authorName: string | null;
  team: boolean;
  createdAt: string;
};

/** The versioned generic payload (blueprint 04 §5). Slack/Discord bodies are derived from it. */
export type WebhookPayload = {
  id: string;
  event: string;
  apiVersion: string;
  createdAt: string;
  data: {
    feedback: FeedbackPayload;
    comment?: CommentPayload;
    changes?: Record<string, { from: unknown; to: unknown }>;
    actor?: { kind: string; id: string | null };
    /** Panel action runs (`action.run`, F-016). */
    action?: { id: string; label: string };
  };
};

/** `Pinwren-Signature: v1=<hex HMAC-SHA256(secret, timestamp + "." + body)>`. */
export function signBody(secret: string, timestamp: number, body: string): string {
  return `v1=${hmacSha256Hex(secret, `${timestamp}.${body}`)}`;
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// --- Slack ---------------------------------------------------------------------------------------------
// Slack parses `<…>` as links/mentions (`<!channel>`, `<@U123>`) and *_~` as formatting in mrkdwn.
// Untrusted text is always entity-escaped (&, <, >), so it can never form a mention or link; in mrkdwn
// its formatting characters are also broken with a zero-width space. Bodies go in plain_text blocks,
// which Slack never formats.

const slackEntities = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function slackEscape(s: string): string {
  return slackEntities(s).replace(/([*_~`|])/g, "\u200b$1\u200b");
}

const plain = (s: string) => ({ type: "plain_text", text: slackEntities(s), emoji: false });

const EVENT_TITLES: Record<string, string> = {
  "feedback.created": "New feedback",
  "feedback.updated": "Feedback updated",
  "feedback.status_changed": "Status changed",
  "feedback.assigned": "Assignee changed",
  "comment.created": "New comment",
  ping: "Test delivery",
};

function headline(p: WebhookPayload): string {
  const f = p.data.feedback;
  const what = f.title?.trim() || truncate(f.body.replace(/\s+/g, " "), 80);
  let extra = "";
  if (p.event === "feedback.status_changed" && p.data.changes?.status)
    extra = ` → ${String(p.data.changes.status.to)}`;
  return `${EVENT_TITLES[p.event] ?? p.event}${extra}: ${f.projectName} #${f.number} ${what}`;
}

export function slackBody(p: WebhookPayload): object {
  const f = p.data.feedback;
  const text = p.event === "comment.created" && p.data.comment ? p.data.comment.body : f.body;
  const link = /^https?:\/\//.test(f.url) ? f.url : null;
  const title = `*${slackEscape(EVENT_TITLES[p.event] ?? p.event)}* · ${
    link
      ? `<${link}|${slackEscape(`${f.projectName} #${f.number}`)}>`
      : slackEscape(`${f.projectName} #${f.number}`)
  }`;
  const context = [
    `${f.kind} · ${f.status} · ${f.priority}`,
    f.reporterName ? `from ${f.reporterName}` : null,
    f.pageUrl ? f.pageUrl : null,
  ].filter(Boolean) as string[];
  return {
    text: slackEscape(headline(p)),
    unfurl_links: false,
    unfurl_media: false,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: title } },
      ...(f.title ? [{ type: "section", text: plain(truncate(f.title, 300)) }] : []),
      { type: "section", text: plain(truncate(text || " ", 2900)) },
      { type: "context", elements: [plain(truncate(context.join(" · "), 1900))] },
    ],
  };
}

// --- Discord -------------------------------------------------------------------------------------------
// Mentions are disabled with `allowed_mentions: { parse: [] }`; markdown characters are backslash-escaped
// and `@` is broken so `@everyone` doesn't even look like a mention.

export function discordEscape(s: string): string {
  return s.replace(/([\\*_~`|>#\-[\]()<:])/g, "\\$1").replaceAll("@", "@\u200b");
}

export function discordBody(p: WebhookPayload): object {
  const f = p.data.feedback;
  const text = p.event === "comment.created" && p.data.comment ? p.data.comment.body : f.body;
  const link = /^https?:\/\//.test(f.url) ? f.url : undefined;
  const fields = [
    { name: "Kind", value: discordEscape(f.kind), inline: true },
    { name: "Status", value: discordEscape(f.status), inline: true },
    { name: "Priority", value: discordEscape(f.priority), inline: true },
    ...(f.reporterName
      ? [{ name: "Reporter", value: truncate(discordEscape(f.reporterName), 1000), inline: true }]
      : []),
    ...(f.pageUrl ? [{ name: "Page", value: truncate(discordEscape(f.pageUrl), 1000), inline: false }] : []),
  ];
  return {
    content: truncate(discordEscape(headline(p)), 1900),
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: truncate(discordEscape(`${f.projectName} #${f.number}${f.title ? ` — ${f.title}` : ""}`), 250),
        ...(link ? { url: link } : {}),
        description: truncate(discordEscape(text || " "), 3900),
        color: 0x5b5bd6,
        fields,
        timestamp: p.createdAt,
      },
    ],
  };
}

export type OutboundRequest = { body: string; headers: Record<string, string> };

/** Build the HTTP request for one attempt. Generic bodies are signed; chat bodies carry no secret. */
export function buildRequest(
  kind: "generic" | "slack" | "discord",
  payload: WebhookPayload,
  secret: string | null,
  now = Math.floor(Date.now() / 1000),
): OutboundRequest {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "Pinwren-Webhooks/1",
  };
  if (kind === "slack") return { body: JSON.stringify(slackBody(payload)), headers };
  if (kind === "discord") return { body: JSON.stringify(discordBody(payload)), headers };
  const body = JSON.stringify(payload);
  headers["pinwren-event"] = payload.event;
  headers["pinwren-delivery"] = payload.id;
  headers["pinwren-timestamp"] = String(now);
  if (secret) headers["pinwren-signature"] = signBody(secret, now, body);
  return { body, headers };
}
