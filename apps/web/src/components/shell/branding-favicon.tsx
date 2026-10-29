"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useBrandingQuery } from "@/lib/store/api";

const subscribe = () => () => undefined;

/** Apply the active workspace icon after the existing authenticated branding query resolves. */
export function BrandingFavicon() {
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const { data } = useBrandingQuery(undefined, { skip: !ready });

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (link) link.href = data?.branding.faviconUrl ?? "/pinwren-icon.svg";
  }, [data?.branding.faviconUrl]);

  return null;
}
