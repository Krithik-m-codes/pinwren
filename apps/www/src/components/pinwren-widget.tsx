"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";

// Dogfood: the marketing site collects its own feedback through a Pinwren instance. Off unless a project key
// is set (builds, e2e and previews stay clean). NEXT_PUBLIC_* is inlined at build time. /demo has its own
// embedded widget (sandbox key + intercepted API), so a second one must never load there.
const URL_BASE = (process.env.NEXT_PUBLIC_PINWREN_URL?.trim() || "https://bug.shubpy.com").replace(
  /\/+$/,
  "",
);
const KEY = process.env.NEXT_PUBLIC_PINWREN_KEY?.trim() ?? "";

export function PinwrenWidget() {
  const pathname = usePathname();
  if (!KEY || pathname === "/demo" || pathname.startsWith("/demo/")) return null;
  return (
    <Script
      id="pinwren-dogfood"
      src={`${URL_BASE}/widget.js`}
      data-project={KEY}
      strategy="afterInteractive"
    />
  );
}
