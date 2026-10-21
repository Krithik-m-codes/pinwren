import type { EmailSettingsUpdate } from "@pinwren/core";
import { getDb, setting } from "@pinwren/db";
import { eq } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "../crypto";
import { env } from "../env";

// SMTP settings: stored in the `setting` table (admin UI), each field overridden and locked by its
// environment variable (CLAUDE.md: env overrides and locks). The password is encrypted at rest and
// never leaves the server.

export const EMAIL_SETTING_KEY = "email";

type Stored = {
  host?: string | null;
  port?: number | null;
  user?: string | null;
  secure?: boolean | null;
  from?: string | null;
};

export type SmtpConfig = {
  host: string;
  port: number;
  user: string | undefined;
  password: string | undefined;
  secure: boolean;
  from: string;
};

export type EmailSettingsView = {
  host: string | null;
  port: number | null;
  user: string | null;
  secure: boolean;
  from: string | null;
  passwordSet: boolean;
  /** Fields set by environment variables; the UI shows them read-only. */
  locked: { host: boolean; port: boolean; user: boolean; password: boolean; secure: boolean; from: boolean };
  configured: boolean;
};

async function readStored(): Promise<{ value: Stored; secret: string | null }> {
  const [row] = await getDb().select().from(setting).where(eq(setting.key, EMAIL_SETTING_KEY));
  return { value: (row?.value ?? {}) as Stored, secret: row?.secret ?? null };
}

function lockedFields() {
  const e = env();
  return {
    host: e.SMTP_HOST !== undefined,
    port: e.SMTP_PORT !== undefined,
    user: e.SMTP_USER !== undefined,
    password: e.SMTP_PASSWORD !== undefined,
    secure: e.SMTP_SECURE !== undefined,
    from: e.EMAIL_FROM !== undefined,
  };
}

/** The effective SMTP configuration, or null when email is not set up (sends are then skipped). */
export async function resolveSmtp(): Promise<SmtpConfig | null> {
  const e = env();
  const { value, secret } = await readStored();
  const host = e.SMTP_HOST ?? value.host ?? undefined;
  const from = e.EMAIL_FROM ?? value.from ?? undefined;
  if (!host || !from) return null;
  const secure = e.SMTP_SECURE ?? value.secure ?? false;
  let password = e.SMTP_PASSWORD;
  if (password === undefined && secret) {
    try {
      password = decryptSecret(secret);
    } catch {
      console.warn("[pinwren] stored SMTP password cannot be decrypted (PINWREN_SECRET changed?)");
    }
  }
  return {
    host,
    port: e.SMTP_PORT ?? value.port ?? (secure ? 465 : 587),
    user: e.SMTP_USER ?? value.user ?? undefined,
    password,
    secure,
    from,
  };
}

export async function getEmailSettings(): Promise<EmailSettingsView> {
  const e = env();
  const { value, secret } = await readStored();
  const effective = await resolveSmtp();
  return {
    host: e.SMTP_HOST ?? value.host ?? null,
    port: e.SMTP_PORT ?? value.port ?? null,
    user: e.SMTP_USER ?? value.user ?? null,
    secure: e.SMTP_SECURE ?? value.secure ?? false,
    from: e.EMAIL_FROM ?? value.from ?? null,
    passwordSet: e.SMTP_PASSWORD !== undefined || secret !== null,
    locked: lockedFields(),
    configured: effective !== null,
  };
}

/** Apply an admin update. Fields locked by env are rejected so the UI can't silently diverge. */
export async function updateEmailSettings(patch: EmailSettingsUpdate, userId: string): Promise<string[]> {
  const locked = lockedFields();
  const rejected = (Object.keys(patch) as (keyof EmailSettingsUpdate)[]).filter(
    (k) => patch[k] !== undefined && locked[k],
  );
  if (rejected.length) return rejected;

  const { value, secret } = await readStored();
  const next: Stored = { ...value };
  for (const k of ["host", "port", "user", "secure", "from"] as const) {
    if (patch[k] !== undefined) (next as Record<string, unknown>)[k] = patch[k];
  }
  let nextSecret = secret;
  if (patch.password === null) nextSecret = null;
  else if (typeof patch.password === "string") nextSecret = encryptSecret(patch.password);

  await getDb()
    .insert(setting)
    .values({ key: EMAIL_SETTING_KEY, value: next, secret: nextSecret, updatedBy: userId })
    .onConflictDoUpdate({
      target: setting.key,
      set: { value: next, secret: nextSecret, updatedBy: userId, updatedAt: new Date() },
    });
  return [];
}
