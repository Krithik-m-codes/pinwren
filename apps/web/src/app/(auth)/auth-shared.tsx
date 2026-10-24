"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { SetupStatus } from "@/lib/api";
import { safeNext } from "@/lib/next-path";
import type { SignInMethods } from "@/lib/store/api/sign-in";

// Shared by the sign-in screens. They are prerendered, so anything from the URL or the server is read
// after hydration (the query string, `GET /api/setup`).

const subscribeNever = () => () => {
  // the query string of these pages never changes without a navigation
};

/** One query-string parameter, after hydration (null while prerendering and hydrating). */
export function useSearchParam(name: string): string | null {
  return useSyncExternalStore(
    subscribeNever,
    () => new URLSearchParams(window.location.search).get(name),
    () => null,
  );
}

/** False while prerendering and hydrating, true in the browser afterwards. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

const publicGets = new Map<string, { at: number; body: Promise<unknown> }>();

/**
 * A public `GET /api…` for these prerendered pages, sent after hydration. Not RTK Query: its hooks read the
 * clock while rendering (even skipped), which Next refuses during a prerender. Answers are shared between
 * the screens of one visit for 30 s.
 */
function usePublicGet(path: string): { data: unknown; isLoading: boolean } {
  const hydrated = useHydrated();
  const [state, setState] = useState<{ path: string; data: unknown } | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    let live = true;
    let hit = publicGets.get(path);
    if (!hit || performance.now() - hit.at > 30_000) {
      hit = {
        at: performance.now(),
        body: fetch(`/api${path}`, { credentials: "same-origin" })
          .then((r) => (r.ok ? (r.json() as Promise<unknown>) : undefined))
          .catch(() => undefined),
      };
      publicGets.set(path, hit);
    }
    void hit.body.then((data) => {
      if (live) setState({ path, data });
    });
    return () => {
      live = false;
    };
  }, [hydrated, path]);
  const done = state?.path === path;
  return { data: done ? state.data : undefined, isLoading: !done };
}

/** `GET /api/setup`: is this a fresh server, is sign-up open, is email set up (undefined until loaded). */
export function useSetupStatus(): { data: SetupStatus | undefined; isLoading: boolean } {
  const r = usePublicGet("/setup");
  return { ...r, data: r.data as SetupStatus | undefined };
}

/** `GET /api/sign-in-methods`: the sign-in options this server offers besides the password. */
export function useSignInMethods(): { data: SignInMethods | undefined; isLoading: boolean } {
  const r = usePublicGet("/sign-in-methods");
  // The answer is `{ methods: … }`.
  return { ...r, data: (r.data as { methods?: SignInMethods } | undefined)?.methods };
}

/** Where to go after signing in: `?next=` when it is a path on this site, else the inbox. */
export function useNextPath(): string {
  return safeNext(useSearchParam("next"));
}

/** The raw `?next=` value, to carry between the auth pages. */
export const useNextParam = () => useSearchParam("next");

export const linkClass = "font-medium text-foreground underline-offset-4 hover:underline";

/** Whether an auth error is the browser origin not matching PINWREN_URL (Better Auth or our CSRF guard). */
export const isOriginError = (message: string | undefined) => !!message && /origin|cross-site/i.test(message);

/**
 * The page is open on another address than PINWREN_URL: sign-in would fail with an origin error, so say
 * where the server expects to be reached before anyone types a password.
 */
export function OriginHint() {
  const { data } = useSetupStatus();
  const here = useSyncExternalStore(
    subscribeNever,
    () => window.location.origin,
    () => "",
  );
  if (!data || !here || data.appUrl === here) return null;
  return (
    <div
      role="status"
      data-testid="origin-hint"
      className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0 text-pretty">
        This server is set up for{" "}
        <a href={data.appUrl} className="font-medium underline underline-offset-4">
          {data.appUrl}
        </a>
        . Open it there, or change <code className="font-mono text-xs">PINWREN_URL</code> in the server&apos;s
        environment to this address.
      </p>
    </div>
  );
}
