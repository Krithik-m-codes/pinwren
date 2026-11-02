import type { Route } from "next";

/**
 * Which screen `/` opens. A per-device choice (Settings › Profile › Appearance), kept in a cookie rather
 * than localStorage because the redirect from `/` happens on the server. Nothing sensitive: it only names
 * one of the three routes below.
 */
export const LANDINGS = ["inbox", "dashboard", "my-work"] as const;
export type Landing = (typeof LANDINGS)[number];
export const DEFAULT_LANDING: Landing = "inbox";
export const LANDING_COOKIE = "pinwren_landing";

const PATHS: Record<Landing, Route> = {
  inbox: "/inbox",
  dashboard: "/dashboard",
  "my-work": "/inbox?assignee=me",
};

export function parseLanding(raw: string | null | undefined): Landing {
  return LANDINGS.find((l) => l === raw) ?? DEFAULT_LANDING;
}

export const landingPath = (raw: string | null | undefined): Route => PATHS[parseLanding(raw)];

/** The cookie value for a choice; the default clears it so later changes to the default reach everyone. */
export function landingCookie(landing: Landing): string {
  const base = `${LANDING_COOKIE}=${landing === DEFAULT_LANDING ? "" : landing}; path=/; samesite=lax`;
  return landing === DEFAULT_LANDING ? `${base}; max-age=0` : `${base}; max-age=31536000`;
}

export function readLandingCookie(cookie: string): Landing {
  const m = new RegExp(`(?:^|; )${LANDING_COOKIE}=([^;]*)`).exec(cookie);
  return parseLanding(m?.[1]);
}
