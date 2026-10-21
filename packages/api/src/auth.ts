import { getDb, schema } from "@annota/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins/organization";
import { env } from "./env";

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
    plugins: [organization({ allowUserToCreateOrganization: true })],
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
