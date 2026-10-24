import {
  EMAIL_DELIVERY_STATUSES,
  emailSettingsUpdate,
  emailTest,
  licenseUpload,
  securitySettingsUpdate,
} from "@pinwren/core";
import { getDb, user } from "@pinwren/db";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireInstanceAdmin, type SessionVars } from "../context";
import { getEmailSettings, isValidFrom, resolveSmtp, updateEmailSettings } from "../email/config";
import { describeEmailError, listDeliveries, resendDelivery, resendSkipped } from "../email/deliveries";
import { buildTransport } from "../email/send";
import { testEmail } from "../email/templates";
import { ApiError } from "../errors";
import {
  installLicense,
  publicEntitlements,
  removeLicense,
  type Resolved,
  resolveEntitlements,
} from "../license";
import { emailBrand } from "../services/branding";
import { getSecuritySettings, runUpdateCheck, updateSecuritySettings } from "../settings/instance";

/** What instance admins see in Settings › Licence: entitlements plus where the licence comes from. */
const licenseOut = (r: Resolved) => ({
  ...publicEntitlements(r),
  source: r.source,
  details: r.payload
    ? {
        lid: r.payload.lid,
        customer: r.payload.customer,
        email: r.payload.email ?? null,
        features: r.payload.features,
        limits: r.payload.limits,
        issuedAt: r.payload.issuedAt,
        expiresAt: r.payload.expiresAt,
        graceDays: r.payload.graceDays,
        instance: r.payload.instance,
      }
    : null,
});

const invalidFrom = () =>
  new ApiError(
    400,
    "INVALID_FROM",
    "From must be an address or Name <address>, e.g. Pinwren <noreply@example.com>",
  );
const notConfigured = () =>
  new ApiError(409, "EMAIL_NOT_CONFIGURED", "Set up SMTP first: nothing can be sent yet");

const deliveriesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(EMAIL_DELIVERY_STATUSES).optional(),
});

/** Instance settings for self-host administrators (mounted at /api/admin, after requireSession). */
export const admin = new Hono<{ Variables: SessionVars }>()
  .use(requireInstanceAdmin)

  .get("/settings/email", async (c) => c.json({ email: await getEmailSettings() }))

  .patch("/settings/email", zValidator("json", emailSettingsUpdate), async (c) => {
    const patch = c.req.valid("json");
    if (patch.from && !isValidFrom(patch.from)) throw invalidFrom();
    const rejected = await updateEmailSettings(patch, c.var.userId);
    if (rejected.length) {
      throw new ApiError(
        409,
        "SETTING_LOCKED",
        `Set by environment variables and locked: ${rejected.join(", ")}`,
      );
    }
    return c.json({ email: await getEmailSettings() });
  })

  /**
   * Test the settings — the saved ones, or the form's unsaved `config` laid over them — synchronously, so
   * the admin sees the SMTP server's answer: first `verify()` (connect, TLS, login), then a real send.
   * Not configured → `{ sent: false, skipped: true }`, not an error.
   */
  .post("/settings/email/test", zValidator("json", emailTest), async (c) => {
    const { to: requested, config: draft } = c.req.valid("json");
    if (draft?.from && !isValidFrom(draft.from)) throw invalidFrom();
    let to = requested;
    if (!to) {
      const [u] = await getDb().select({ email: user.email }).from(user).where(eq(user.id, c.var.userId));
      to = u?.email;
    }
    if (!to) throw new ApiError(400, "NO_RECIPIENT", "No recipient address");
    const smtp = await resolveSmtp(draft);
    if (!smtp) {
      return c.json({ sent: false, skipped: true, reason: "Set a host and a from address first" });
    }
    const transport = buildTransport(smtp);
    try {
      await transport.verify();
      await transport.sendMail({ from: smtp.from, to, ...testEmail(await emailBrand(c.var.orgId)) });
      return c.json({ sent: true, to });
    } catch (err) {
      return c.json({ sent: false, skipped: false, reason: describeEmailError(err) });
    } finally {
      transport.close();
    }
  })

  // --- Delivery log: what the email worker sent, skipped or gave up on (30 days) ---------------------
  .get("/settings/email/deliveries", zValidator("query", deliveriesQuery), async (c) => {
    const { limit, status } = c.req.valid("query");
    return c.json(await listDeliveries(limit, status));
  })

  /** Send one logged email again, now; the response carries the new outcome. */
  .post("/settings/email/deliveries/:id/resend", async (c) => {
    const out = await resendDelivery(c.req.param("id"));
    if (out.ok) return c.json({ delivery: out.delivery });
    if (out.code === "NOT_FOUND") throw new ApiError(404, "NOT_FOUND", "Delivery not found");
    if (out.code === "UNSUBSCRIBED") {
      throw new ApiError(409, "UNSUBSCRIBED", "This address unsubscribed; it won't be emailed again");
    }
    throw notConfigured();
  })

  /** Queue every email that was skipped because SMTP wasn't set up yet (last 30 days). */
  .post("/settings/email/deliveries/resend-skipped", async (c) => {
    const out = await resendSkipped();
    if (!out) throw notConfigured();
    return c.json(out);
  })

  // --- Security: session lifetime, HTTPS (read-only, env), update check -----------------------------
  .get("/settings/security", async (c) => c.json({ security: await getSecuritySettings() }))

  .patch("/settings/security", zValidator("json", securitySettingsUpdate), async (c) => {
    const rejected = await updateSecuritySettings(c.req.valid("json"), c.var.userId);
    if (rejected.length) {
      throw new ApiError(
        409,
        "SETTING_LOCKED",
        `Set by environment variables and locked: ${rejected.join(", ")}`,
      );
    }
    return c.json({ security: await getSecuritySettings() });
  })

  // --- Enterprise licence (F-098) ---------------------------------------------------------------------
  .get("/license", async (c) => c.json({ license: licenseOut(await resolveEntitlements()) }))

  /** Upload a `.lic` file's text. Invalid or tampered → 400 INVALID_LICENSE; env-set → 409 LICENSE_LOCKED. */
  .post("/license", zValidator("json", licenseUpload), async (c) =>
    c.json({ license: licenseOut(await installLicense(c.req.valid("json").license, c.var.userId)) }),
  )

  .delete("/license", async (c) => c.json({ license: licenseOut(await removeLicense()) }))

  /** Run the update check now: `{ checked: true, state }` or `{ checked: false, reason }`. */
  .post("/update-check", async (c) => c.json(await runUpdateCheck()));
