import { member, organization, setting, user } from "@pinwren/db";
import { identityDatabase } from "@pinwren/db/identity";
import { asc, eq } from "drizzle-orm";
import { env } from "./env";
import { consume } from "./rate-limit";

// Cloud sign-up (design 2026-10-31): what stands between a stranger and a new account, and the personal
// workspace each account starts with. Self-host never reaches this file.

/** Whether strangers may create accounts: the kill switch (PINWREN_CLOUD_SIGNUPS, default closed). */
export const cloudSignupsOpen = (e: { PINWREN_CLOUD_SIGNUPS?: "open" | "closed" | undefined } = env()) =>
  e.PINWREN_CLOUD_SIGNUPS === "open";

/** Throwaway-mailbox providers. A suffix match, so `x.mailinator.com` counts and `notmailinator.com` doesn't. */
const DISPOSABLE_DOMAINS = [
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "sharklasers.com",
  "grr.la",
  "10minutemail.com",
  "10minutemail.net",
  "tempmail.com",
  "temp-mail.org",
  "temp-mail.io",
  "tempmailo.com",
  "throwawaymail.com",
  "yopmail.com",
  "yopmail.net",
  "getnada.com",
  "nada.email",
  "maildrop.cc",
  "trashmail.com",
  "trashmail.net",
  "dispostable.com",
  "fakeinbox.com",
  "mintemail.com",
  "mohmal.com",
  "emailondeck.com",
  "burnermail.io",
  "spamgourmet.com",
  "mailnesia.com",
  "mytemp.email",
  "moakt.com",
] as const;

export function isDisposableEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 1) return false;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  return DISPOSABLE_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

export type SignupRefusal = { code: string; message: string; status: "BAD_REQUEST" | "TOO_MANY_REQUESTS" };

/**
 * The Cloud checks for `POST /sign-up/email`, run before any account exists. The address and the
 * instance-wide counter give the same answer, so a refusal says nothing about which limit fired.
 */
export async function cloudSignupRefusal(o: {
  email: string;
  termsAccepted: unknown;
  /** The trusted client address derived by the API (never a raw header). */
  ip: string | undefined;
}): Promise<SignupRefusal | null> {
  if (o.termsAccepted !== true) {
    return {
      status: "BAD_REQUEST",
      code: "TERMS_REQUIRED",
      message: "Accept the Terms of Service and Privacy Policy to create an account.",
    };
  }
  if (isDisposableEmail(o.email)) {
    return {
      status: "BAD_REQUEST",
      code: "DISPOSABLE_EMAIL",
      message: "Use a permanent work or personal email address, not a disposable one.",
    };
  }
  const e = env();
  const limited: SignupRefusal = {
    status: "TOO_MANY_REQUESTS",
    code: "SIGNUP_RATE_LIMITED",
    message: "Too many accounts were created recently. Try again later.",
  };
  if (!(await consume(`signup:ip:${o.ip ?? "unknown"}`, e.PINWREN_CLOUD_SIGNUPS_PER_IP_HOUR, 3600))) {
    return limited;
  }
  if (!(await consume("signup:all", e.PINWREN_CLOUD_SIGNUPS_PER_HOUR, 3600))) return limited;
  return null;
}

const slugOf = (name: string, userId: string) =>
  `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 30) || "workspace"
  }-${userId.replaceAll("-", "").slice(0, 8)}`;

/**
 * The workspace every Cloud account starts with: an organisation and the owner membership, inserted in one
 * transaction on the identity connection. Free is the absence of a billing row, so nothing else is written.
 * Idempotent: an account that already belongs to a workspace is left alone. Returns the workspace id.
 */
export async function provisionPersonalWorkspace(userId: string, displayName: string): Promise<string> {
  return identityDatabase().transaction(async (tx) => {
    const [existing] = await tx
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, userId))
      .orderBy(asc(member.createdAt), asc(member.id))
      .limit(1);
    if (existing) return existing.organizationId;
    const name = displayName.trim() ? `${displayName.trim()}'s workspace` : "My workspace";
    const id = crypto.randomUUID();
    await tx.insert(organization).values({ id, name: name.slice(0, 120), slug: slugOf(displayName, id) });
    await tx.insert(member).values({ id: crypto.randomUUID(), organizationId: id, userId, role: "owner" });
    return id;
  });
}

/** Evidence of consent: when, and which pages the person was shown. A system setting, no identity schema change. */
export async function recordConsent(userId: string): Promise<void> {
  const e = env();
  const value = {
    acceptedAt: new Date().toISOString(),
    termsUrl: e.PINWREN_TERMS_URL,
    privacyUrl: e.PINWREN_PRIVACY_URL,
  };
  await identityDatabase()
    .insert(setting)
    .values({ key: `consent.${userId}`, value, updatedBy: userId })
    .onConflictDoNothing();
}

/** Removes an account whose workspace could not be created, so a failed sign-up leaves nothing behind. */
export async function discardUser(userId: string): Promise<void> {
  await identityDatabase().delete(user).where(eq(user.id, userId));
}
