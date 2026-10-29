"use client";

import { useEffect } from "react";
import { useBrandingQuery } from "@/lib/store/api";

/** Apply the active workspace icon after the existing authenticated branding query resolves. */
export function BrandingFavicon() {
  const { data } = useBrandingQuery(undefined);

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (link) link.href = data?.branding.faviconUrl ?? "/pinwren-icon.svg";
  }, [data?.branding.faviconUrl]);

  return null;
}
