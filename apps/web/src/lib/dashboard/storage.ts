"use client";

import type { AppRole } from "@pinwren/core";
import { useCallback, useSyncExternalStore } from "react";
import { defaultLayout, type Layout, normaliseLayout, type Scope, startsCollapsed } from "./catalog";

// Browser-side copies of dashboard state (ADR 0037). The server owns the layouts now; this file keeps
//  - the pre-server layout (`pinwren.dashboard.v1.*`), read once to import it into the account, then removed;
//  - a cache of the last layout shown per screen (`pinwren.dashboard.v2.*`), so a slow or unreachable server
//    still shows the person's dashboard instead of the built-in one (the offline fallback);
//  - whether an overview strip is folded, which is a per-device choice.
// Read through useSyncExternalStore so the server and the first client render agree and the stored value
// appears right after hydration.

const listeners = new Set<() => void>();
/** What could not be written (storage blocked): kept for this page view so edits still show. */
const memory = new Map<string, string>();

export const layoutKey = (userId: string, scope: Scope) => `pinwren.dashboard.v1.${userId}.${scope}`;
export const cacheKey = (userId: string, scope: Scope) => `pinwren.dashboard.v2.${userId}.${scope}`;
const importedKey = (userId: string, scope: Scope) => `pinwren.dashboard.v2.${userId}.${scope}.imported`;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string | null) {
  // Nothing changed: do not wake subscribers (the layout cache is rewritten on every render of a dashboard).
  if (read(key) === value) return;
  memory.delete(key);
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked (private window): the in-memory copy keeps the edit for this page view.
    if (value !== null) memory.set(key, value);
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** Parse a stored value into a valid layout for the screen (the default for anything unreadable). */
export function parseStored(raw: string | null, scope: Scope, role?: AppRole): Layout {
  if (!raw) return defaultLayout(scope, role);
  try {
    return normaliseLayout(JSON.parse(raw) as unknown, scope, role);
  } catch {
    return defaultLayout(scope, role);
  }
}

/** The pre-server layout of a screen: present until it has been imported (or never customised). */
export function useLegacyLayout(userId: string | undefined, scope: Scope, role?: AppRole) {
  const key = userId ? layoutKey(userId, scope) : null;
  const raw = useSyncExternalStore(
    subscribe,
    () => (key ? read(key) : null),
    () => null,
  );
  const doneKey = userId ? importedKey(userId, scope) : null;
  const done = useSyncExternalStore(
    subscribe,
    () => (doneKey ? read(doneKey) : null),
    () => null,
  );
  /** Forget the old entry once the account has it (and never offer it again). */
  const retire = useCallback(() => {
    if (key) write(key, null);
    if (doneKey) write(doneKey, "1");
  }, [key, doneKey]);
  return {
    /** The old layout, or null when there is none or it was imported already. */
    layout: raw !== null && done === null ? parseStored(raw, scope, role) : null,
    retire,
  };
}

/** The last layout shown for a screen, and how to remember a new one. Null on the server and until hydrated. */
export function useLayoutCache(userId: string | undefined, scope: Scope, role?: AppRole) {
  const key = userId ? cacheKey(userId, scope) : null;
  const raw = useSyncExternalStore(
    subscribe,
    () => (key ? read(key) : null),
    () => null,
  );
  const remember = useCallback(
    (layout: Layout) => {
      if (key) write(key, JSON.stringify(layout));
    },
    [key],
  );
  return { cached: raw === null ? null : parseStored(raw, scope, role), remember };
}

/** Whether the overview strip of a screen is folded on this device. */
export function useCollapsed(userId: string | undefined, scope: Scope) {
  const foldKey = userId ? `${layoutKey(userId, scope)}.collapsed` : null;
  const fold = useSyncExternalStore(
    subscribe,
    () => (foldKey ? read(foldKey) : null),
    () => null,
  );
  const collapsed = fold === null ? startsCollapsed(scope) : fold === "1";
  const setCollapsed = useCallback(
    (next: boolean) => {
      if (foldKey) write(foldKey, next === startsCollapsed(scope) ? null : next ? "1" : "0");
    },
    [foldKey, scope],
  );
  return { collapsed, setCollapsed };
}
