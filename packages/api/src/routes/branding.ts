import {
  brandAssetUpload,
  type EmailTemplateKey,
  emailTemplatePreview,
  emailTemplateTest,
  emailTemplateUpdate,
  orgBrandingUpdate,
} from "@pinwren/core";
import { emailTemplate, getDb, user } from "@pinwren/db";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { requireOrgAdmin, type SessionVars } from "../context";
import { templateOverride } from "../email/render";
import { sendEmail } from "../email/send";
import {
  allowedVariables,
  ORG_TEMPLATE_KEYS,
  renderTemplate,
  sampleVariables,
  TEMPLATES,
  unknownVariables,
} from "../email/templates";
import { ApiError, notFound } from "../errors";
import { consume } from "../rate-limit";
import { emailBrand, getOrgBranding, saveBrandAsset, updateOrgBranding } from "../services/branding";

/** Template test sends per user (and three times that per organisation) and hour. */
const TEST_SENDS_PER_HOUR = 10;

const templateKey = (k: string): EmailTemplateKey => {
  if (!(ORG_TEMPLATE_KEYS as readonly string[]).includes(k)) throw notFound("Template");
  return k as EmailTemplateKey;
};

function assertVariables(key: EmailTemplateKey, subject: string, body: string) {
  const unknown = unknownVariables(key, subject, body);
  if (unknown.length) {
    throw new ApiError(
      400,
      "UNKNOWN_VARIABLE",
      `Not available in this template: ${unknown.map((n) => `{{${n}}}`).join(", ")}`,
    );
  }
}

async function templateOut(orgId: string, key: EmailTemplateKey) {
  const def = TEMPLATES[key];
  const override = await templateOverride(orgId, key);
  return {
    key,
    name: def.name,
    description: def.description,
    variables: allowedVariables(key),
    defaultSubject: def.subject,
    defaultBody: def.body,
    subject: override?.subject ?? def.subject,
    body: override?.body ?? def.body,
    customized: !!override,
    updatedAt: override?.updatedAt ?? null,
  };
}

/** Render a draft (or the saved template) with sample values, optionally overridden. */
async function preview(
  orgId: string,
  key: EmailTemplateKey,
  draft: {
    subject?: string | undefined;
    body?: string | undefined;
    variables?: Record<string, string> | undefined;
  },
) {
  const current = await templateOut(orgId, key);
  const source = { subject: draft.subject ?? current.subject, body: draft.body ?? current.body };
  assertVariables(key, source.subject, source.body);
  const vars = { ...sampleVariables(key), ...(draft.variables ?? {}) };
  return renderTemplate(key, source, vars, await emailBrand(orgId));
}

/**
 * Organisation branding (F-094) and editable email templates (F-020). Every member can read the
 * branding (the dashboard applies it); changing it and the templates is for org admins.
 */
export const branding = new Hono<{ Variables: SessionVars }>()
  .get("/branding", async (c) => c.json({ branding: await getOrgBranding(c.var.orgId) }))

  .patch("/branding", requireOrgAdmin, zValidator("json", orgBrandingUpdate), async (c) =>
    c.json({ branding: await updateOrgBranding(c.var.orgId, c.req.valid("json"), c.var.userId) }),
  )

  /** Upload a logo; returns `{ asset: { id, url } }` to set as `logoAssetId` or a widget `logoUrl`. */
  .post("/branding/assets", requireOrgAdmin, zValidator("json", brandAssetUpload), async (c) =>
    c.json({ asset: await saveBrandAsset(c.var.orgId, c.req.valid("json").dataUrl, c.var.userId) }, 201),
  )

  .get("/email-templates", requireOrgAdmin, async (c) =>
    c.json({ templates: await Promise.all(ORG_TEMPLATE_KEYS.map((k) => templateOut(c.var.orgId, k))) }),
  )

  .get("/email-templates/:key", requireOrgAdmin, async (c) =>
    c.json({ template: await templateOut(c.var.orgId, templateKey(c.req.param("key"))) }),
  )

  .put("/email-templates/:key", requireOrgAdmin, zValidator("json", emailTemplateUpdate), async (c) => {
    const key = templateKey(c.req.param("key"));
    const { subject, body } = c.req.valid("json");
    assertVariables(key, subject, body);
    await getDb()
      .insert(emailTemplate)
      .values({ orgId: c.var.orgId, key, subject, body, updatedBy: c.var.userId })
      .onConflictDoUpdate({
        target: [emailTemplate.orgId, emailTemplate.key],
        set: { subject, body, updatedBy: c.var.userId, updatedAt: new Date() },
      });
    return c.json({ template: await templateOut(c.var.orgId, key) });
  })

  /** Reset to the built-in wording. */
  .delete("/email-templates/:key", requireOrgAdmin, async (c) => {
    const key = templateKey(c.req.param("key"));
    await getDb()
      .delete(emailTemplate)
      .where(and(eq(emailTemplate.orgId, c.var.orgId), eq(emailTemplate.key, key)));
    return c.json({ template: await templateOut(c.var.orgId, key) });
  })

  .post(
    "/email-templates/:key/preview",
    requireOrgAdmin,
    zValidator("json", emailTemplatePreview),
    async (c) =>
      c.json({ preview: await preview(c.var.orgId, templateKey(c.req.param("key")), c.req.valid("json")) }),
  )

  /**
   * Send the rendered draft with sample values to the caller's own address — never anyone else's, or
   * the instance's mail server would relay arbitrary content (ADR 0021). Unconfigured SMTP →
   * `{ sent: false, skipped }`.
   */
  .post("/email-templates/:key/test", requireOrgAdmin, zValidator("json", emailTemplateTest), async (c) => {
    const { to: given, ...draft } = c.req.valid("json");
    const [u] = await getDb().select({ email: user.email }).from(user).where(eq(user.id, c.var.userId));
    const to = u?.email;
    if (!to) throw new ApiError(400, "NO_RECIPIENT", "No recipient address");
    if (given && given.trim().toLowerCase() !== to.toLowerCase()) {
      throw new ApiError(400, "RECIPIENT_NOT_ALLOWED", "Test emails go to your own address only");
    }
    if (
      !(await consume(`mailtest:u:${c.var.userId}`, TEST_SENDS_PER_HOUR, 3600)) ||
      !(await consume(`mailtest:o:${c.var.orgId}`, TEST_SENDS_PER_HOUR * 3, 3600))
    ) {
      throw new ApiError(429, "RATE_LIMITED", "Too many test emails — try again later");
    }
    const rendered = await preview(c.var.orgId, templateKey(c.req.param("key")), draft);
    try {
      const result = await sendEmail({ to, ...rendered, subject: `[Test] ${rendered.subject}` });
      return c.json(result.sent ? { sent: true, to } : { sent: false, skipped: true, reason: result.reason });
    } catch (err) {
      return c.json({
        sent: false,
        skipped: false,
        reason: err instanceof Error ? err.message : "Send failed",
      });
    }
  });
