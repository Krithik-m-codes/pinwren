"use client";

import { usePathname, useSearchParams } from "next/navigation";

/**
 * Screen state kept in the URL (filters, the open item, tabs), updated with the native History API.
 * Next.js keeps `useSearchParams()` in sync with `history.replaceState`, and the change stays in the
 * browser: no server round trip for a filter click or a `j` press — the data comes from RTK Query.
 */
export function useUrlParams() {
  const params = useSearchParams();
  const pathname = usePathname();
  const setParams = (patch: Record<string, string | null>, mode: "replace" | "push" = "replace") => {
    const next = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    const url = `${pathname}${qs ? `?${qs}` : ""}`;
    if (mode === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  };
  /** Replace the whole query string (applying a saved view, clearing filters). */
  const setAll = (next: URLSearchParams) => {
    const qs = next.toString();
    window.history.replaceState(null, "", `${pathname}${qs ? `?${qs}` : ""}`);
  };
  return { params, pathname, setParams, setAll };
}
