import { Logo } from "@/components/logo";
import { contrastText, HEX } from "@/lib/color";
import { cn } from "@/lib/utils";

/**
 * Applies the workspace accent to the dashboard theme (buttons, focus rings, active sidebar items) in
 * light and dark. Rendered on the server from the cached branding, so there is no flash of the default
 * colour. The value is a validated hex colour, never free text, so it can't inject CSS.
 */
export function BrandTheme({ accent }: { accent: string | null }) {
  if (!accent || !HEX.test(accent)) return null;
  const fg = contrastText(accent);
  const vars = `--primary:${accent};--primary-foreground:${fg};--ring:${accent};--sidebar-primary:${accent};--sidebar-primary-foreground:${fg};`;
  return <style data-testid="brand-theme">{`:root,.dark{${vars}}`}</style>;
}

/** The product mark in the sidebar: the uploaded logo, or Pinwren's. */
export function BrandMark({ logoUrl, className }: { logoUrl: string | null; className?: string }) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- user-uploaded logo (any host, any size); nothing for next/image to optimise
      <img
        src={logoUrl}
        alt=""
        className={cn("size-7 shrink-0 rounded-lg object-contain", className)}
        data-testid="brand-logo"
      />
    );
  }
  return <Logo compact className={className} />;
}
