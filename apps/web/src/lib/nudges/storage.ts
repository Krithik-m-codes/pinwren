"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useUiStateQuery, useUpdateUiStateMutation } from "@/lib/store/api/dashboards";
import { type NudgeState, parseNudgeState } from "./state";

// Dismissals follow the person to every browser: they live in `user_preference.ui_state` (ADR 0033, which
// replaces the per-browser choice of ADR 0025). The old localStorage entry is imported the first time the
// account has nothing yet, then kept as a cache so a slow or unreachable server still hides what was dismissed.

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
  if (read(key) === value) return;
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

const isEmpty = (s: NudgeState) =>
  s.firstSeen === null && s.dismissedUpdate === null && s.supportSnoozedUntil === null && !s.supportOptOut;

/**
 * The person's prompt state (the browser's copy on the server and until loaded), a patch function, and
 * `ready`: false until the account answered and the old browser copy, if any, has been imported, so nothing
 * writes a fresh "first seen" over it.
 */
export function useNudgeState(userId: string | undefined) {
  const key = userId ? nudgeKey(userId) : null;
  const local = useSyncExternalStore(
    subscribe,
    () => (key ? read(key) : null),
    () => null,
  );
  const query = useUiStateQuery(undefined, { skip: !userId });
  const [update] = useUpdateUiStateMutation();
  const server = query.data?.uiState.nudges;
  const localState = parseNudgeState(local);
  const importable = !!server && isEmpty(server) && !isEmpty(localState);

  useEffect(() => {
    if (!key || !server) return;
    if (importable) void update({ nudges: parseNudgeState(local) });
    else write(key, JSON.stringify(server)); // keep the browser copy current
  }, [key, server, importable, local, update]);

  const patch = useCallback(
    (next: Partial<NudgeState>) => {
      if (!key) return;
      write(key, JSON.stringify({ ...parseNudgeState(read(key)), ...next }));
      void update({ nudges: next });
    },
    [key, update],
  );
  const state: NudgeState = server && !importable ? server : localState;
  return { state, patch, ready: !!server && !importable };
}
