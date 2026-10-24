import { appRoleOf } from "@pinwren/core";
import { account as authAccount, getDb, invitation, organization, user, userPreference } from "@pinwren/db";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { getAuth } from "../auth";
import { resolveSmtp } from "../email/config";
import { ApiError, notFound, unauthorized } from "../errors";
import { consume } from "../rate-limit";
import { shareWorkspace } from "../services/setup";
import { decodeDataUrl, EXTENSIONS, storage } from "../storage";

// The signed-in person's own account (wave-5 contract §3.1): profile, avatar, email change without SMTP,
// and the invitations waiting for their address. None of it needs an active workspace (onboarding uses
// the invitations), so these routes sit in front of the dashboard router and check the session
// themselves. Every role may call them: they change only the caller's own account.

type AccountVars = { userId: string; email: string };

/** A signed-in account; no workspace required. Per route: a `use` here would cover every later /api route. */
const requireAccount = createMiddleware<{ Variables: AccountVars }>(async (c, next) => {
  const session = await getAuth().api.getSession({ headers: c.req.raw.headers });
  if (!session) throw unauthorized();
  c.set("userId", session.user.id);
  c.set("email", session.user.email);
  await next();
});

export const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const MAX_AVATAR_BYTES = 512 * 1024;

const profileUpdate = z.object({ name: z.string().trim().min(1, "Your name can't be empty").max(120) });
const avatarUpload = z.object({ dataUrl: z.string().max(1_000_000) });
const emailChange = z.object({
  newEmail: z.email("Enter a valid email address").max(254),
  password: z.string().min(1).max(128),
});

/** `user.image` for an uploaded avatar; the version makes browsers fetch a replaced one. */
export const avatarUrl = (userId: string, version: number) =>
  `/api/avatars/${encodeURIComponent(userId)}?v=${version.toString(36)}`;

const contentTypeOf = (key: string) =>
  Object.entries(EXTENSIONS).find(([, ext]) => key.endsWith(`.${ext}`))?.[0] ?? "application/octet-stream";

async function avatarKeyOf(userId: string): Promise<string | null> {
  const [pref] = await getDb()
    .select({ avatarKey: userPreference.avatarKey })
    .from(userPreference)
    .where(eq(userPreference.userId, userId));
  return pref?.avatarKey ?? null;
}

async function removeFile(key: string | null) {
  if (!key) return;
  await storage()
    .remove(key)
    .catch((err: unknown) => console.warn(`[pinwren] could not remove ${key}`, err));
}

export const account = new Hono<{ Variables: AccountVars }>()
  /**
   * Invitations waiting for the signed-in address (onboarding offers them before "create a workspace").
   * Matched case-insensitively, pending and unexpired, as Better Auth checks on accept.
   */
  .get("/me/invitations", requireAccount, async (c) => {
    const rows = await getDb()
      .select({
        id: invitation.id,
        organizationId: invitation.organizationId,
        organizationName: organization.name,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        inviterName: user.name,
      })
      .from(invitation)
      .innerJoin(organization, eq(organization.id, invitation.organizationId))
      .leftJoin(user, eq(user.id, invitation.inviterId))
      .where(
        and(
          sql`lower(${invitation.email}) = ${c.var.email.toLowerCase()}`,
          eq(invitation.status, "pending"),
          gt(invitation.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(invitation.createdAt));
    return c.json({
      invitations: rows.map((r) => ({ ...r, appRole: appRoleOf(r.role ?? "member") })),
    });
  })

  .patch("/me/profile", requireAccount, zValidator("json", profileUpdate), async (c) => {
    const [u] = await getDb()
      .update(user)
      .set({ name: c.req.valid("json").name, updatedAt: new Date() })
      .where(eq(user.id, c.var.userId))
      .returning({ id: user.id, name: user.name, email: user.email, image: user.image });
    if (!u) throw notFound("Account");
    return c.json({ user: u });
  })

  /** Avatar upload: PNG, JPEG or WebP up to 512 KB, magic-byte checked (the logo upload's rules). */
  .post("/me/avatar", requireAccount, zValidator("json", avatarUpload), async (c) => {
    if (!(await consume(`avatar:${c.var.userId}`, 30, 3600))) {
      throw new ApiError(429, "RATE_LIMITED", "Too many uploads. Try again later.");
    }
    let file: { bytes: Uint8Array; contentType: string };
    try {
      file = decodeDataUrl(c.req.valid("json").dataUrl, AVATAR_TYPES, MAX_AVATAR_BYTES);
    } catch (err) {
      throw new ApiError(400, "INVALID_IMAGE", err instanceof Error ? err.message : "Invalid image");
    }
    const key = `avatars/${crypto.randomUUID()}.${EXTENSIONS[file.contentType] ?? "bin"}`;
    await storage().put(key, file.bytes, file.contentType);
    const previous = await avatarKeyOf(c.var.userId);
    const db = getDb();
    await db
      .insert(userPreference)
      .values({ userId: c.var.userId, avatarKey: key })
      .onConflictDoUpdate({
        target: userPreference.userId,
        set: { avatarKey: key, updatedAt: new Date() },
      });
    const image = avatarUrl(c.var.userId, Date.now());
    await db.update(user).set({ image, updatedAt: new Date() }).where(eq(user.id, c.var.userId));
    await removeFile(previous);
    return c.json({ image });
  })

  .delete("/me/avatar", requireAccount, async (c) => {
    const previous = await avatarKeyOf(c.var.userId);
    const db = getDb();
    await db
      .update(userPreference)
      .set({ avatarKey: null, updatedAt: new Date() })
      .where(eq(userPreference.userId, c.var.userId));
    await db.update(user).set({ image: null, updatedAt: new Date() }).where(eq(user.id, c.var.userId));
    await removeFile(previous);
    return c.json({ image: null });
  })

  /** Someone's avatar, for anyone who shares a workspace with them. */
  .get("/avatars/:userId", requireAccount, async (c) => {
    const target = c.req.param("userId");
    if (!(await shareWorkspace(c.var.userId, target))) throw notFound("Avatar");
    const key = await avatarKeyOf(target);
    if (!key) throw notFound("Avatar");
    const file = await storage().get(key);
    if (!file) throw notFound("Avatar");
    return new Response(file.body, {
      headers: {
        "content-type": contentTypeOf(key),
        // The URL carries a version, so a replaced avatar is a new URL.
        "cache-control": "private, max-age=86400",
        "content-security-policy": "default-src 'none'; sandbox",
        "x-content-type-options": "nosniff",
        ...(file.bytes ? { "content-length": String(file.bytes) } : {}),
      },
    });
  })

  /**
   * Change the account email with the password, for servers without SMTP (with SMTP the dashboard uses
   * Better Auth's verified change-email flow, and this refuses). The new address starts unverified.
   */
  .post("/me/email", requireAccount, zValidator("json", emailChange), async (c) => {
    if ((await resolveSmtp()) !== null) {
      throw new ApiError(
        409,
        "VERIFY_BY_EMAIL",
        "Email is set up on this server: confirm the change from the link we email you",
      );
    }
    if (!(await consume(`email-change:${c.var.userId}`, 10, 3600))) {
      throw new ApiError(429, "RATE_LIMITED", "Too many attempts. Try again later.");
    }
    const { newEmail, password } = c.req.valid("json");
    const next = newEmail.trim().toLowerCase();
    if (next === c.var.email.toLowerCase()) {
      throw new ApiError(400, "SAME_EMAIL", "That's already your email address");
    }
    const db = getDb();
    const [cred] = await db
      .select({ password: authAccount.password })
      .from(authAccount)
      .where(and(eq(authAccount.userId, c.var.userId), eq(authAccount.providerId, "credential")));
    const ctx = await getAuth().$context;
    if (!cred?.password || !(await ctx.password.verify({ hash: cred.password, password }))) {
      throw new ApiError(400, "INVALID_PASSWORD", "That password isn't right");
    }
    const [taken] = await db
      .select({ id: user.id })
      .from(user)
      .where(sql`lower(${user.email}) = ${next}`);
    if (taken) throw new ApiError(409, "EMAIL_TAKEN", "Another account already uses that address");
    try {
      const [u] = await db
        .update(user)
        .set({ email: next, emailVerified: false, updatedAt: new Date() })
        .where(eq(user.id, c.var.userId))
        .returning({ id: user.id, name: user.name, email: user.email, image: user.image });
      return c.json({ user: u });
    } catch (err) {
      if ((err as { code?: string; cause?: { code?: string } }).cause?.code === "23505") {
        throw new ApiError(409, "EMAIL_TAKEN", "Another account already uses that address");
      }
      throw err;
    }
  });
