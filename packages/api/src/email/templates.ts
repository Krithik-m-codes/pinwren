import type { EmailTemplateKey } from "@pinwren/core";
import { esc, renderMarkdown, renderSubject, safeHref, VARIABLE, variablesIn } from "./markdown";

// Email templates (F-020): each one is a subject + Markdown body with `{{variable}}` placeholders.
// Organisations can override both per template; the defaults below apply otherwise. Every value
// that reaches a template came from users (feedback text, names, URLs) and is escaped by
// `renderMarkdown` — the template author can format, the variables never can.

export { esc } from "./markdown";

export type Rendered = { subject: string; html: string; text: string };

/**
 * Organisation branding applied to every email (F-094). `poweredBy`: add "Powered by Pinwren" to the
 * footer — dropped only with the Enterprise `white_label` entitlement (wave-4 contract §6).
 */
export type EmailBrand = { productName: string; accent: string; logoUrl: string | null; poweredBy?: boolean };
export const DEFAULT_BRAND: EmailBrand = { productName: "Pinwren", accent: "#5b5bd6", logoUrl: null };

export type TemplateVariable = { name: string; description: string; sample: string };

export type TemplateDefinition = {
  key: EmailTemplateKey;
  name: string;
  description: string;
  variables: TemplateVariable[];
  subject: string;
  body: string;
  /** The button under the body: a fixed label and the variable holding its URL. */
  cta: { label: string; urlVariable: string } | null;
};

const v = (name: string, description: string, sample: string): TemplateVariable => ({
  name,
  description,
  sample,
});

/** Available in every template. */
const COMMON = [v("productName", "Your product name from Settings › Branding", "Pinwren")];

const FEEDBACK = [
  v("projectName", "Project name", "Marketing site"),
  v("number", "Feedback number", "42"),
  v("kind", "comment, bug, idea or question", "bug"),
  v("title", "Title, or the start of the text", "Checkout button does nothing"),
  v("body", "The feedback text (shortened)", "Clicked Pay now twice, nothing happened."),
  v("pageUrl", "Page the feedback was left on", "https://example.com/checkout"),
  v("reporterName", "Who sent it (or “a visitor”)", "Dana Reviewer"),
  v("link", "Link to the item in the dashboard", "https://feedback.example.com/inbox?item=42"),
];

export const TEMPLATES: Record<EmailTemplateKey, TemplateDefinition> = {
  invitation: {
    key: "invitation",
    name: "Invitation",
    description: "Sent when someone is invited to the workspace.",
    variables: [
      v("inviterName", "Who sent the invitation", "Avery Admin"),
      v("orgName", "Workspace name", "Acme Studio"),
      v("role", "Role they'll have", "member"),
      v("acceptUrl", "Link to accept", "https://feedback.example.com/accept-invitation/abc"),
      v("expiresAt", "When the invitation expires", "Tue, 28 Oct 2026 12:00:00 GMT"),
    ],
    subject: "{{inviterName}} invited you to {{orgName}} on {{productName}}",
    body: "# You're invited\n\n{{inviterName}} invited you to join **{{orgName}}** on {{productName}} as {{role}}.\n\nThe invitation expires on {{expiresAt}}.",
    cta: { label: "Accept invitation", urlVariable: "acceptUrl" },
  },
  feedback_created: {
    key: "feedback_created",
    name: "New feedback",
    description: "To team members who follow new feedback on a project.",
    variables: FEEDBACK,
    subject: "[{{projectName}}] #{{number}} {{title}}",
    body: "# #{{number}} {{title}}\n\nNew {{kind}} in **{{projectName}}** from {{reporterName}}.\n\nPage: {{pageUrl}}\n\n> {{body}}",
    cta: { label: "Open in {{productName}}", urlVariable: "link" },
  },
  feedback_assigned: {
    key: "feedback_assigned",
    name: "Assigned to you",
    description: "To the person an item was assigned to.",
    variables: [...FEEDBACK, v("assignerName", "Who assigned it", "Avery Admin")],
    subject: "[{{projectName}}] Assigned to you: #{{number}} {{title}}",
    body: "# Assigned to you\n\n{{assignerName}} assigned you **#{{number}} {{title}}** in {{projectName}}.\n\n> {{body}}",
    cta: { label: "Open in {{productName}}", urlVariable: "link" },
  },
  comment_created: {
    key: "comment_created",
    name: "New reply",
    description: "To the team involved in an item when someone replies.",
    variables: [
      ...FEEDBACK,
      v("authorName", "Who replied (or “A visitor”)", "Dana Reviewer"),
      v("reply", "The reply (shortened)", "Still broken on Safari."),
    ],
    subject: "[{{projectName}}] New reply: #{{number}} {{title}}",
    body: "# New reply\n\n{{authorName}} replied on **#{{number}} {{title}}** in {{projectName}}.\n\n> {{reply}}",
    cta: { label: "Open in {{productName}}", urlVariable: "link" },
  },
  status_changed: {
    key: "status_changed",
    name: "Status changed",
    description: "To assignees when an item's status changes.",
    variables: [
      ...FEEDBACK,
      v("status", "The new status", "resolved"),
      v("actorName", "Who changed it", "Avery Admin"),
    ],
    subject: "[{{projectName}}] #{{number}} {{title}} is {{status}}",
    body: "# Status changed\n\n{{actorName}} marked **#{{number}} {{title}}** as {{status}}.",
    cta: { label: "Open in {{productName}}", urlVariable: "link" },
  },
  reporter_reply: {
    key: "reporter_reply",
    name: "Reply to the reporter",
    description: "To the reporter when the team replies publicly (project setting “Email the reporter”).",
    variables: [
      v("projectName", "Project name", "Marketing site"),
      v("title", "Their feedback, shortened", "Checkout button does nothing"),
      v("authorName", "Who replied (or “The team”)", "Avery Admin"),
      v("reply", "The reply (shortened)", "Fixed in today's release — thanks!"),
      v("pageUrl", "Page the feedback was left on", "https://example.com/checkout"),
    ],
    subject: "Re: your feedback on {{projectName}}",
    body: "# New reply to your feedback\n\n{{authorName}} from {{projectName}} replied to your feedback “{{title}}”.\n\n> {{reply}}",
    cta: { label: "View the page", urlVariable: "pageUrl" },
  },
  reporter_status: {
    key: "reporter_status",
    name: "Status update to the reporter",
    description: "To the reporter when the team changes the status of what they sent.",
    variables: [
      v("projectName", "Project name", "Marketing site"),
      v("title", "Their feedback, shortened", "Checkout button does nothing"),
      v("status", "The new status", "resolved"),
      v("pageUrl", "Page the feedback was left on", "https://example.com/checkout"),
    ],
    subject: "Your feedback on {{projectName}} is {{status}}",
    body: "# Status update\n\nYour feedback “{{title}}” on {{projectName}} is now **{{status}}**.",
    cta: { label: "View the page", urlVariable: "pageUrl" },
  },
};

/** Variables a template may use (its own plus the common ones). */
export const allowedVariables = (key: EmailTemplateKey) => [...COMMON, ...TEMPLATES[key].variables];

/** Placeholders in subject/body that the template doesn't offer. */
export function unknownVariables(key: EmailTemplateKey, subject: string, body: string): string[] {
  const allowed = new Set(allowedVariables(key).map((x) => x.name));
  return variablesIn(`${subject}\n${body}`).filter((n) => !allowed.has(n));
}

export const sampleVariables = (key: EmailTemplateKey): Record<string, string> =>
  Object.fromEntries(allowedVariables(key).map((x) => [x.name, x.sample]));

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Black or white text, whichever reads better on the accent. */
export function contrastText(hex: string): string {
  const h = hex.length === 4 ? hex.replace(/^#(.)(.)(.)$/, "#$1$1$2$2$3$3") : hex;
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c = 0) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const l = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return l > 0.4 ? "#111118" : "#ffffff";
}

function layout(
  content: string,
  brand: EmailBrand,
  cta: { label: string; url: string } | null,
  unsubscribeUrl?: string,
): string {
  const accent = HEX.test(brand.accent) ? brand.accent : DEFAULT_BRAND.accent;
  const logo = brand.logoUrl ? safeHref(brand.logoUrl) : null;
  const button = cta
    ? `<p style="margin:16px 0 0"><a href="${esc(cta.url)}" style="display:inline-block;background:${accent};color:${contrastText(accent)};text-decoration:none;padding:8px 14px;border-radius:6px;font-size:14px">${esc(cta.label)}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1c1c24">
<table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:24px">
<tr><td>
${logo ? `<p style="margin:0 0 16px"><img src="${esc(logo)}" alt="${esc(brand.productName)}" height="28" style="height:28px;max-width:200px"></p>` : ""}
${content}
${button}
</td></tr></table>
<p style="text-align:center;font-size:12px;color:#8b8b99;margin-top:16px">Sent by ${esc(brand.productName)}${brand.poweredBy && brand.productName !== DEFAULT_BRAND.productName ? " · Powered by Pinwren" : ""}</p>${
    unsubscribeUrl && safeHref(unsubscribeUrl)
      ? `
<p style="text-align:center;font-size:12px;color:#8b8b99;margin:4px 0 0"><a href="${esc(unsubscribeUrl)}" style="color:#8b8b99">Unsubscribe</a> from these emails</p>`
      : ""
  }
</body></html>`;
}

/**
 * Render one template (default or override) with its variables. Pure: callers load the override and
 * branding (see `render.ts`).
 */
export function renderTemplate(
  key: EmailTemplateKey,
  source: { subject: string; body: string },
  vars: Record<string, string>,
  brand: EmailBrand = DEFAULT_BRAND,
  options: { unsubscribeUrl?: string | undefined } = {},
): Rendered {
  const def = TEMPLATES[key];
  const all: Record<string, string> = { ...vars, productName: brand.productName };
  const accent = HEX.test(brand.accent) ? brand.accent : DEFAULT_BRAND.accent;
  const md = renderMarkdown(source.body, all, { accent });
  const ctaUrl = def.cta ? safeHref(all[def.cta.urlVariable] ?? "") : null;
  const cta =
    def.cta && ctaUrl
      ? { label: def.cta.label.replace(VARIABLE, (_m, n: string) => all[n] ?? ""), url: ctaUrl }
      : null;
  return {
    subject: renderSubject(source.subject, all),
    html: layout(md.html, brand, cta, options.unsubscribeUrl),
    text: [
      md.text,
      cta ? `${cta.label}: ${cta.url}` : null,
      options.unsubscribeUrl ? `Unsubscribe: ${options.unsubscribeUrl}` : null,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

export const renderDefault = (key: EmailTemplateKey, vars: Record<string, string>, brand?: EmailBrand) =>
  renderTemplate(key, TEMPLATES[key], vars, brand);

/** Not editable: proves delivery works. */
export function testEmail(brand: EmailBrand = DEFAULT_BRAND): Rendered {
  const p = `This is a test message from your ${brand.productName} instance. Email delivery works.`;
  return {
    subject: `${brand.productName} test email`.replace(/[\r\n]+/g, " ").slice(0, 150),
    html: layout(
      `<h1 style="font-size:18px;margin:0 0 16px">It works</h1><p style="font-size:14px;line-height:1.5;margin:0 0 12px">${esc(p)}</p>`,
      brand,
      null,
    ),
    text: p,
  };
}

// --- Variables from domain data ---------------------------------------------------------------------

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

export const excerpt = (s: string | null | undefined, n = 600) => {
  const t = (s ?? "").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export const STATUS_LABELS: Record<string, string> = {
  open: "open",
  in_progress: "in progress",
  in_review: "in review",
  resolved: "resolved",
  wont_fix: "won't fix",
  duplicate: "a duplicate",
};
export const statusLabel = (s: string) => STATUS_LABELS[s] ?? s;

/** Template variables for a feedback item. Missing values get readable fallbacks. */
export function feedbackVars(f: FeedbackSummary): Record<string, string> {
  return {
    projectName: f.projectName,
    number: String(f.number),
    kind: f.kind,
    title: f.title?.trim() || excerpt(f.body, 60),
    body: excerpt(f.body),
    pageUrl: safeHref(f.pageUrl ?? "") ?? "",
    reporterName: f.reporterName || "a visitor",
    link: f.link,
  };
}
