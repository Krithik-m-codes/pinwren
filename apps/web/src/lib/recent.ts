"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * Recently opened feedback items, newest first, per user and per browser (like the dashboard layouts —
 * ADR 0025): the command palette lists them so "that bug from yesterday" is two keystrokes away.
 * Only the number, title and project name are kept; the status and the rest are looked up live.
 */
export type RecentItem = { id: string; number: number; title: string; project: string };

export const MAX_RECENT = 8;
const MAX_TITLE = 200;

export const recentKey = (userId: string) => `pinwren.recent.v1.${userId}`;

export function parseRecent(raw: string | null): RecentItem[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const out: RecentItem[] = [];
    for (const e of v as unknown[]) {
      if (typeof e !== "object" || e === null) continue;
      const r = e as Record<string, unknown>;
      if (
        typeof r.id === "string" &&
        typeof r.number === "number" &&
        typeof r.title === "string" &&
        typeof r.project === "string" &&
        !out.some((o) => o.id === r.id)
      ) {
        out.push({ id: r.id, number: r.number, title: r.title, project: r.project });
      }
    }
    return out.slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

/** `item` moves to the front; a repeat visit never duplicates it. */
export function withRecent(list: RecentItem[], item: RecentItem): RecentItem[] {
  const clean = { ...item, title: item.title.slice(0, MAX_TITLE) };
  return [clean, ...list.filter((r) => r.id !== item.id)].slice(0, MAX_RECENT);
}

const listeners = new Set<() => void>();
/** What could not be written (storage blocked): kept for this page view. */
const memory = new Map<string, string>();

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
    // Storage blocked (private window): the in-memory copy lasts for this page view.
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
  };
}

/** The signed-in user's recent items, and a function to record one. Empty on the server and first render. */
export function useRecentItems(userId: string | undefined) {
  const key = userId ? recentKey(userId) : null;
  const raw = useSyncExternalStore(
    subscribe,
    () => (key ? read(key) : null),
    () => null,
  );
  const items = useMemo(() => parseRecent(raw), [raw]);
  const record = useCallback(
    (item: RecentItem) => {
      if (!key) return;
      const next = withRecent(parseRecent(read(key)), item);
      write(key, JSON.stringify(next));
    },
    [key],
  );
  return { items, record };
}
