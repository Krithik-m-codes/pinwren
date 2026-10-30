import type { EmailSettingsUpdate } from "@pinwren/core";
import { readInstanceSetting, saveInstanceSetting } from "../db/system";
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
  requireTls?: boolean | null;
  allowSelfSigned?: boolean | null;
};

export type SmtpConfig = {
  host: string;
  port: number;
  user: string | undefined;
  password: string | undefined;
  secure: boolean;
  from: string;
  /** STARTTLS is mandatory (nodemailer `requireTLS`). */
  requireTls: boolean;
  /** Accept an unverifiable certificate (nodemailer `tls.rejectUnauthorized: false`). */
  allowSelfSigned: boolean;
};

export type EmailSettingsView = {
  host: string | null;
  port: number | null;
  user: string | null;
  secure: boolean;
  from: string | null;
  requireTls: boolean;
  allowSelfSigned: boolean;
  passwordSet: boolean;
  /** Fields set by environment variables; the UI shows them read-only. */
  locked: {
    host: boolean;
    port: boolean;
    user: boolean;
    password: boolean;
    secure: boolean;
    from: boolean;
    requireTls: boolean;
    allowSelfSigned: boolean;
  };
  configured: boolean;
};

async function readStored(): Promise<{ value: Stored; secret: string | null }> {
  const row = await readInstanceSetting(EMAIL_SETTING_KEY);
  return { value: row?.value ?? {}, secret: row?.secret ?? null };
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
    requireTls: e.SMTP_REQUIRE_TLS !== undefined,
    allowSelfSigned: e.SMTP_TLS_REJECT_UNAUTHORIZED !== undefined,
  };
}

/** Env wins over the stored value; `SMTP_TLS_REJECT_UNAUTHORIZED=false` means "allow self-signed". */
function tlsOptions(value: Stored): { requireTls: boolean; allowSelfSigned: boolean } {
  const e = env();
  const reject = e.SMTP_TLS_REJECT_UNAUTHORIZED;
  return {
    requireTls: e.SMTP_REQUIRE_TLS ?? value.requireTls ?? false,
    allowSelfSigned: reject !== undefined ? !reject : (value.allowSelfSigned ?? false),
  };
}

/**
 * The effective SMTP configuration, or null when email is not set up (sends are then skipped). `draft`:
 * unsaved form values (Settings › Email › Test) laid over the saved ones; env-locked fields still win, and
 * an omitted password means the saved one.
 */
export async function resolveSmtp(draft?: EmailSettingsUpdate): Promise<SmtpConfig | null> {
  const e = env();
  const saved = await readStored();
  const value: Stored = { ...saved.value };
  if (draft) {
    for (const k of ["host", "port", "user", "secure", "from", "requireTls", "allowSelfSigned"] as const) {
      if (draft[k] !== undefined) (value as Record<string, unknown>)[k] = draft[k];
    }
  }
  const host = e.SMTP_HOST ?? (value.host || undefined);
  const from = e.EMAIL_FROM ?? (value.from || undefined);
  if (!host || !from) return null;
  const secure = e.SMTP_SECURE ?? value.secure ?? false;
  let password = e.SMTP_PASSWORD;
  if (password === undefined && draft?.password !== undefined) password = draft.password ?? undefined;
  else if (password === undefined && saved.secret) {
    try {
      password = decryptSecret(saved.secret);
    } catch {
      console.warn("[pinwren] stored SMTP password cannot be decrypted (PINWREN_SECRET changed?)");
    }
  }
  return {
    host,
    port: e.SMTP_PORT ?? value.port ?? (secure ? 465 : 587),
    user: e.SMTP_USER ?? (value.user || undefined),
    password,
    secure,
    from,
    ...tlsOptions(value),
  };
}

/** A usable From header: `address@domain` or `Name <address@domain>` (one address, no line breaks). */
export function isValidFrom(from: string): boolean {
  const t = from.trim();
  if (!t || t.length > 320 || /[\r\n]/.test(from)) return false;
  const addr = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;
  const named = /^(?:"[^"\r\n]*"|[^<>"\r\n,;]+?)\s*<([^<>]+)>$/.exec(t);
  return named ? addr.test(named[1] ?? "") : addr.test(t);
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
    ...tlsOptions(value),
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
  for (const k of ["host", "port", "user", "secure", "from", "requireTls", "allowSelfSigned"] as const) {
    if (patch[k] !== undefined) (next as Record<string, unknown>)[k] = patch[k];
  }
  let nextSecret = secret;
  if (patch.password === null) nextSecret = null;
  else if (typeof patch.password === "string") nextSecret = encryptSecret(patch.password);

  await saveInstanceSetting({ key: EMAIL_SETTING_KEY, value: next, secret: nextSecret, updatedBy: userId });
  return [];
}
