"use client";

import { useState } from "react";
import { api, type HydrationEntries } from "./api";
import { useAppStore } from "./hooks";

/**
 * Seeds RTK Query with data a server component already fetched, before the client components below it
 * subscribe — so they render with it and don't fetch it again. Runs once per mount (key the element by
 * the arguments to seed again). This is the "initialise the store from server data" pattern the Redux
 * docs give for the App Router: the dispatch happens while rendering, before any subscriber below exists.
 */
export function HydrateQueries({
  entries,
  children,
}: {
  entries: HydrationEntries;
  children: React.ReactNode;
}) {
  const store = useAppStore();
  useState(() => {
    // See `HydrationEntries`: RTK can't type a mixed list once an infinite query exists.
    if (entries.length) store.dispatch(api.util.upsertQueryEntries(entries as never));
    return true;
  });
  return children;
}
