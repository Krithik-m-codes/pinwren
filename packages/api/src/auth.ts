import { getDb, schema } from "@annota/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins/organization";
import { invitationEmail } from "./email/templates";
import { env } from "./env";
import { enqueue, QUEUES } from "./jobs/boss";

/** Dashboard page that accepts an invitation (calls Better Auth's accept-invitation endpoint). */
export const acceptInvitationUrl = (id: string) =>
  `${env().ANNOTA_URL.replace(/\/$/, "")}/accept-invitation/${encodeURIComponent(id)}`;

function createAuth() {
  const e = env();
  return betterAuth({
    baseURL: e.ANNOTA_URL,
    basePath: "/api/auth",
    secret: e.ANNOTA_SECRET,
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: e.ANNOTA_DISABLE_SIGNUP,
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
            ...invitationEmail({
              orgName: data.organization.name,
              inviterName: data.inviter.user.name || data.inviter.user.email,
              role: data.role,
              acceptUrl: acceptInvitationUrl(data.id),
              expiresAt: new Date(data.invitation.expiresAt),
            }),
          });
        },
      }),
    ],
    // Signed session cache in a cookie: most dashboard requests skip the session lookup in Postgres.
    // Revocation (sign-out elsewhere) takes effect within maxAge.
    session: { cookieCache: { enabled: true, maxAge: 60 } },
    advanced: { database: { generateId: () => crypto.randomUUID() } },
    trustedOrigins: [e.ANNOTA_URL],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const g = globalThis as unknown as { __annotaAuth?: Auth };

export function getAuth(): Auth {
  g.__annotaAuth ??= createAuth();
  return g.__annotaAuth;
}
