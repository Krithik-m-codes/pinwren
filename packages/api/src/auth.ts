import { assertSeatQuota } from "./billing/service";
import { identityDatabase } from "@pinwren/db/identity";
import { MAX_SESSION_DAYS, MIN_PASSWORD_LENGTH } from "@pinwren/core";
import { schema, user as userTable, userPreference, withOrg } from "@pinwren/db";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins/magic-link";
import { organization } from "better-auth/plugins/organization";
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, memberAc, ownerAc } from "better-auth/plugins/organization/access";
import { twoFactor } from "better-auth/plugins/two-factor";
import { eq, sql } from "drizzle-orm";
import { resolveSmtp } from "./email/config";
import { renderEmail } from "./email/render";
import { env } from "./env";
import { ApiError } from "./errors";
import { enqueue, QUEUES } from "./jobs/boss";
import { consume } from "./rate-limit";
import { forgetInstanceAdmin, promoteFirstAccount, signupAllowed } from "./services/setup";
import { accountDeletionPlan, deleteWorkspace, ownedWorkspaces } from "./services/workspace";
import { sessionLifetimeDays } from "./settings/instance";
import {
  getSignInMethods,
  isMethodPath,
  refusedMethod,
  signupPolicyApplies,
  socialProvidersFrom,
} from "./settings/sign-in";
import { storage } from "./storage";

/** Set by the API in front of Better Auth from the trusted-proxy logic (index.ts); never client input. */
const AUTH_IP_HEADER = "x-pinwren-client-ip";

/** Shown wherever an account email can't go out because SMTP isn't set up (Settings › Email). */
const NO_EMAIL = "Email isn't set up on this server, so Pinwren can't send that. Ask your administrator.";

const emailConfigured = async () => (await resolveSmtp()) !== null;

const signupClosed = () =>
  new APIError("FORBIDDEN", {
    code: "SIGNUP_CLOSED",
    message: "Sign-up is closed on this instance. Ask an administrator for an invitation.",
  });

/**
 * Sign-up policy and invitation rate limit (ADR 0021), checked before Better Auth runs the endpoint.
 * Invitations send email to any address, so an organisation may send PINWREN_INVITES_PER_HOUR an hour.
 */
const policyHooks = createAuthMiddleware(async (ctx) => {
  if (ctx.path === "/sign-up/email") {
    const email = (ctx.body as { email?: unknown } | undefined)?.email;
    if (typeof email !== "string" || !(await signupAllowed(email))) throw signupClosed();
  }
  // Email links and passkeys are switched in Settings › Security; an email link also needs SMTP.
  if (isMethodPath(ctx.path)) {
    const refused = refusedMethod(ctx.path, await getSignInMethods());
    if (refused) throw new APIError("BAD_REQUEST", refused);
  }
  // Email-backed account flows say so up front instead of "sending" into the void (the dashboard changes
  // the address with the password instead, `POST /api/me/email`).
  if (ctx.path === "/change-email" || ctx.path === "/send-verification-email") {
    if (!(await emailConfigured())) {
      throw new APIError("BAD_REQUEST", { code: "EMAIL_NOT_CONFIGURED", message: NO_EMAIL });
    }
  }
  // Workspaces are deleted through `DELETE /api/workspace`, which also removes their stored files.
  if (ctx.path === "/organization/delete") {
    throw new APIError("BAD_REQUEST", {
      code: "USE_WORKSPACE_SETTINGS",
      message: "Delete the workspace from Settings › Workspace.",
    });
  }
  if (ctx.path === "/organization/invite-member") {
    const session = await getSessionFromCtx(ctx);
    const body = ctx.body as { organizationId?: unknown } | undefined;
    const active: unknown = session?.session.activeOrganizationId;
    const orgId =
      typeof body?.organizationId === "string"
        ? body.organizationId
        : typeof active === "string"
          ? active
          : null;
    if (orgId && !(await consume(`invite:${orgId}`, env().PINWREN_INVITES_PER_HOUR, 3600))) {
      throw new APIError("TOO_MANY_REQUESTS", {
        code: "INVITES_RATE_LIMITED",
        message: "This organisation has sent too many invitations this hour.",
      });
    }
    // Cloud plans cap team seats; a no-op without billing.
    if (orgId) {
      try {
        await withOrg(orgId, (db) => assertSeatQuota(db, orgId));
      } catch (err) {
        if (err instanceof ApiError) {
          throw new APIError("PAYMENT_REQUIRED", { code: err.code, message: err.message });
        }
        throw err;
      }
    }
  }
});

/** Dashboard page that accepts an invitation (calls Better Auth's accept-invitation endpoint). */
export const acceptInvitationUrl = (id: string) =>
  `${env().PINWREN_URL.replace(/\/$/, "")}/accept-invitation/${encodeURIComponent(id)}`;

/** Dashboard page that sets a new password from a reset token (also the instance admin's copied link). */
export const resetPasswordUrl = (token: string) =>
  `${env().PINWREN_URL.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;

/** Account emails (reset, verify, change) are not workspace mail: default wording, instance branding. */
async function sendAccountEmail(
  to: string,
  key: "password_reset" | "verify_email" | "change_email" | "magic_link",
  vars: Record<string, string>,
) {
  await enqueue(QUEUES.email, { to, ...(await renderEmail(null, key, vars)) });
}

/** What account deletion found before the row went (Better Auth's after-hook only has the user). */
const pendingDeletion = new Map<string, { avatarKey: string | null; workspaces: string[] }>();

const ac = createAccessControl(defaultStatements);

function createAuth() {
  const e = env();
  return betterAuth({
    appName: "Pinwren",
    baseURL: e.PINWREN_URL,
    basePath: "/api/auth",
    secret: e.PINWREN_SECRET,
    database: drizzleAdapter(identityDatabase(), { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      // Who may sign up is decided in `policyHooks` (first account, invitees, or open sign-up).
      disableSignUp: false,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      // Queued like every email; without SMTP the job is skipped (and logged), and the dashboard tells
      // people to ask their administrator, who can copy a reset link from Users.
      async sendResetPassword({ user, url }) {
        await sendAccountEmail(user.email, "password_reset", {
          userName: user.name || user.email,
          resetUrl: url,
          expiresIn: "1 hour",
        });
      },
      resetPasswordTokenExpiresIn: 3600,
      // A reset signs every device out, so whoever knew the old password is out too.
      revokeSessionsOnPasswordReset: true,
    },
    // Verification is offered, never required: SMTP is optional, and an unverified address still signs in.
    emailVerification: {
      sendOnSignUp: true,
      expiresIn: 24 * 3600,
      async sendVerificationEmail({ user, url }) {
        if (!(await emailConfigured())) return;
        // Better Auth sends the change-email link to the new address with that address as `user.email`;
        // the stored address is still the old one until it's confirmed.
        const [stored] = await identityDatabase()
          .select({ email: userTable.email })
          .from(userTable)
          .where(eq(userTable.id, user.id));
        const changing = stored && stored.email.toLowerCase() !== user.email.toLowerCase();
        if (changing) {
          await sendAccountEmail(user.email, "change_email", {
            userName: user.name || user.email,
            newEmail: user.email,
            confirmUrl: url,
          });
        } else {
          await sendAccountEmail(user.email, "verify_email", {
            userName: user.name || user.email,
            verifyUrl: url,
          });
        }
      },
    },
    user: {
      changeEmail: {
        enabled: true,
        // A verified address approves the change first; the new address then gets its own link.
        async sendChangeEmailConfirmation({ user, newEmail, url }) {
          await sendAccountEmail(user.email, "change_email", {
            userName: user.name || user.email,
            newEmail,
            confirmUrl: url,
          });
        },
      },
      deleteUser: {
        enabled: true,
        async beforeDelete(user) {
          const plan = accountDeletionPlan(await ownedWorkspaces(user.id));
          if (plan.blockedBy.length) {
            throw new APIError("BAD_REQUEST", {
              code: "SOLE_OWNER",
              message: `You own ${plan.blockedBy.join(", ")}. Transfer ownership or delete ${
                plan.blockedBy.length === 1 ? "it" : "them"
              } first.`,
            });
          }
          const [pref] = await identityDatabase()
            .select({ avatarKey: userPreference.avatarKey })
            .from(userPreference)
            .where(eq(userPreference.userId, user.id));
          pendingDeletion.set(user.id, { avatarKey: pref?.avatarKey ?? null, workspaces: plan.deleteWith });
        },
        async afterDelete(user) {
          const pending = pendingDeletion.get(user.id);
          pendingDeletion.delete(user.id);
          // Workspaces only they were in would otherwise sit there with nobody able to open them.
          for (const orgId of pending?.workspaces ?? []) await deleteWorkspace(orgId);
          if (pending?.avatarKey) {
            await storage()
              .remove(pending.avatarKey)
              .catch((err: unknown) => console.warn("[pinwren] could not remove an avatar", err));
          }
          // Off the admin list; when it was the last one, the oldest remaining account takes over.
          await forgetInstanceAdmin(user.id);
        },
      },
    },
    // Google / GitHub, only when both env halves are set (settings/sign-in.ts). New accounts they create
    // pass the same sign-up policy as a password sign-up (the user-create hook below).
    socialProviders: socialProvidersFrom(e),
    account: {
      accountLinking: {
        enabled: true,
        // Signing in with Google / GitHub joins an existing account only when the provider vouches for
        // the address and the account's own address is verified (Better Auth's defaults). Signed in,
        // Settings › Profile can connect a provider account with another address.
        allowDifferentEmails: true,
      },
    },
    hooks: { before: policyHooks },
    // On in every environment (Better Auth's default is production only). Keyed by the address the API
    // derived with PINWREN_TRUST_PROXY — Better Auth never reads X-Forwarded-For itself. In memory, per
    // server process.
    rateLimit: {
      enabled: true,
      // Shared by every worker process and replica (in memory, each worker had its own allowance).
      storage: "database",
      modelName: "authRateLimit",
      // Better Auth's general default (100 per 10 s per address and path); credentials endpoints tighter.
      window: 10,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 600, max: 20 },
        "/request-password-reset": { window: 3600, max: 10 },
        "/reset-password": { window: 600, max: 10 },
        "/send-verification-email": { window: 3600, max: 10 },
        "/change-email": { window: 3600, max: 10 },
        "/delete-user": { window: 600, max: 5 },
        "/two-factor/verify-totp": { window: 60, max: 10 },
        "/two-factor/verify-backup-code": { window: 60, max: 10 },
        "/two-factor/enable": { window: 600, max: 10 },
        "/sign-in/magic-link": { window: 3600, max: 10 },
        "/sign-in/social": { window: 60, max: 20 },
        "/passkey/verify-authentication": { window: 60, max: 10 },
        "/passkey/verify-registration": { window: 600, max: 10 },
      },
    },
    plugins: [
      organization({
        allowUserToCreateOrganization: true,
        // Better Auth's three roles plus `viewer` (wave-4 contract §4): reads everything, changes nothing.
        // Viewers hold no organisation permissions here; the API refuses their writes (READ_ONLY_ROLE).
        // In the dashboard these are Admin (owner/admin), Editor (member) and Viewer (@pinwren/core roles).
        ac,
        roles: {
          owner: ac.newRole(ownerAc.statements),
          admin: ac.newRole(adminAc.statements),
          member: ac.newRole(memberAc.statements),
          viewer: ac.newRole({ ac: ["read"] }),
        },
        invitationExpiresIn: 7 * 24 * 3600,
        // Verification is optional (SMTP is). Accepting needs the invitation id, a random UUID that only
        // reaches the invitee's inbox (and the org's own admins), and the signed-in user's email must
        // match the invitation's.
        requireEmailVerificationOnInvitation: false,
        // Queued, so a slow or missing SMTP server never fails the invite itself.
        async sendInvitationEmail(data) {
          await enqueue(QUEUES.email, {
            to: data.email,
            ...(await withOrg(data.organization.id, () =>
              renderEmail(data.organization.id, "invitation", {
                orgName: data.organization.name,
                inviterName: data.inviter.user.name || data.inviter.user.email,
                role: data.role,
                acceptUrl: acceptInvitationUrl(data.id),
                expiresAt: new Date(data.invitation.expiresAt).toUTCString(),
              }),
            )),
          });
        },
      }),
      // TOTP with backup codes, enrolled in Settings › Profile; sign-in asks for a code (/two-factor).
      twoFactor({ issuer: "Pinwren", backupCodeOptions: { amount: 10 } }),
      // Sign-in links by email (sign-in page, only with SMTP and the Security switch on; policyHooks).
      magicLink({
        expiresIn: 600,
        storeToken: "hashed",
        async sendMagicLink({ email, url }) {
          const address = email.trim().toLowerCase();
          const [existing] = await identityDatabase()
            .select({ name: userTable.name })
            .from(userTable)
            .where(eq(sql`lower(${userTable.email})`, address))
            .limit(1);
          // A stranger on a closed server gets the same "check your inbox" as everyone (no account
          // enumeration), but no link: following it couldn't create an account anyway.
          if (!existing && !(await signupAllowed(address))) return;
          await sendAccountEmail(address, "magic_link", {
            userName: existing?.name || address,
            signInUrl: url,
            expiresIn: "10 minutes",
          });
        },
      }),
      // WebAuthn passkeys, registered in Settings › Profile. Bound to PINWREN_URL: the browser only offers
      // a passkey on that host, and the signed origin must match it.
      passkey({
        rpID: new URL(e.PINWREN_URL).hostname,
        rpName: "Pinwren",
        origin: new URL(e.PINWREN_URL).origin,
      }),
    ],
    // Signed session cache in a cookie: most dashboard requests skip the session lookup in Postgres.
    // Revocation (sign-out elsewhere) takes effect within maxAge.
    // Session lifetime is an instance setting (Settings › Security). The cookie may live as long as
    // the longest allowed lifetime; each session row gets its own expiry when it is created, and
    // sessions are not slid forward, so the admin's lifetime is a hard limit from sign-in.
    session: {
      cookieCache: { enabled: e.PINWREN_MODE !== "cloud", maxAge: 60 },
      expiresIn: MAX_SESSION_DAYS * 24 * 3600,
      disableSessionRefresh: true,
    },
    databaseHooks: {
      user: {
        create: {
          // Every self-service account (password, Google / GitHub, email link) passes the sign-up policy:
          // the first account, invitees, or open sign-up. Add User (no auth endpoint) is exempt.
          async before(newUser, ctx) {
            if (signupPolicyApplies(ctx?.path) && !(await signupAllowed(newUser.email))) {
              throw signupClosed();
            }
            // Google / GitHub hand over a picture on their own hosts, which the dashboard's CSP (img-src
            // 'self') won't load and which would leak who views it to them; people upload one in Profile.
            if (newUser.image && !newUser.image.startsWith("/")) return { data: { ...newUser, image: null } };
            return undefined;
          },
          // BugPin: the first account on a fresh instance administers it (services/setup.ts). Runs after
          // the insert commits; a failure never fails the sign-up (the next start retries).
          async after() {
            try {
              await promoteFirstAccount();
            } catch (err) {
              console.error("[pinwren] could not make the first account the administrator", err);
            }
          },
        },
      },
      session: {
        create: {
          async before(session) {
            const days = await sessionLifetimeDays();
            return { data: { ...session, expiresAt: new Date(Date.now() + days * 24 * 3600 * 1000) } };
          },
        },
      },
    },
    advanced: {
      database: { generateId: () => crypto.randomUUID() },
      ipAddress: { ipAddressHeaders: [AUTH_IP_HEADER] },
    },
    trustedOrigins: [e.PINWREN_URL],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const g = globalThis as unknown as { __pinwrenAuth?: Auth };

export function getAuth(): Auth {
  g.__pinwrenAuth ??= createAuth();
  return g.__pinwrenAuth;
}
