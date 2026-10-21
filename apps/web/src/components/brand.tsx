"use client";

import { Logo } from "@/components/logo";
import { contrastText, HEX, useBranding } from "@/lib/account-hooks";
import { cn } from "@/lib/utils";

/**
 * Applies the workspace accent to the dashboard theme (buttons, focus rings, active sidebar items) in
 * light and dark. The value is a validated hex colour, never free text, so it can't inject CSS.
 */
export function BrandTheme() {
  const accent = useBranding().data?.branding.accent;
  if (!accent || !HEX.test(accent)) return null;
  const fg = contrastText(accent);
  const vars = `--primary:${accent};--primary-foreground:${fg};--ring:${accent};--sidebar-primary:${accent};--sidebar-primary-foreground:${fg};`;
  return <style data-testid="brand-theme">{`:root,.dark{${vars}}`}</style>;
}

/** The product mark in the sidebar: the uploaded logo, or Pinwren's. */
export function BrandMark({ className }: { className?: string }) {
  const b = useBranding().data?.branding;
  if (b?.logoUrl) {
    return (
      // biome-ignore lint/performance/noImgElement: user-uploaded logo served by the API
      <img
        src={b.logoUrl}
        alt=""
        className={cn("size-7 shrink-0 rounded-lg object-contain", className)}
        data-testid="brand-logo"
      />
    );
  }
  return <Logo compact className={className} />;
}

export function useProductName() {
  return useBranding().data?.branding.productName ?? "Pinwren";
}
