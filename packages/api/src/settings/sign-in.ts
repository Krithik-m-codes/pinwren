import { readInstanceSetting, saveInstanceSetting } from "../db/system";
import { z } from "zod";
import { resolveSmtp } from "../email/config";
import { type Env, env } from "../env";

// Sign-in methods besides the password (Settings › Security › Sign-in methods). Email links and passkeys
// are switched in the dashboard by instance admins (on by default); Google and GitHub come from the
// environment only (their secrets never live in the database) and are offered once both halves are set.
// An email link also needs SMTP: without it there is nothing to click.

export const SIGN_IN_SETTING_KEY = "sign_in";

export const OAUTH_PROVIDERS = ["google", "github"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

type StoredSignIn = { magicLink?: boolean | undefined; passkeys?: boolean | undefined };

/** What the sign-in page offers (`GET /api/sign-in-methods`). */
export type SignInMethods = {
  password: true;
  magicLink: boolean;
  passkey: boolean;
  google: boolean;
  github: boolean;
};

export type SignInSettingsView = {
  /** The admin's switches, whatever SMTP says. */
  magicLink: boolean;
  passkeys: boolean;
  /** Email links go out only with SMTP set up (Settings › Email). */
  emailConfigured: boolean;
  providers: {
    id: OAuthProvider;
    name: string;
    configured: boolean;
    /** Paste into the provider's OAuth app as the redirect / callback URL. */
    callbackUrl: string;
    envVars: [string, string];
  }[];
};

const PROVIDER_ENV = {
  google: { name: "Google", id: "GOOGLE_CLIENT_ID", secret: "GOOGLE_CLIENT_SECRET" },
  github: { name: "GitHub", id: "GITHUB_CLIENT_ID", secret: "GITHUB_CLIENT_SECRET" },
} as const satisfies Record<OAuthProvider, { name: string; id: keyof Env; secret: keyof Env }>;

type ProviderEnv = Pick<
  Env,
  "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "GITHUB_CLIENT_ID" | "GITHUB_CLIENT_SECRET"
>;

/** Better Auth `socialProviders`: only the providers whose id and secret are both set. */
export function socialProvidersFrom(e: ProviderEnv) {
  return {
    ...(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: e.GOOGLE_CLIENT_ID,
            clientSecret: e.GOOGLE_CLIENT_SECRET,
            // Always let the person pick the Google account (several are common on one browser).
            prompt: "select_account" as const,
          },
        }
      : {}),
    ...(e.GITHUB_CLIENT_ID && e.GITHUB_CLIENT_SECRET
      ? { github: { clientId: e.GITHUB_CLIENT_ID, clientSecret: e.GITHUB_CLIENT_SECRET } }
      : {}),
  };
}

export const providerConfigured = (e: ProviderEnv, p: OAuthProvider) =>
  !!(e[PROVIDER_ENV[p].id] && e[PROVIDER_ENV[p].secret]);

/** Pure: what the sign-in page may offer, from the admin's switches, SMTP and the environment. */
export function resolveSignInMethods(o: {
  stored: StoredSignIn;
  emailConfigured: boolean;
  env: ProviderEnv;
}): SignInMethods {
  return {
    password: true,
    magicLink: (o.stored.magicLink ?? true) && o.emailConfigured,
    passkey: o.stored.passkeys ?? true,
    google: providerConfigured(o.env, "google"),
    github: providerConfigured(o.env, "github"),
  };
}

/**
 * Better Auth paths each switchable method answers on. Listing and deleting passkeys always work; a link
 * already sent stays good for its ten minutes (the verify step is a browser redirect, not a form).
 */
const METHOD_PATHS: { method: "magicLink" | "passkey"; paths: readonly string[] }[] = [
  { method: "magicLink", paths: ["/sign-in/magic-link"] },
  {
    method: "passkey",
    paths: [
      "/passkey/generate-authenticate-options",
      "/passkey/verify-authentication",
      "/passkey/generate-register-options",
      "/passkey/verify-registration",
    ],
  },
];

/**
 * Pure: the error for an auth request whose method is switched off (or, for email links, has no SMTP),
 * else null. Checked in auth.ts before Better Auth runs the endpoint.
 */
export function refusedMethod(
  path: string,
  methods: Pick<SignInMethods, "magicLink" | "passkey">,
): { code: string; message: string } | null {
  for (const { method, paths } of METHOD_PATHS) {
    if (!paths.includes(path) || methods[method]) continue;
    return method === "magicLink"
      ? { code: "MAGIC_LINK_DISABLED", message: "Email sign-in links aren't available on this server." }
      : { code: "PASSKEYS_DISABLED", message: "Passkeys aren't available on this server." };
  }
  return null;
}

/** Whether a Better Auth path belongs to a switchable method (so the setting is only read for those). */
export const isMethodPath = (path: string) => METHOD_PATHS.some((m) => m.paths.includes(path));

/**
 * Pure: whether a new account must pass the sign-up policy. Every account created by a request to Better
 * Auth (password sign-up, Google / GitHub, an email link) is self-service; accounts created by the server
 * itself (Users › Add User, with no auth endpoint behind it) are an Admin vouching for the person.
 */
export const signupPolicyApplies = (endpointPath: string | null | undefined) => !!endpointPath;

/** The stored switches; a malformed row (edited by hand) counts as the defaults. */
const storedSignIn = z
  .object({ magicLink: z.boolean().optional(), passkeys: z.boolean().optional() })
  .catch({});

async function readStored(): Promise<StoredSignIn> {
  const row = await readInstanceSetting(SIGN_IN_SETTING_KEY);
  return storedSignIn.parse(row?.value ?? {});
}

export async function getSignInMethods(): Promise<SignInMethods> {
  const [stored, smtp] = await Promise.all([readStored(), resolveSmtp()]);
  return resolveSignInMethods({ stored, emailConfigured: smtp !== null, env: env() });
}

export async function getSignInSettings(): Promise<SignInSettingsView> {
  const e = env();
  const [stored, smtp] = await Promise.all([readStored(), resolveSmtp()]);
  const base = e.PINWREN_URL.replace(/\/$/, "");
  return {
    magicLink: stored.magicLink ?? true,
    passkeys: stored.passkeys ?? true,
    emailConfigured: smtp !== null,
    providers: OAUTH_PROVIDERS.map((id) => ({
      id,
      name: PROVIDER_ENV[id].name,
      configured: providerConfigured(e, id),
      callbackUrl: `${base}/api/auth/callback/${id}`,
      envVars: [PROVIDER_ENV[id].id, PROVIDER_ENV[id].secret],
    })),
  };
}

export async function updateSignInSettings(
  patch: { magicLink?: boolean | undefined; passkeys?: boolean | undefined },
  userId: string,
): Promise<void> {
  const next: StoredSignIn = { ...(await readStored()) };
  if (patch.magicLink !== undefined) next.magicLink = patch.magicLink;
  if (patch.passkeys !== undefined) next.passkeys = patch.passkeys;
  await saveInstanceSetting({ key: SIGN_IN_SETTING_KEY, value: next, updatedBy: userId });
}
