import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { requireInstanceAdmin, type SessionVars } from "../context";
import { getSignInMethods, getSignInSettings, updateSignInSettings } from "../settings/sign-in";

/**
 * Public: which sign-in methods the sign-in and sign-up pages offer (password always; email links with
 * SMTP and the switch on; passkeys; Google / GitHub when configured). No session.
 */
export const signInMethods = new Hono().get("/sign-in-methods", async (c) => {
  c.header("cache-control", "no-store");
  return c.json({ methods: await getSignInMethods() });
});

const signInSettingsUpdate = z
  .object({ magicLink: z.boolean().optional(), passkeys: z.boolean().optional() })
  .strict()
  .refine((v) => v.magicLink !== undefined || v.passkeys !== undefined, { message: "Nothing to change" });

/**
 * Settings › Security › Sign-in methods (instance admins; mounted at /api/admin after the dashboard's
 * session guard). Google / GitHub are read-only here: their secrets come from the environment.
 */
export const signInSettings = new Hono<{ Variables: SessionVars }>()
  .use(requireInstanceAdmin)
  .get("/settings/sign-in", async (c) => c.json({ signIn: await getSignInSettings() }))
  .patch("/settings/sign-in", zValidator("json", signInSettingsUpdate), async (c) => {
    await updateSignInSettings(c.req.valid("json"), c.var.userId);
    return c.json({ signIn: await getSignInSettings() });
  });
