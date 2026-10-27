import { Logo } from "@/components/logo";
import { BrowserLocale } from "@/lib/i18n/browser-locale";
import { OriginHint } from "./auth-shared";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden px-4 py-12">
      <BrowserLocale />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,color-mix(in_oklch,var(--primary)_14%,transparent),transparent)]"
      />
      <Logo className="mb-8" />
      <div className="w-full max-w-sm">
        <OriginHint />
        {children}
      </div>
    </div>
  );
}
