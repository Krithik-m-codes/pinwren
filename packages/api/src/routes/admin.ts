import { emailSettingsUpdate, emailTest, securitySettingsUpdate } from "@pinwren/core";
import { getDb, user } from "@pinwren/db";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { requireInstanceAdmin, type SessionVars } from "../context";
import { getEmailSettings, updateEmailSettings } from "../email/config";
import { sendEmail } from "../email/send";
import { testEmail } from "../email/templates";
import { ApiError } from "../errors";
import { emailBrand } from "../services/branding";
import { getSecuritySettings, runUpdateCheck, updateSecuritySettings } from "../settings/instance";

/** Instance settings for self-host administrators (mounted at /api/admin, after requireSession). */
export const admin = new Hono<{ Variables: SessionVars }>()
  .use(requireInstanceAdmin)

  .get("/settings/email", async (c) => c.json({ email: await getEmailSettings() }))

  .patch("/settings/email", zValidator("json", emailSettingsUpdate), async (c) => {
    const rejected = await updateEmailSettings(c.req.valid("json"), c.var.userId);
    if (rejected.length) {
      throw new ApiError(
        409,
        "SETTING_LOCKED",
        `Set by environment variables and locked: ${rejected.join(", ")}`,
      );
    }
    return c.json({ email: await getEmailSettings() });
  })

  /** Sends synchronously so the admin sees the SMTP error. Unconfigured → `{ sent: false }`, not an error. */
  .post("/settings/email/test", zValidator("json", emailTest), async (c) => {
    let to = c.req.valid("json").to;
    if (!to) {
      const [u] = await getDb().select({ email: user.email }).from(user).where(eq(user.id, c.var.userId));
      to = u?.email;
    }
    if (!to) throw new ApiError(400, "NO_RECIPIENT", "No recipient address");
    try {
      const result = await sendEmail({ to, ...testEmail(await emailBrand(c.var.orgId)) });
      return c.json(result.sent ? { sent: true, to } : { sent: false, skipped: true, reason: result.reason });
    } catch (err) {
      return c.json({
        sent: false,
        skipped: false,
        reason: err instanceof Error ? err.message : "Send failed",
      });
    }
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

  /** Run the update check now: `{ checked: true, state }` or `{ checked: false, reason }`. */
  .post("/update-check", async (c) => c.json(await runUpdateCheck()));
