import { toast } from "sonner";
import { translateNow } from "@/lib/i18n/provider";
import { safeNext } from "@/lib/next-path";

// A signed-in screen whose API answers 401 has lost its session (expired, signed out elsewhere, idle too
// long). Say so once, then send the person to sign in and bring them back to the same page (`?next=`).

/** Screens that need a session; guest and share pages answer 401 for other reasons. */
const APP_SCREEN = /^\/(inbox|projects|settings|dashboard|notifications)(\/|$)/;
export const SESSION_EXPIRED_TEXT = "Your session expired. Sign in again to continue.";
const REDIRECT_AFTER_MS = 1800;

let pending = false;

/** Where sign-in should send the person afterwards: the current screen, or null when it needs no session. */
export function returnPathFor(location: Pick<Location, "pathname" | "search" | "hash">): string | null {
  if (!APP_SCREEN.test(location.pathname)) return null;
  return safeNext(`${location.pathname}${location.search}${location.hash}`, "") || null;
}

export function sessionExpired(
  location: Location = window.location,
  go: (url: string) => void = (url) => window.location.assign(url),
) {
  if (pending) return;
  const next = returnPathFor(location);
  if (next === null) return;
  pending = true;
  toast.error(translateNow(SESSION_EXPIRED_TEXT), { duration: REDIRECT_AFTER_MS + 1000 });
  window.setTimeout(() => go(`/sign-in?next=${encodeURIComponent(next)}`), REDIRECT_AFTER_MS);
}

/** Tests only. */
export const resetSessionExpiry = () => {
  pending = false;
};
