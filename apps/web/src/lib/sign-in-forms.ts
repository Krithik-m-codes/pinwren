import { z } from "zod";

// Sign-in methods besides the password (wave 5): the email-link form, naming a passkey, and the words
// for the `?error=` codes Better Auth puts on the sign-in page when Google / GitHub or an email link
// fails.

export const magicLinkForm = z.object({ email: z.email("Enter a valid email address").max(254) });

export const passkeyNameForm = z.object({
  name: z.string().trim().min(1, "Name the passkey").max(60, "Use at most 60 characters"),
});

export const PROVIDER_NAMES = { google: "Google", github: "GitHub" } as const;

/** The name of a sign-in method as Better Auth stores it (`account.providerId`). */
export function providerName(providerId: string): string {
  if (providerId === "credential") return "Password";
  return providerId in PROVIDER_NAMES
    ? PROVIDER_NAMES[providerId as keyof typeof PROVIDER_NAMES]
    : providerId;
}

/**
 * What a sign-in `?error=` code means, in words. Better Auth's OAuth callback and email-link verify
 * redirect with these; our user-create hook adds `SIGNUP_CLOSED`. Unknown codes get a generic line.
 */
export function signInErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  switch (code) {
    case "SIGNUP_CLOSED":
    case "signup_disabled":
    case "new_user_signup_disabled":
      return "There's no account for that address, and accounts on this server are by invitation. Ask an administrator to add or invite you.";
    case "account_not_linked":
      return "An account with that email already exists. Sign in with your password (or an email link), then connect it in Settings › Profile.";
    case "account_already_linked_to_different_user":
      return "That account is already connected to another Pinwren user.";
    case "email_doesn't_match":
    case "email_does_not_match":
      return "That account's email doesn't match yours.";
    case "email_not_found":
      return "The provider didn't share an email address. Make one visible (or verified) there and try again.";
    case "email_not_verified":
      return "The provider hasn't verified that email address yet.";
    case "INVALID_TOKEN":
    case "EXPIRED_TOKEN":
    case "invalid_token":
      return "That sign-in link has expired or was already used. Ask for a new one.";
    case "access_denied":
      return "Sign-in was cancelled.";
    case "state_mismatch":
    case "please_restart_the_process":
      return "That sign-in took too long or started in another tab. Try again.";
    default:
      return "Couldn't sign you in that way. Try again, or use your password.";
  }
}
