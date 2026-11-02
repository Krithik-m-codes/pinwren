"use client";

import { useCallback, useSyncExternalStore } from "react";
import { type NudgeState, parseNudgeState } from "./state";

// Dismissals are a per-browser preference, one localStorage entry per user, like the dashboard layouts
// (ADR 0024) and the setup checklist. ADR 0025 records why this is not a database column.

const listeners = new Set<() => void>();
/** What could not be written (storage blocked): kept for this page view so a dismissal still hides the strip. */
const memory = new Map<string, string>();

export const nudgeKey = (userId: string) => `pinwren.nudges.v1.${userId}`;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string) {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked (private window): the in-memory copy covers this page view.
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

/** The person's prompt state (empty on the server and until hydrated) and a patch function. */
export function useNudgeState(userId: string | undefined) {
  const key = userId ? nudgeKey(userId) : null;
  const raw = useSyncExternalStore(
    subscribe,
    () => (key ? read(key) : null),
    () => null,
  );
  const patch = useCallback(
    (next: Partial<NudgeState>) => {
      if (key) write(key, JSON.stringify({ ...parseNudgeState(read(key)), ...next }));
    },
    [key],
  );
  return { state: parseNudgeState(raw), patch };
}
