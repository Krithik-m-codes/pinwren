"use client";

import { useEffect, useState } from "react";
import { Provider } from "react-redux";
import { PREFS_KEY } from "./listeners";
import { prefsLoaded } from "./slices/inbox";
import { type AppStore, makeStore } from "./store";

function createBrowserStore(): AppStore {
  if (typeof window === "undefined") return makeStore({}, undefined, { sideEffects: false });
  return makeStore({ eventSource: (url) => new EventSource(url, { withCredentials: true }) });
}

/** One Redux store per browser session (and one per request during SSR), created on first render. */
export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState(createBrowserStore);

  // Per-device preferences load after hydration, so server and first client render agree.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      const saved = raw ? (JSON.parse(raw) as { density?: unknown }) : null;
      if (saved?.density === "compact" || saved?.density === "comfortable") {
        store.dispatch(prefsLoaded({ density: saved.density }));
      }
    } catch {
      // unreadable or blocked storage: defaults
    }
  }, [store]);

  return <Provider store={store}>{children}</Provider>;
}
