import { SHARE_TOKEN_RE } from "@pinwren/core";

// The credential of a share link lives in the URL fragment (`#t=<token>`), which no server ever sees. It is read
// once, the fragment is removed from the address bar, and the token is kept for this tab only (sessionStorage),
// together with the unlock proof once a password has been entered.

export type ShareAccess = { token: string; unlock?: string | undefined };

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Browser = {
  location: Pick<Location, "hash" | "pathname" | "search">;
  history: Pick<History, "state" | "replaceState">;
  storage?: Store | undefined;
};
const storageKey = (projectKey: string) => `pinwren:share:${projectKey}`;

export function parseShareAccess(raw: string): ShareAccess | null {
  try {
    const v = JSON.parse(raw) as { token?: unknown; unlock?: unknown };
    if (typeof v.token !== "string" || !SHARE_TOKEN_RE.test(v.token)) return null;
    return { token: v.token, ...(typeof v.unlock === "string" ? { unlock: v.unlock } : {}) };
  } catch {
    return null;
  }
}

export function shareBrowser(): Browser {
  let storage: Store | undefined;
  try {
    storage = window.sessionStorage;
  } catch {
    /* Blocked storage: the link works for this visit only. */
  }
  return { location: window.location, history: window.history, storage };
}

/** The token of the fragment (which is then removed), else the one this tab already holds. */
export function readShareAccess(projectKey: string, browser: Browser): ShareAccess | null {
  const { location, history, storage } = browser;
  if (location.hash) {
    const fragment = location.hash;
    history.replaceState(history.state, "", location.pathname + location.search);
    const token = fragment.startsWith("#t=") ? fragment.slice(3) : "";
    if (SHARE_TOKEN_RE.test(token)) {
      const access: ShareAccess = { token };
      saveShareAccess(projectKey, access, storage);
      return access;
    }
    forgetShareAccess(projectKey, storage);
    return null;
  }
  try {
    const raw = storage?.getItem(storageKey(projectKey));
    const access = raw ? parseShareAccess(raw) : null;
    if (raw && !access) forgetShareAccess(projectKey, storage);
    return access;
  } catch {
    return null;
  }
}

export function saveShareAccess(projectKey: string, access: ShareAccess, storage?: Store): void {
  try {
    storage?.setItem(storageKey(projectKey), JSON.stringify(access));
  } catch {
    /* Kept in memory for this visit. */
  }
}

export function forgetShareAccess(projectKey: string, storage?: Store): void {
  try {
    storage?.removeItem(storageKey(projectKey));
  } catch {
    /* Nothing to forget. */
  }
}
