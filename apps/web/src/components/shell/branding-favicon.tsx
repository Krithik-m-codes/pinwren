"use client";

import { useEffect } from "react";

/** Apply the favicon from the signed-in server boundary's already-fetched workspace branding. */
export function BrandingFavicon({ href }: { href: string | null }) {
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (link) link.href = href ?? "/pinwren-icon.svg";
  }, [href]);

  return null;
}
