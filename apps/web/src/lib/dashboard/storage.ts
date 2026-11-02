"use client";

import type { AppRole } from "@pinwren/core";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  defaultLayout,
  type Layout,
  normaliseLayout,
  sameLayout,
  type Scope,
  startsCollapsed,
} from "./catalog";

// A person's dashboard layouts are a per-browser preference, like the inbox view settings: one
// localStorage entry per user and screen (ADR 0024). Read through useSyncExternalStore so the server and
// the first client render agree (the role default) and the saved layout appears right after hydration.

const listeners = new Set<() => void>();
/** What could not be written (storage blocked): kept for this page view so edits still show. */
const memory = new Map<string, string>();

export const layoutKey = (userId: string, scope: Scope) => `pinwren.dashboard.v1.${userId}.${scope}`;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string | null) {
  if (value === null) memory.delete(key);
  else memory.set(key, value);
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked (private window): the in-memory copy keeps the edit for this page view.
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

/** The saved layout of one screen for one person, and how to change it. `saved` is false for the default. */
export function useDashboardLayout(userId: string | undefined, scope: Scope, role?: AppRole) {
  const key = userId ? layoutKey(userId, scope) : null;
  const raw = useSyncExternalStore(
    subscribe,
    () => (key ? read(key) : null),
    () => null,
  );
  const foldKey = key ? `${key}.collapsed` : null;
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
  const layout = useMemo(() => parseStored(raw, scope, role), [raw, scope, role]);
  const save = useCallback(
    (next: Layout) => {
      if (!key) return;
      // Back at the default? Forget the entry, so later changes to the defaults reach this person.
      write(key, sameLayout(next, defaultLayout(scope, role)) ? null : JSON.stringify(next));
    },
    [key, scope, role],
  );
  const reset = useCallback(() => {
    if (key) write(key, null);
  }, [key]);
  return { layout, save, reset, saved: raw !== null, collapsed, setCollapsed };
}
