import type { EmailTemplateKey } from "@pinwren/core";
import { emailTemplate, getDb } from "@pinwren/db";
import { and, eq } from "drizzle-orm";
import { emailBrand } from "../services/branding";
import type { EmailMessage } from "./send";
import { type Rendered, type RenderOptions, renderTemplate, TEMPLATES } from "./templates";
import { unsubscribeHeaders, unsubscribeUrl } from "./unsubscribe";

/** The organisation's override of a template, or null for the default. */
export async function templateOverride(
  orgId: string,
  key: EmailTemplateKey,
): Promise<{ subject: string; body: string; updatedAt: Date } | null> {
  const [row] = await getDb()
    .select({ subject: emailTemplate.subject, body: emailTemplate.body, updatedAt: emailTemplate.updatedAt })
    .from(emailTemplate)
    .where(and(eq(emailTemplate.orgId, orgId), eq(emailTemplate.key, key)));
  return row ?? null;
}

/**
 * A rendered email plus what the delivery log records about it. Spread into the `notify.email` job
 * (`{ to, ...rendered }`), so every queued email says which template and workspace it came from.
 */
export type RenderedEmail = Rendered & { templateKey: EmailTemplateKey; orgId: string | null };

/**
 * Render a template for an organisation: its override (if any) and its branding. A broken lookup
 * falls back to the built-in wording — an email is never lost to a settings problem.
 */
export async function renderEmail(
  orgId: string | null,
  key: EmailTemplateKey,
  vars: Record<string, string>,
  options: RenderOptions = {},
): Promise<RenderedEmail> {
  let source: { subject: string; body: string } = TEMPLATES[key];
  if (orgId) {
    try {
      source = (await templateOverride(orgId, key)) ?? source;
    } catch (err) {
      console.warn("[pinwren] email template lookup failed; using the default", err);
    }
  }
  return {
    ...renderTemplate(key, source, vars, await emailBrand(orgId), options),
    templateKey: key,
    orgId,
  };
}

/**
 * An email to a reporter (not a team member): rendered with an unsubscribe link, sent with
 * List-Unsubscribe headers, and skipped by the sender if the address has unsubscribed.
 */
export async function reporterEmail(
  orgId: string,
  to: string,
  key: EmailTemplateKey,
  vars: Record<string, string>,
): Promise<EmailMessage> {
  const url = unsubscribeUrl(orgId, to);
  return {
    to,
    ...(await renderEmail(orgId, key, vars, { unsubscribeUrl: url })),
    headers: unsubscribeHeaders(url),
    suppressionOrgId: orgId,
  };
}
