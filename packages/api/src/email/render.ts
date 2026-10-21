import type { EmailTemplateKey } from "@pinwren/core";
import { emailTemplate, getDb } from "@pinwren/db";
import { and, eq } from "drizzle-orm";
import { emailBrand } from "../services/branding";
import { type Rendered, renderTemplate, TEMPLATES } from "./templates";

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
 * Render a template for an organisation: its override (if any) and its branding. A broken lookup
 * falls back to the built-in wording — an email is never lost to a settings problem.
 */
export async function renderEmail(
  orgId: string | null,
  key: EmailTemplateKey,
  vars: Record<string, string>,
): Promise<Rendered> {
  let source: { subject: string; body: string } = TEMPLATES[key];
  if (orgId) {
    try {
      source = (await templateOverride(orgId, key)) ?? source;
    } catch (err) {
      console.warn("[pinwren] email template lookup failed; using the default", err);
    }
  }
  return renderTemplate(key, source, vars, await emailBrand(orgId));
}
