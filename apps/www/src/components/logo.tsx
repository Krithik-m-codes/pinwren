import { cn } from "@/lib/utils";

/** The Pinwren mark: a map pin, the product's one idea — point at the page. */
export function LogoMark({ className }: { className?: string | undefined }) {
  return (
    <span
      className={cn(
        "bg-brand text-brand-foreground grid size-7 shrink-0 place-items-center rounded-lg shadow-sm",
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        aria-hidden
      >
        <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" />
        <circle cx="12" cy="9.5" r="2.4" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}

export function Logo({ className }: { className?: string | undefined }) {
  return (
    <span className={cn("flex items-center gap-2 text-[15px] font-semibold tracking-tight", className)}>
      <LogoMark />
      Pinwren
    </span>
  );
}
