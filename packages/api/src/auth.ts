import { MAX_SESSION_DAYS } from "@pinwren/core";
import { getDb, schema } from "@pinwren/db";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins/organization";
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, memberAc, ownerAc } from "better-auth/plugins/organization/access";
import { renderEmail } from "./email/render";
import { env } from "./env";
import { enqueue, QUEUES } from "./jobs/boss";
import { consume } from "./rate-limit";
import { signupAllowed } from "./services/setup";
import { sessionLifetimeDays } from "./settings/instance";

/** Set by the API in front of Better Auth from the trusted-proxy logic (index.ts); never client input. */
const AUTH_IP_HEADER = "x-pinwren-client-ip";

/**
 * Sign-up policy and invitation rate limit (ADR 0021), checked before Better Auth runs the endpoint.
 * Invitations send email to any address, so an organisation may send PINWREN_INVITES_PER_HOUR an hour.
 */
const policyHooks = createAuthMiddleware(async (ctx) => {
  if (ctx.path === "/sign-up/email") {
    const email = (ctx.body as { email?: unknown } | undefined)?.email;
    if (typeof email !== "string" || !(await signupAllowed(email))) {
      throw new APIError("FORBIDDEN", {
        code: "SIGNUP_CLOSED",
        message: "Sign-up is closed on this instance. Ask an administrator for an invitation.",
      });
    }
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
  }
});

/** Dashboard page that accepts an invitation (calls Better Auth's accept-invitation endpoint). */
export const acceptInvitationUrl = (id: string) =>
  `${env().PINWREN_URL.replace(/\/$/, "")}/accept-invitation/${encodeURIComponent(id)}`;

const ac = createAccessControl(defaultStatements);

function createAuth() {
  const e = env();
  return betterAuth({
    baseURL: e.PINWREN_URL,
    basePath: "/api/auth",
    secret: e.PINWREN_SECRET,
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      // Who may sign up is decided in `policyHooks` (first account, invitees, or open sign-up).
      disableSignUp: false,
      minPasswordLength: 8,
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
      },
    },
    plugins: [
      organization({
        allowUserToCreateOrganization: true,
        // Better Auth's three roles plus `viewer` (wave-4 contract §4): reads everything, changes nothing.
        // Viewers hold no organisation permissions here; the API refuses their writes (READ_ONLY_ROLE).
        ac,
        roles: {
          owner: ac.newRole(ownerAc.statements),
          admin: ac.newRole(adminAc.statements),
          member: ac.newRole(memberAc.statements),
          viewer: ac.newRole({ ac: ["read"] }),
        },
        invitationExpiresIn: 7 * 24 * 3600,
        // There is no email-verification flow yet (SMTP is optional). Accepting needs the
        // invitation id, a random UUID that only reaches the invitee's inbox (and the org's own
        // admins), and the signed-in user's email must match the invitation's.
        requireEmailVerificationOnInvitation: false,
        // Queued, so a slow or missing SMTP server never fails the invite itself.
        async sendInvitationEmail(data) {
          await enqueue(QUEUES.email, {
            to: data.email,
            ...(await renderEmail(data.organization.id, "invitation", {
              orgName: data.organization.name,
              inviterName: data.inviter.user.name || data.inviter.user.email,
              role: data.role,
              acceptUrl: acceptInvitationUrl(data.id),
              expiresAt: new Date(data.invitation.expiresAt).toUTCString(),
            })),
          });
        },
      }),
    ],
    // Signed session cache in a cookie: most dashboard requests skip the session lookup in Postgres.
    // Revocation (sign-out elsewhere) takes effect within maxAge.
    // Session lifetime is an instance setting (Settings › Security). The cookie may live as long as
    // the longest allowed lifetime; each session row gets its own expiry when it is created, and
    // sessions are not slid forward, so the admin's lifetime is a hard limit from sign-in.
    session: {
      cookieCache: { enabled: true, maxAge: 60 },
      expiresIn: MAX_SESSION_DAYS * 24 * 3600,
      disableSessionRefresh: true,
    },
    databaseHooks: {
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
