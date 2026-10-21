import { type Dispatch, type SetStateAction, useState, useSyncExternalStore } from "react";

/**
 * Local, editable state that starts from `source` and resets to it whenever `key` changes (by default when
 * `source` itself changes) — e.g. a form draft that follows the saved value. It uses React's "adjust state
 * while rendering" pattern rather than an effect, so no frame ever shows the stale value:
 * https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
 */
export function useSyncedState<T>(source: T, key: unknown = source): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState(source);
  const [syncedKey, setSyncedKey] = useState(key);
  if (!Object.is(syncedKey, key)) {
    setSyncedKey(key);
    setState(source);
  }
  return [state, setState];
}

const subscribeNever = () => () => {
  // nothing to unsubscribe: the value never changes after hydration
};

/** False during SSR and hydration, true afterwards — for UI that depends on client-only state (theme). */
export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}
