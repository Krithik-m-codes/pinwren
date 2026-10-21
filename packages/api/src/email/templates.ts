// Email templates: small functions returning { subject, html, text }. Everything that came from a
// user (feedback text, names, URLs, project names) goes through `esc` / `safeUrl` — feedback is
// written by anonymous visitors.

export type Rendered = { subject: string; html: string; text: string };

export function esc(s: unknown): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Only http(s) links survive; anything else (javascript:, data:) renders as plain text. */
export function safeUrl(u: unknown): string | null {
  if (typeof u !== "string") return null;
  try {
    const url = new URL(u);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Subjects are headers: no line breaks, bounded length. */
function subject(s: string): string {
  const one = s.replace(/[\r\n\t]+/g, " ").trim();
  return one.length > 150 ? `${one.slice(0, 149)}…` : one;
}

const excerpt = (s: string | null | undefined, n = 600) => {
  const t = (s ?? "").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

function layout(opts: {
  heading: string;
  paragraphs: string[];
  quote?: string;
  cta?: { label: string; url: string };
}) {
  const cta = opts.cta ? safeUrl(opts.cta.url) : null;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1c1c24">
<table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:24px">
<tr><td>
<h1 style="font-size:18px;margin:0 0 16px">${esc(opts.heading)}</h1>
${opts.paragraphs.map((p) => `<p style="font-size:14px;line-height:1.5;margin:0 0 12px">${p}</p>`).join("\n")}
${opts.quote ? `<blockquote style="margin:0 0 16px;padding:8px 12px;border-left:3px solid #5b5bd6;background:#f6f6f9;font-size:14px;white-space:pre-wrap">${esc(opts.quote)}</blockquote>` : ""}
${cta && opts.cta ? `<p style="margin:16px 0 0"><a href="${esc(cta)}" style="display:inline-block;background:#5b5bd6;color:#fff;text-decoration:none;padding:8px 14px;border-radius:6px;font-size:14px">${esc(opts.cta.label)}</a></p>` : ""}
</td></tr></table>
<p style="text-align:center;font-size:12px;color:#8b8b99;margin-top:16px">Sent by Annota</p>
</body></html>`;
  return html;
}

const strip = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");

function text(lines: (string | null | undefined | false)[]) {
  return lines.filter((l) => l !== null && l !== undefined && l !== false).join("\n");
}

export type FeedbackSummary = {
  projectName: string;
  number: number;
  kind: string;
  title: string | null;
  body: string;
  pageUrl: string | null;
  reporterName: string | null;
  link: string;
};

const label = (f: Pick<FeedbackSummary, "number" | "title" | "body">) =>
  `#${f.number} ${f.title?.trim() || excerpt(f.body, 60)}`;

export function invitationEmail(d: {
  orgName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
  expiresAt: Date;
}): Rendered {
  const p = [
    `${esc(d.inviterName)} invited you to join <strong>${esc(d.orgName)}</strong> on Annota as ${esc(d.role)}.`,
    `The invitation expires on ${esc(d.expiresAt.toUTCString())}.`,
  ];
  return {
    subject: subject(`${d.inviterName} invited you to ${d.orgName} on Annota`),
    html: layout({
      heading: "You're invited",
      paragraphs: p,
      cta: { label: "Accept invitation", url: d.acceptUrl },
    }),
    text: text([strip(p.join("\n")), "", `Accept: ${d.acceptUrl}`]),
  };
}

export function newFeedbackEmail(f: FeedbackSummary): Rendered {
  const page = safeUrl(f.pageUrl);
  const p = [
    `New ${esc(f.kind)} in <strong>${esc(f.projectName)}</strong>${f.reporterName ? ` from ${esc(f.reporterName)}` : ""}.`,
    page ? `Page: ${esc(page)}` : "",
  ].filter(Boolean);
  return {
    subject: subject(`[${f.projectName}] ${label(f)}`),
    html: layout({
      heading: label(f),
      paragraphs: p,
      quote: excerpt(f.body),
      cta: { label: "Open in Annota", url: f.link },
    }),
    text: text([strip(p.join("\n")), "", excerpt(f.body), "", f.link]),
  };
}

export function assignedEmail(f: FeedbackSummary & { assignerName: string | null }): Rendered {
  const p = [
    `${f.assignerName ? esc(f.assignerName) : "Someone"} assigned you <strong>${esc(label(f))}</strong> in ${esc(f.projectName)}.`,
  ];
  return {
    subject: subject(`[${f.projectName}] Assigned to you: ${label(f)}`),
    html: layout({
      heading: "Assigned to you",
      paragraphs: p,
      quote: excerpt(f.body),
      cta: { label: "Open in Annota", url: f.link },
    }),
    text: text([strip(p.join("\n")), "", excerpt(f.body), "", f.link]),
  };
}

export function publicReplyEmail(
  f: FeedbackSummary & { authorName: string | null; reply: string },
): Rendered {
  const p = [
    `${f.authorName ? esc(f.authorName) : "A visitor"} replied on <strong>${esc(label(f))}</strong> in ${esc(f.projectName)}.`,
  ];
  return {
    subject: subject(`[${f.projectName}] New reply: ${label(f)}`),
    html: layout({
      heading: "New reply",
      paragraphs: p,
      quote: excerpt(f.reply),
      cta: { label: "Open in Annota", url: f.link },
    }),
    text: text([strip(p.join("\n")), "", excerpt(f.reply), "", f.link]),
  };
}

const STATUS_LABELS: Record<string, string> = {
  open: "open",
  in_progress: "in progress",
  in_review: "in review",
  resolved: "resolved",
  wont_fix: "won't fix",
  duplicate: "a duplicate",
};

/** To the reporter: a team reply or a status change on what they sent. No dashboard link. */
export function reporterUpdateEmail(
  f: Omit<FeedbackSummary, "link"> &
    ({ type: "reply"; reply: string; authorName: string | null } | { type: "status"; status: string }),
): Rendered {
  const page = safeUrl(f.pageUrl);
  const what = f.title?.trim() || excerpt(f.body, 80);
  if (f.type === "reply") {
    const p = [
      `${f.authorName ? esc(f.authorName) : "The team"} from ${esc(f.projectName)} replied to your feedback “${esc(what)}”.`,
    ];
    return {
      subject: subject(`Re: your feedback on ${f.projectName}`),
      html: layout({
        heading: "New reply to your feedback",
        paragraphs: p,
        quote: excerpt(f.reply),
        ...(page ? { cta: { label: "View the page", url: page } } : {}),
      }),
      text: text([strip(p.join("\n")), "", excerpt(f.reply), page ? `\n${page}` : null]),
    };
  }
  const p = [
    `Your feedback “${esc(what)}” on ${esc(f.projectName)} is now <strong>${esc(STATUS_LABELS[f.status] ?? f.status)}</strong>.`,
  ];
  return {
    subject: subject(`Your feedback on ${f.projectName} is ${STATUS_LABELS[f.status] ?? f.status}`),
    html: layout({
      heading: "Status update",
      paragraphs: p,
      ...(page ? { cta: { label: "View the page", url: page } } : {}),
    }),
    text: text([strip(p.join("\n")), page ? `\n${page}` : null]),
  };
}

export function statusChangedEmail(
  f: FeedbackSummary & { status: string; actorName: string | null },
): Rendered {
  const p = [
    `${f.actorName ? esc(f.actorName) : "Someone"} marked <strong>${esc(label(f))}</strong> as ${esc(STATUS_LABELS[f.status] ?? f.status)}.`,
  ];
  return {
    subject: subject(`[${f.projectName}] ${label(f)} is ${STATUS_LABELS[f.status] ?? f.status}`),
    html: layout({ heading: "Status changed", paragraphs: p, cta: { label: "Open in Annota", url: f.link } }),
    text: text([strip(p.join("\n")), "", f.link]),
  };
}

/** Daily digest — template only; scheduling it is a later work package. */
export function digestEmail(d: {
  userName: string;
  items: FeedbackSummary[];
  dashboardUrl: string;
}): Rendered {
  const p = [
    `Hi ${esc(d.userName)}, here is what came in:`,
    ...d.items.slice(0, 20).map((f) => `• ${esc(f.projectName)} — ${esc(label(f))}`),
  ];
  return {
    subject: subject(`Annota digest: ${d.items.length} new item${d.items.length === 1 ? "" : "s"}`),
    html: layout({
      heading: "Your Annota digest",
      paragraphs: p,
      cta: { label: "Open the inbox", url: d.dashboardUrl },
    }),
    text: text([strip(p.join("\n")), "", d.dashboardUrl]),
  };
}

export function testEmail(): Rendered {
  const p = ["This is a test message from your Annota instance. Email delivery works."];
  return {
    subject: "Annota test email",
    html: layout({ heading: "It works", paragraphs: p }),
    text: p.join("\n"),
  };
}
