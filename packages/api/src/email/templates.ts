import { EMAIL_TEMPLATE_KEYS, type EmailTemplateKey, kindNoun } from "@pinwren/core";
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
export const DEFAULT_BRAND: EmailBrand = { productName: "Pinwren", accent: "#d63a1c", logoUrl: null };

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
  /**
   * Show the item's facts under the body: screenshot thumbnail, priority, page, browser/OS, console errors,
   * failed requests and whether a session replay exists (the `FEEDBACK_DETAILS` variables). Outside the
   * editable body, so a customised template keeps them.
   */
  details?: true;
  /**
   * Account emails (password reset, verification, email change) are about a person, not a workspace: always
   * the built-in wording, so a workspace's template editor doesn't offer them.
   */
  account?: true;
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
  v("kind", "bug report, change request, question or feedback", "bug report"),
  v("title", "Title, or the start of the text", "Checkout button does nothing"),
  v("body", "The feedback text (shortened)", "Clicked Pay now twice, nothing happened."),
  v("pageUrl", "Page the feedback was left on", "https://example.com/checkout"),
  v("reporterName", "Who sent it (or “a visitor”)", "Dana Reviewer"),
  v("link", "Link to the item in the dashboard", "https://feedback.example.com/inbox?item=42"),
];

/** Facts about a report, shown in a table by templates with `details` and usable in any feedback template. */
const FEEDBACK_DETAILS = [
  v("priority", "Priority (urgent, high, medium, low or “not set”)", "high"),
  v("browser", "Browser and operating system", "Chrome 131 on macOS"),
  v("consoleErrors", "Console errors captured with the report", "2"),
  v("failedRequests", "Failed network requests captured with the report", "1"),
  v("replay", "“yes” when a session replay was recorded", "yes"),
  v("screenshotUrl", "Screenshot image (a signed link that works without signing in)", ""),
  v("reviewLink", "The review link it came through, if any", "Client round 2"),
];

/** Reporter emails: the page, opened on their own feedback (signed link; the page itself if none). */
const THREAD = v(
  "threadUrl",
  "The page, opened on their feedback",
  "https://example.com/checkout?pinwren=abc",
);

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
    description: "To the project's team recipients (Notifications › General) when a report arrives.",
    variables: [...FEEDBACK, ...FEEDBACK_DETAILS],
    subject: "[{{projectName}}] #{{number}} {{title}}",
    body: "# #{{number}} {{title}}\n\nNew {{kind}} in **{{projectName}}** from {{reporterName}}.\n\n> {{body}}",
    cta: { label: "Open in {{productName}}", urlVariable: "link" },
    details: true,
  },
  feedback_assigned: {
    key: "feedback_assigned",
    name: "Assigned to you",
    description: "To the person an item was assigned to.",
    variables: [...FEEDBACK, ...FEEDBACK_DETAILS, v("assignerName", "Who assigned it", "Avery Admin")],
    subject: "[{{projectName}}] Assigned to you: #{{number}} {{title}}",
    body: "# Assigned to you\n\n{{assignerName}} assigned you **#{{number}} {{title}}** in {{projectName}}.\n\n> {{body}}",
    cta: { label: "Open in {{productName}}", urlVariable: "link" },
    details: true,
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
    description: "To assignees and followers when an item's status changes.",
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
      THREAD,
    ],
    subject: "Re: your feedback on {{projectName}}",
    body: "# New reply to your feedback\n\n{{authorName}} from {{projectName}} replied to your feedback “{{title}}”.\n\n> {{reply}}",
    cta: { label: "View the conversation", urlVariable: "threadUrl" },
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
      THREAD,
    ],
    subject: "Your feedback on {{projectName}} is {{status}}",
    body: "# Status update\n\nYour feedback “{{title}}” on {{projectName}} is now **{{status}}**.",
    cta: { label: "View your feedback", urlVariable: "threadUrl" },
  },
  password_reset: {
    key: "password_reset",
    name: "Password reset",
    description: "To someone who asked to reset their password.",
    variables: [
      v("userName", "Their name", "Dana Reviewer"),
      v("resetUrl", "Link that sets a new password", "https://feedback.example.com/reset-password?token=abc"),
      v("expiresIn", "How long the link works", "1 hour"),
    ],
    subject: "Reset your {{productName}} password",
    body: "# Reset your password\n\nHi {{userName}}, someone (hopefully you) asked to reset your {{productName}} password.\n\nThe link works for {{expiresIn}}. If you didn't ask, ignore this email: your password stays the same.",
    cta: { label: "Choose a new password", urlVariable: "resetUrl" },
    account: true,
  },
  verify_email: {
    key: "verify_email",
    name: "Verify email address",
    description: "To a new account, to confirm its email address.",
    variables: [
      v("userName", "Their name", "Dana Reviewer"),
      v(
        "verifyUrl",
        "Link that confirms the address",
        "https://feedback.example.com/api/auth/verify-email?token=abc",
      ),
    ],
    subject: "Confirm your email for {{productName}}",
    body: "# Confirm your email\n\nHi {{userName}}, confirm this address so {{productName}} can send you notifications.",
    cta: { label: "Confirm email", urlVariable: "verifyUrl" },
    account: true,
  },
  change_email: {
    key: "change_email",
    name: "Change email address",
    description: "To the current address when someone changes their account email.",
    variables: [
      v("userName", "Their name", "Dana Reviewer"),
      v("newEmail", "The new address", "dana@new.example.com"),
      v(
        "confirmUrl",
        "Link that approves the change",
        "https://feedback.example.com/api/auth/verify-email?token=abc",
      ),
    ],
    subject: "Confirm your new email for {{productName}}",
    body: "# Change your email\n\nHi {{userName}}, you asked to change your {{productName}} email to {{newEmail}}.\n\nIf you didn't, ignore this email: nothing changes.",
    cta: { label: "Approve the change", urlVariable: "confirmUrl" },
    account: true,
  },
  magic_link: {
    key: "magic_link",
    name: "Sign-in link",
    description: "To someone who asked for a sign-in link instead of typing a password.",
    variables: [
      v("userName", "Their name, or their address for a new account", "Dana Reviewer"),
      v(
        "signInUrl",
        "Link that signs them in (works once)",
        "https://feedback.example.com/api/auth/magic-link/verify?token=abc",
      ),
      v("expiresIn", "How long the link works", "10 minutes"),
    ],
    subject: "Your {{productName}} sign-in link",
    body: "# Sign in to {{productName}}\n\nHi {{userName}}, use the button below to sign in. The link works once, for {{expiresIn}}.\n\nIf you didn't ask for it, ignore this email: nobody can sign in without it.",
    cta: { label: "Sign in", urlVariable: "signInUrl" },
    account: true,
  },
  mentioned: {
    key: "mentioned",
    name: "Mentioned",
    description: "To a team member @mentioned in a comment.",
    variables: [
      ...FEEDBACK,
      v("authorName", "Who mentioned them", "Avery Admin"),
      v("comment", "The comment (shortened)", "@Dana can you check this on Safari?"),
    ],
    subject: "[{{projectName}}] {{authorName}} mentioned you on #{{number}} {{title}}",
    body: "# You were mentioned\n\n{{authorName}} mentioned you on **#{{number}} {{title}}** in {{projectName}}.\n\n> {{comment}}",
    cta: { label: "Open in {{productName}}", urlVariable: "link" },
  },
  priority_changed: {
    key: "priority_changed",
    name: "Priority changed",
    description: "To assignees and followers when an item's priority changes.",
    variables: [
      ...FEEDBACK,
      v("priority", "The new priority", "urgent"),
      v("previousPriority", "The priority before", "low"),
      v("actorName", "Who changed it", "Avery Admin"),
    ],
    subject: "[{{projectName}}] #{{number}} {{title}} is now {{priority}} priority",
    body: "# Priority changed\n\n{{actorName}} changed the priority of **#{{number}} {{title}}** from {{previousPriority}} to **{{priority}}**.",
    cta: { label: "Open in {{productName}}", urlVariable: "link" },
  },
  feedback_deleted: {
    key: "feedback_deleted",
    name: "Feedback deleted",
    description: "To assignees and followers when an item is moved to the trash.",
    variables: [...FEEDBACK, v("actorName", "Who deleted it", "Avery Admin")],
    subject: "[{{projectName}}] #{{number}} {{title}} was deleted",
    body: "# Moved to the trash\n\n{{actorName}} deleted **#{{number}} {{title}}** in {{projectName}}. It can be restored from the trash for 30 days.",
    cta: { label: "Open in {{productName}}", urlVariable: "link" },
  },
  digest: {
    key: "digest",
    name: "Notification digest",
    description: "Hourly or daily summary for people who chose a digest instead of instant emails.",
    variables: [
      v("period", "hourly or daily", "daily"),
      v("count", "Unread notifications in this digest", "7"),
      v("summary", "One line per notification", "#42 Checkout button does nothing: new bug from Dana"),
      v("link", "Link to the inbox", "https://feedback.example.com/inbox"),
    ],
    subject: "Your {{period}} {{productName}} summary: {{count}} updates",
    body: "# Your {{period}} summary\n\nYou have {{count}} unread notifications.\n\n{{summary}}",
    cta: { label: "Open the inbox", urlVariable: "link" },
  },
  reporter_received: {
    key: "reporter_received",
    name: "Report received",
    description: "To the reporter right after they send feedback (project setting “Email the reporter”).",
    variables: [
      v("projectName", "Project name", "Marketing site"),
      v("title", "Their feedback, shortened", "Checkout button does nothing"),
      v("pageUrl", "Page the feedback was left on", "https://example.com/checkout"),
      THREAD,
    ],
    subject: "We received your feedback on {{projectName}}",
    body: "# Thanks, we got it\n\nYour feedback “{{title}}” on {{projectName}} reached the team. You'll get an email when they reply or change its status.",
    cta: { label: "View your feedback", urlVariable: "threadUrl" },
  },
  reporter_priority: {
    key: "reporter_priority",
    name: "Priority update to the reporter",
    description:
      "To the reporter when the team changes the priority of what they sent (Notifications › Reporter).",
    variables: [
      v("projectName", "Project name", "Marketing site"),
      v("title", "Their feedback, shortened", "Checkout button does nothing"),
      v("priority", "The new priority", "high"),
      v("pageUrl", "Page the feedback was left on", "https://example.com/checkout"),
      THREAD,
    ],
    subject: "Your feedback on {{projectName}} is now {{priority}} priority",
    body: "# Priority update\n\nThe team set the priority of your feedback “{{title}}” on {{projectName}} to **{{priority}}**.",
    cta: { label: "View your feedback", urlVariable: "threadUrl" },
  },
  reporter_assigned: {
    key: "reporter_assigned",
    name: "Assignment update to the reporter",
    description:
      "To the reporter when someone on the team takes on what they sent (Notifications › Reporter).",
    variables: [
      v("projectName", "Project name", "Marketing site"),
      v("title", "Their feedback, shortened", "Checkout button does nothing"),
      v("assigneeName", "Who is now on it", "Avery Admin"),
      v("pageUrl", "Page the feedback was left on", "https://example.com/checkout"),
      THREAD,
    ],
    subject: "Someone is looking at your feedback on {{projectName}}",
    body: "# Your feedback has an owner\n\n{{assigneeName}} from {{projectName}} is now working on your feedback “{{title}}”.",
    cta: { label: "View your feedback", urlVariable: "threadUrl" },
  },
  webhook_disabled: {
    key: "webhook_disabled",
    name: "Webhook disabled",
    description: "To workspace admins when a webhook is turned off after 3 days of failed deliveries.",
    variables: [
      v("webhookName", "The webhook's name (or its kind)", "Slack #bugs"),
      v("lastError", "The last delivery error", "HTTP 404"),
      v(
        "settingsUrl",
        "Link to Settings › Integrations",
        "https://feedback.example.com/settings/integrations",
      ),
    ],
    subject: "Webhook “{{webhookName}}” was disabled",
    body: "# Webhook disabled\n\nDeliveries to **{{webhookName}}** failed for 3 days ({{lastError}}), so {{productName}} stopped sending them. Fix the receiver, then turn the webhook back on.",
    cta: { label: "Review the webhook", urlVariable: "settingsUrl" },
  },
};

/** Templates a workspace may customise: every one except the account emails. */
export const ORG_TEMPLATE_KEYS: readonly EmailTemplateKey[] = EMAIL_TEMPLATE_KEYS.filter(
  (k) => !TEMPLATES[k].account,
);

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

/** Footer links: one-click unsubscribe (reporters; team: this project) and "Manage notifications" (team). */
export type RenderOptions = { unsubscribeUrl?: string | undefined; manageUrl?: string | undefined };

function layout(
  content: string,
  brand: EmailBrand,
  cta: { label: string; url: string } | null,
  options: RenderOptions = {},
  details = "",
): string {
  const { unsubscribeUrl, manageUrl } = options;
  const accent = HEX.test(brand.accent) ? brand.accent : DEFAULT_BRAND.accent;
  const logo = brand.logoUrl ? safeHref(brand.logoUrl) : null;
  const button = cta
    ? `<p style="margin:16px 0 0"><a href="${esc(cta.url)}" style="display:inline-block;background:${accent};color:${contrastText(accent)};text-decoration:none;padding:8px 14px;border-radius:6px;font-size:14px">${esc(cta.label)}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#17243a">
<table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:24px">
<tr><td>
${logo ? `<p style="margin:0 0 16px"><img src="${esc(logo)}" alt="${esc(brand.productName)}" height="28" style="height:28px;max-width:200px;border:0"></p>` : ""}
${content}
${details}${button}
</td></tr></table>
<p style="text-align:center;font-size:12px;color:#8b8b99;margin-top:16px">Sent by ${esc(brand.productName)}${brand.poweredBy && brand.productName !== DEFAULT_BRAND.productName ? " · Powered by Pinwren" : ""}</p>${
    unsubscribeUrl && safeHref(unsubscribeUrl)
      ? `
<p style="text-align:center;font-size:12px;color:#8b8b99;margin:4px 0 0"><a href="${esc(unsubscribeUrl)}" style="color:#8b8b99">Unsubscribe</a> from these emails</p>`
      : ""
  }${
    manageUrl && safeHref(manageUrl)
      ? `
<p style="text-align:center;font-size:12px;color:#8b8b99;margin:4px 0 0"><a href="${esc(manageUrl)}" style="color:#8b8b99">Manage notifications</a></p>`
      : ""
  }
</body></html>`;
}

/** Not a fact worth a row: empty, "0", "no", "not set". */
const shown = (v: string | undefined): v is string => !!v && !["0", "no", "not set", "none"].includes(v);

/**
 * The facts table (and screenshot) of a `details` template, from its variables. Values are escaped; the
 * image and page are only linked when they are http(s).
 */
export function renderDetails(all: Record<string, string>): { html: string; text: string } {
  const rows: [string, string, string | null][] = [];
  if (shown(all.priority)) rows.push(["Priority", all.priority, null]);
  if (all.reviewLink) rows.push(["Review link", all.reviewLink, null]);
  const page = all.pageUrl ? safeHref(all.pageUrl) : null;
  if (page) rows.push(["Page", page, page]);
  if (shown(all.browser)) rows.push(["Browser", all.browser, null]);
  if (shown(all.consoleErrors)) rows.push(["Console errors", all.consoleErrors, null]);
  if (shown(all.failedRequests)) rows.push(["Failed requests", all.failedRequests, null]);
  if (all.replay === "yes") rows.push(["Session replay", "Recorded", null]);
  const img = all.screenshotUrl ? safeHref(all.screenshotUrl) : null;
  const link = all.link ? safeHref(all.link) : null;
  const cell = "padding:4px 0;font-size:13px;line-height:1.4;vertical-align:top";
  const table = rows.length
    ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 12px">${rows
        .map(
          ([k, v, href]) =>
            `<tr><td style="${cell};color:#8b8b99;width:130px;padding-right:12px">${esc(k)}</td><td style="${cell};word-break:break-all">${
              href ? `<a href="${esc(href)}" style="color:#1c1c24">${esc(v)}</a>` : esc(v)
            }</td></tr>`,
        )
        .join("")}</table>`
    : "";
  const image = img
    ? `<p style="margin:0 0 12px">${link ? `<a href="${esc(link)}">` : ""}<img src="${esc(img)}" alt="Screenshot" width="512" style="display:block;width:100%;max-width:512px;height:auto;border:1px solid #e4e4ea;border-radius:6px">${link ? "</a>" : ""}</p>`
    : "";
  return {
    html: image + table,
    text: rows.map(([k, v]) => `${k}: ${v}`).join("\n"),
  };
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
  options: RenderOptions = {},
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
  const details = def.details ? renderDetails(all) : { html: "", text: "" };
  return {
    subject: renderSubject(source.subject, all),
    html: layout(md.html, brand, cta, options, details.html),
    text: [
      md.text,
      details.text || null,
      cta ? `${cta.label}: ${cta.url}` : null,
      options.manageUrl ? `Manage notifications: ${options.manageUrl}` : null,
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
  /** Facts for `details` templates (optional: older callers and tests leave them out). */
  priority?: string;
  browser?: string | null;
  os?: string | null;
  consoleErrors?: number;
  failedRequests?: number;
  hasReplay?: boolean;
  screenshotUrl?: string | null;
  /** The review link's label when the item came in through one. */
  reviewLink?: string | null;
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
    kind: kindNoun(f.kind),
    title: f.title?.trim() || excerpt(f.body, 60),
    body: excerpt(f.body),
    pageUrl: safeHref(f.pageUrl ?? "") ?? "",
    reporterName: f.reporterName || "a visitor",
    link: f.link,
    priority: !f.priority || f.priority === "none" ? "not set" : f.priority,
    browser: [f.browser, f.os].filter(Boolean).join(" on "),
    consoleErrors: String(f.consoleErrors ?? 0),
    failedRequests: String(f.failedRequests ?? 0),
    replay: f.hasReplay ? "yes" : "no",
    screenshotUrl: f.screenshotUrl ?? "",
    reviewLink: f.reviewLink?.trim() ?? "",
  };
}
