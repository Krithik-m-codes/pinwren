import { combineSlices, configureStore } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
import { api } from "./api";
import type { StoreExtra } from "./api/base";
import { createListeners } from "./listeners";
import { inboxSlice } from "./slices/inbox";
import { realtimeSlice } from "./slices/realtime";
import { uiSlice } from "./slices/ui";

const rootReducer = combineSlices(api, inboxSlice, uiSlice, realtimeSlice);

export type RootState = ReturnType<typeof rootReducer>;

/**
 * A new store per request on the server and once per browser session on the client (App Router: a
 * module-level store would be shared by every request). `StoreProvider` calls it exactly once.
 */
export function makeStore(
  extra: Partial<StoreExtra> = {},
  preloadedState?: Partial<RootState>,
  { sideEffects = true }: { sideEffects?: boolean } = {},
) {
  const full: StoreExtra = { apiBase: extra.apiBase ?? "/api", eventSource: extra.eventSource };
  // The server-side store of a request only renders: no stream, heartbeats or storage, and creating the
  // listeners would draw random ids while the static shell is prerendered.
  const listeners = createListeners(full, sideEffects);
  const store = configureStore({
    reducer: rootReducer,
    ...(preloadedState ? { preloadedState } : {}),
    middleware: (getDefault) =>
      getDefault({ thunk: { extraArgument: full } })
        .prepend(listeners.middleware)
        .concat(api.middleware),
  });
  // refetchOnFocus / refetchOnReconnect, in the browser only.
  if (typeof window !== "undefined") setupListeners(store.dispatch);
  return store;
}

export type AppStore = ReturnType<typeof makeStore>;
export type AppDispatch = AppStore["dispatch"];
