import { guestPortalAccess, type GuestPortalAccess } from "@pinwren/core";

type GuestStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type GuestBrowser = {
  location: Pick<Location, "hash" | "pathname" | "search">;
  history: Pick<History, "state" | "replaceState">;
  storage?: GuestStorage | undefined;
};
const storageKey = (projectKey: string) => `pinwren:guest:${projectKey}`;

function parseAccess(raw: string): GuestPortalAccess | null {
  try {
    const parsed = guestPortalAccess.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.reporterTokens.length + parsed.data.pageTokens.length > 0
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}

/** Storage can be blocked independently of access to the page itself. */
export function guestBrowser(): GuestBrowser {
  let storage: GuestStorage | undefined;
  try {
    storage = window.localStorage;
  } catch {
    /* Use the fragment for this visit. */
  }
  return { location: window.location, history: window.history, storage };
}

/** Remove credentials before parsing or touching storage, including malformed fragments. */
export function readGuestAccess(projectKey: string, browser: GuestBrowser): GuestPortalAccess | null {
  const { location, history, storage } = browser;
  if (location.hash) {
    const fragment = location.hash;
    history.replaceState(history.state, "", location.pathname + location.search);
    let access: GuestPortalAccess | null = null;
    try {
      if (fragment.startsWith("#access=")) access = parseAccess(decodeURIComponent(fragment.slice(8)));
    } catch {
      /* A malformed capability must not fall back to previous access. */
    }
    if (access) {
      try {
        storage?.setItem(storageKey(projectKey), JSON.stringify(access));
      } catch {
        /* Session access remains usable. */
      }
    } else {
      forgetGuestAccess(projectKey, storage);
    }
    return access;
  }
  try {
    const raw = storage?.getItem(storageKey(projectKey));
    const access = raw ? parseAccess(raw) : null;
    if (raw && !access) forgetGuestAccess(projectKey, storage);
    return access;
  } catch {
    return null;
  }
}

export function forgetGuestAccess(projectKey: string, storage?: GuestStorage): void {
  try {
    storage?.removeItem(storageKey(projectKey));
  } catch {
    /* Forget the in-memory access even if storage is blocked. */
  }
}
