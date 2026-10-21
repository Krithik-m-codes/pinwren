import { MAX_SESSION_DAYS } from "@pinwren/core";
import { getDb, schema } from "@pinwren/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins/organization";
import { renderEmail } from "./email/render";
import { env } from "./env";
import { enqueue, QUEUES } from "./jobs/boss";
import { sessionLifetimeDays } from "./settings/instance";

/** Dashboard page that accepts an invitation (calls Better Auth's accept-invitation endpoint). */
export const acceptInvitationUrl = (id: string) =>
  `${env().PINWREN_URL.replace(/\/$/, "")}/accept-invitation/${encodeURIComponent(id)}`;

function createAuth() {
  const e = env();
  return betterAuth({
    baseURL: e.PINWREN_URL,
    basePath: "/api/auth",
    secret: e.PINWREN_SECRET,
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: e.PINWREN_DISABLE_SIGNUP,
      minPasswordLength: 8,
    },
    plugins: [
      organization({
        allowUserToCreateOrganization: true,
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
    advanced: { database: { generateId: () => crypto.randomUUID() } },
    trustedOrigins: [e.PINWREN_URL],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const g = globalThis as unknown as { __pinwrenAuth?: Auth };

export function getAuth(): Auth {
  g.__pinwrenAuth ??= createAuth();
  return g.__pinwrenAuth;
}
