"use client";
// @pinwren/react — the Pinwren widget as a React component and hook (blueprint 05 §1).
//
// <Pinwren> renders nothing: in an effect it adds `<endpoint>/widget.js` (the widget your Pinwren server
// ships) and initialises it, and on unmount it calls `destroy()`. Nothing touches `window` during render, so
// it is safe in server components' trees, Next.js App Router layouts and any SSR setup; the `"use client"`
// directive marks the client boundary.
import {
  close,
  destroy,
  type EventMap,
  type Handler,
  identify,
  type IdentifyOptions,
  init,
  type Mode,
  on,
  open,
  type PageScope,
  type PinwrenOptions,
  type PinwrenUser,
  setPageScope,
  type WidgetEvent,
} from "@pinwren/widget";
import { useEffect, useRef, useSyncExternalStore } from "react";

export type { EventMap, IdentifyOptions, Mode, PageScope, PinwrenOptions, PinwrenUser, WidgetEvent };

export type PinwrenProps = PinwrenOptions & {
  /** CSP nonce for the widget's scripts. */
  nonce?: string | undefined;
  /** The signed-in user of your app; pre-fills the reporter and, with `userSignature`, verifies them. */
  user?: PinwrenUser | null | undefined;
  /** Hex HMAC-SHA256 of `user.id` with the project's identity secret — compute it on your server. */
  userSignature?: string | undefined;
  onReady?: (() => void) | undefined;
  onOpen?: ((data: EventMap["open"]) => void) | undefined;
  onClose?: (() => void) | undefined;
  onSubmit?: ((data: EventMap["submit"]) => void) | undefined;
  onError?: ((data: EventMap["error"]) => void) | undefined;
};

// --- `ready` as an external store, so usePinwren() can re-render on it -------------------------------

let ready = false;
const listeners = new Set<() => void>();
const setReady = (v: boolean) => {
  if (ready === v) return;
  ready = v;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const getReady = () => ready;
const getServerReady = () => false;

type Callbacks = Pick<PinwrenProps, "onReady" | "onOpen" | "onClose" | "onSubmit" | "onError">;

/**
 * Mounts the Pinwren widget. Changing `projectKey`, `endpoint`, `accent`, `locale`, `forceShow`, `nonce` or
 * `allowReplayInPrivacyMode` re-creates it; `user`, `userSignature` and `urlPattern` update it in place.
 */
export function Pinwren(props: PinwrenProps): null {
  const {
    projectKey,
    endpoint,
    accent,
    locale,
    forceShow,
    allowReplayInPrivacyMode,
    nonce,
    urlPattern,
    user,
    userSignature,
  } = props;
  const userId = user?.id;
  const userName = user?.name;
  const userEmail = user?.email;

  // The latest callbacks, without re-subscribing when a parent passes new functions each render.
  const callbacks = useRef<Callbacks>({});
  useEffect(() => {
    callbacks.current = {
      onReady: props.onReady,
      onOpen: props.onOpen,
      onClose: props.onClose,
      onSubmit: props.onSubmit,
      onError: props.onError,
    };
  });

  useEffect(() => {
    const offs = [
      on("ready", () => {
        setReady(true);
        callbacks.current.onReady?.();
      }),
      on("open", (d) => callbacks.current.onOpen?.(d)),
      on("close", () => callbacks.current.onClose?.()),
      on("submit", (d) => callbacks.current.onSubmit?.(d)),
      on("error", (d) => callbacks.current.onError?.(d)),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, []);

  // Scope and identity are set before init in the same commit (effects run in order), so the widget
  // starts with them rather than re-fetching.
  useEffect(() => {
    setPageScope(urlPattern ? { urlPattern } : null);
  }, [urlPattern]);

  useEffect(() => {
    const who = userId || userName || userEmail ? { id: userId, name: userName, email: userEmail } : null;
    identify(who, userSignature ? { signature: userSignature } : undefined);
  }, [userId, userName, userEmail, userSignature]);

  useEffect(() => {
    init({ projectKey, endpoint, accent, locale, forceShow, allowReplayInPrivacyMode, nonce });
    return () => {
      setReady(false);
      destroy();
    };
  }, [projectKey, endpoint, accent, locale, forceShow, allowReplayInPrivacyMode, nonce]);

  return null;
}

export type PinwrenControls = {
  /** True once the widget has loaded its configuration and shows on the page. */
  ready: boolean;
  /** Open the menu, or `"comment"`, `"bug"` or `"panel"` directly. */
  open: (mode?: Mode) => void;
  close: () => void;
  identify: (user: PinwrenUser | null, options?: IdentifyOptions) => void;
  setPageScope: (scope: PageScope | null) => void;
  /** Listen to a widget event; returns the unsubscribe function (call it in your effect's cleanup). */
  on: <E extends WidgetEvent>(event: E, handler: Handler<E>) => () => void;
};

const controls = { open, close, identify, setPageScope, on };

/** Control the widget from any component (works before it has loaded: calls are queued). */
export function usePinwren(): PinwrenControls {
  const isReady = useSyncExternalStore(subscribe, getReady, getServerReady);
  return { ready: isReady, ...controls };
}
