import { kindLabel, type WebhookKind } from "@pinwren/core";
import { hmacSha256Hex } from "../crypto";
import { parseTelegramTarget } from "./url";

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
  /** The review link's label when the item came in through one (older payloads leave it out). */
  reviewLink?: string | null;
  assigneeIds: string[];
  createdAt: string;
  updatedAt: string;
  url: string;
};

/** "via review link “Client round 2”" for chat messages, or null. */
const viaReviewLink = (f: FeedbackPayload) => (f.reviewLink ? `via review link “${f.reviewLink}”` : null);

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

export const EVENT_TITLES: Record<string, string> = {
  "feedback.created": "New feedback",
  "feedback.updated": "Feedback updated",
  "feedback.status_changed": "Status changed",
  "feedback.assigned": "Assignee changed",
  "feedback.priority_changed": "Priority changed",
  "feedback.labels_changed": "Labels changed",
  "feedback.deleted": "Feedback deleted",
  "comment.created": "New comment",
  "comment.updated": "Comment edited",
  "comment.deleted": "Comment deleted",
  ping: "Test delivery",
};

/** The event's name plus what it changed to, when that's a value worth showing (status, priority). */
export function eventTitle(p: WebhookPayload): string {
  const c = p.data.changes;
  let extra = "";
  if (p.event === "feedback.status_changed" && c?.status) extra = ` → ${String(c.status.to)}`;
  if (p.event === "feedback.priority_changed" && c?.priority) extra = ` → ${String(c.priority.to)}`;
  return `${EVENT_TITLES[p.event] ?? p.event}${extra}`;
}

/** The text a chat message quotes: the comment for comment events, otherwise the report itself. */
export function eventText(p: WebhookPayload): string {
  const comment = p.event.startsWith("comment.") ? p.data.comment : undefined;
  return comment ? comment.body : p.data.feedback.body;
}

function headline(p: WebhookPayload): string {
  const f = p.data.feedback;
  const what = f.title?.trim() || truncate(f.body.replace(/\s+/g, " "), 80);
  return `${eventTitle(p)}: ${f.projectName} #${f.number} ${what}`;
}

const httpLink = (url: string) => (/^https?:\/\//.test(url) ? url : null);

export function slackBody(p: WebhookPayload): object {
  const f = p.data.feedback;
  const text = eventText(p);
  const link = httpLink(f.url);
  const title = `*${slackEscape(eventTitle(p))}* · ${
    link
      ? `<${link}|${slackEscape(`${f.projectName} #${f.number}`)}>`
      : slackEscape(`${f.projectName} #${f.number}`)
  }`;
  const context = [
    `${kindLabel(f.kind)} · ${f.status} · ${f.priority}`,
    f.reporterName ? `from ${f.reporterName}` : null,
    viaReviewLink(f),
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
  const text = eventText(p);
  const link = httpLink(f.url) ?? undefined;
  const fields = [
    { name: "Kind", value: discordEscape(kindLabel(f.kind)), inline: true },
    { name: "Status", value: discordEscape(f.status), inline: true },
    { name: "Priority", value: discordEscape(f.priority), inline: true },
    ...(f.reporterName
      ? [{ name: "Reporter", value: truncate(discordEscape(f.reporterName), 1000), inline: true }]
      : []),
    ...(f.reviewLink
      ? [{ name: "Review link", value: truncate(discordEscape(f.reviewLink), 200), inline: true }]
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
        color: 0xd63a1c,
        fields,
        timestamp: p.createdAt,
      },
    ],
  };
}

// --- Microsoft Teams ------------------------------------------------------------------------------------
// A Workflows "When a Teams webhook request is received" flow posts the Adaptive Card it is sent. TextBlocks
// render a Markdown subset and expand `{{DATE(…)}}` functions, so untrusted text has its formatting, link
// and template characters broken with a zero-width space. Mentions need explicit `msteams.entities`, which
// are never sent, so `@` is harmless.

export function teamsEscape(s: string): string {
  return s
    .replace(/([*_~`[\]()<>#|\\])/g, "$1​")
    .replaceAll("{{", "{​{")
    .replace(/^(\s*)([-+]|\d+\.)\s/gm, "$1$2​ ");
}

export function teamsBody(p: WebhookPayload): object {
  const f = p.data.feedback;
  const link = httpLink(f.url);
  const facts = [
    { title: "Kind", value: teamsEscape(kindLabel(f.kind)) },
    { title: "Status", value: teamsEscape(f.status) },
    { title: "Priority", value: teamsEscape(f.priority) },
    ...(f.reporterName ? [{ title: "Reporter", value: teamsEscape(truncate(f.reporterName, 200)) }] : []),
    ...(f.reviewLink ? [{ title: "Review link", value: teamsEscape(truncate(f.reviewLink, 200)) }] : []),
    ...(f.pageUrl ? [{ title: "Page", value: teamsEscape(truncate(f.pageUrl, 500)) }] : []),
  ];
  return {
    type: "message",
    // Shown in notifications and by clients that can't render cards.
    summary: truncate(headline(p), 250),
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          msteams: { width: "Full" },
          body: [
            {
              type: "TextBlock",
              text: teamsEscape(eventTitle(p)),
              weight: "Bolder",
              size: "Medium",
              wrap: true,
            },
            {
              type: "TextBlock",
              text: teamsEscape(
                truncate(`${f.projectName} #${f.number}${f.title ? ` — ${f.title}` : ""}`, 300),
              ),
              isSubtle: true,
              spacing: "None",
              wrap: true,
            },
            { type: "TextBlock", text: teamsEscape(truncate(eventText(p) || " ", 3000)), wrap: true },
            { type: "FactSet", facts },
          ],
          ...(link ? { actions: [{ type: "Action.OpenUrl", title: `Open #${f.number}`, url: link }] } : {}),
        },
      },
    ],
  };
}

// --- Telegram -------------------------------------------------------------------------------------------
// HTML parse mode: untrusted text is entity-escaped, so only our own <b>/<a> tags are markup. In groups a
// plain `@username` notifies that user, so `@` is broken with a zero-width space like Discord's.

export function telegramEscape(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("@", "@​");
}

const attr = (s: string) => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

export function telegramBody(p: WebhookPayload, chatId: string): object {
  const f = p.data.feedback;
  const link = httpLink(f.url);
  const ref = telegramEscape(`${f.projectName} #${f.number}`);
  const meta = [
    `${kindLabel(f.kind)} · ${f.status} · ${f.priority}`,
    f.reporterName ? `from ${f.reporterName}` : null,
    viaReviewLink(f),
    f.pageUrl,
  ]
    .filter(Boolean)
    .join(" · ");
  const lines = [
    `<b>${telegramEscape(eventTitle(p))}</b> · ${link ? `<a href="${attr(link)}">${ref}</a>` : ref}`,
    ...(f.title ? [`<b>${telegramEscape(truncate(f.title, 300))}</b>`] : []),
    "",
    telegramEscape(truncate(eventText(p) || " ", 3000)),
    "",
    telegramEscape(truncate(meta, 600)),
  ];
  return {
    chat_id: chatId,
    // Escaping only grows the text, so the cut is made before escaping (above); 4096 is Telegram's limit.
    text: lines.join("\n").slice(0, 4096),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  };
}

// --- ntfy -----------------------------------------------------------------------------------------------
// JSON publishing (POST to the server root with `topic` in the body) so titles may hold any character.
// The message is plain text (`markdown: false`), so nothing in it is interpreted.

const NTFY_PRIORITY: Record<string, number> = { urgent: 5, high: 4, medium: 3, low: 2, none: 3 };

/** `https://ntfy.sh/alerts` → server root `https://ntfy.sh/` and topic `alerts` (sub-path installs too). */
export function ntfyTarget(topicUrl: string): { url: string; topic: string } | null {
  try {
    const u = new URL(topicUrl);
    const parts = u.pathname.split("/");
    const topic = decodeURIComponent(parts.pop() ?? "");
    if (!/^[-_A-Za-z0-9]{1,64}$/.test(topic)) return null;
    return { url: `${u.origin}${parts.join("/")}/`, topic };
  } catch {
    return null;
  }
}

export function ntfyBody(p: WebhookPayload, topic: string): object {
  const f = p.data.feedback;
  const link = httpLink(f.url);
  const meta = [
    `${kindLabel(f.kind)} · ${f.status} · ${f.priority}`,
    f.reporterName ? `from ${f.reporterName}` : null,
    viaReviewLink(f),
    f.pageUrl,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    topic,
    title: truncate(`${eventTitle(p)} · ${f.projectName} #${f.number}`, 250),
    message: truncate(`${f.title ? `${f.title}\n\n` : ""}${eventText(p) || " "}\n\n${meta}`, 3800),
    priority: NTFY_PRIORITY[f.priority] ?? 3,
    tags: [f.kind === "bug" ? "bug" : "speech_balloon"],
    markdown: false,
    ...(link ? { click: link } : {}),
  };
}

/** `tk_…` access tokens go as Bearer; `user:password` as Basic. */
export function ntfyAuthorization(token: string): string {
  return token.includes(":") && !token.startsWith("tk_")
    ? `Basic ${Buffer.from(token).toString("base64")}`
    : `Bearer ${token}`;
}

/** `url` is set when the request goes somewhere other than the stored target (Telegram, ntfy). */
export type OutboundRequest = { body: string; headers: Record<string, string>; url?: string };

/**
 * Build the HTTP request for one attempt. Generic bodies are signed; chat bodies carry no secret. `secret` is
 * the signing secret (generic) or the access token (ntfy); `target` is the stored URL, which Telegram and
 * ntfy split into the request URL and body fields.
 */
export function buildRequest(
  kind: WebhookKind,
  payload: WebhookPayload,
  secret: string | null,
  now = Math.floor(Date.now() / 1000),
  target?: string,
): OutboundRequest {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "Pinwren-Webhooks/1",
  };
  if (kind === "slack") return { body: JSON.stringify(slackBody(payload)), headers };
  if (kind === "discord") return { body: JSON.stringify(discordBody(payload)), headers };
  if (kind === "teams") return { body: JSON.stringify(teamsBody(payload)), headers };
  if (kind === "telegram") {
    const t = target ? parseTelegramTarget(target) : null;
    if (!t) throw new Error("not a Telegram target");
    return { body: JSON.stringify(telegramBody(payload, t.chatId)), headers, url: t.url };
  }
  if (kind === "ntfy") {
    const t = target ? ntfyTarget(target) : null;
    if (!t) throw new Error("not an ntfy topic URL");
    if (secret) headers.authorization = ntfyAuthorization(secret);
    return { body: JSON.stringify(ntfyBody(payload, t.topic)), headers, url: t.url };
  }
  const body = JSON.stringify(payload);
  headers["pinwren-event"] = payload.event;
  headers["pinwren-delivery"] = payload.id;
  headers["pinwren-timestamp"] = String(now);
  if (secret) headers["pinwren-signature"] = signBody(secret, now, body);
  return { body, headers };
}
