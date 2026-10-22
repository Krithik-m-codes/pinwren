import { Bug, Check, CornerDownLeft, MessageSquare } from "lucide-react";

/**
 * A still of the widget at work, built from HTML so it stays crisp, themable and readable by screen readers
 * as a description. The region draws itself and the pin drops once (CSS only; off with reduced motion).
 */
export function HeroMockup() {
  return (
    <figure className="relative mx-auto w-full max-w-[40rem]" aria-labelledby="hero-mockup-caption">
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-[radial-gradient(60%_60%_at_50%_40%,color-mix(in_oklch,var(--brand)_22%,transparent),transparent)] blur-2xl" />
      <div className="shadow-brand/10 overflow-hidden rounded-2xl border bg-card shadow-2xl ring-1 ring-black/5 dark:ring-white/5">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-2">
          <span className="flex gap-1.5" aria-hidden>
            <span className="size-2.5 rounded-full bg-[#ff5f57]" />
            <span className="size-2.5 rounded-full bg-[#febc2e]" />
            <span className="size-2.5 rounded-full bg-[#28c840]" />
          </span>
          <span className="mx-auto rounded-md border bg-background px-3 py-0.5 font-mono text-[11px] text-muted-foreground">
            staging.example.com/launch
          </span>
          <span className="w-10" aria-hidden />
        </div>

        {/* The client's page */}
        <div className="relative aspect-[16/11] bg-background p-5 text-left sm:p-7" aria-hidden>
          <div className="flex items-center justify-between">
            <div className="h-2.5 w-20 rounded-full bg-foreground/80" />
            <div className="flex gap-3">
              <div className="h-2 w-10 rounded-full bg-muted-foreground/30" />
              <div className="h-2 w-10 rounded-full bg-muted-foreground/30" />
              <div className="h-2 w-10 rounded-full bg-muted-foreground/30" />
            </div>
          </div>
          <div className="mt-6 grid grid-cols-[1fr_1.15fr] gap-5">
            <div className="space-y-2.5 pt-2">
              <div className="h-4 w-11/12 rounded-md bg-foreground/85" />
              <div className="h-4 w-3/4 rounded-md bg-foreground/85" />
              <div className="mt-3 h-2 w-full rounded-full bg-muted-foreground/25" />
              <div className="h-2 w-5/6 rounded-full bg-muted-foreground/25" />
              <div className="mt-4 h-7 w-24 rounded-lg bg-foreground" />
            </div>
            <div className="relative">
              <div className="aspect-[4/3] rounded-xl bg-[linear-gradient(135deg,#f6c38b,#d9805f_45%,#6f5b9a)] dark:opacity-90" />
              {/* Region selection */}
              <div className="animate-region-draw border-brand bg-brand/10 absolute top-[14%] left-[10%] h-[58%] w-[72%] rounded-md border-2 border-dashed [animation-delay:400ms]" />
              <span className="animate-pin-drop bg-brand text-brand-foreground absolute top-[14%] left-[82%] grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full rounded-bl-none text-[11px] font-semibold shadow-lg ring-2 ring-background [animation-delay:1200ms]">
                1
              </span>
            </div>
          </div>
          <div className="mt-6 grid grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-1.5 rounded-lg border p-2">
                <div className="aspect-[5/3] rounded bg-muted" />
                <div className="h-1.5 w-2/3 rounded-full bg-muted-foreground/30" />
              </div>
            ))}
          </div>

          {/* Launcher */}
          <span className="bg-brand text-brand-foreground absolute right-4 bottom-4 grid size-10 place-items-center rounded-full shadow-lg">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2.2}>
              <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" />
              <circle cx="12" cy="9.5" r="2.4" fill="currentColor" stroke="none" />
            </svg>
          </span>
        </div>
      </div>

      {/* Thread card, anchored to the region */}
      <div className="animate-pin-drop absolute top-[44%] -right-2 w-64 rounded-xl border bg-popover p-3 text-left text-[13px] shadow-xl [animation-delay:1500ms] sm:-right-10">
        <div className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-full bg-amber-200 text-[10px] font-semibold text-amber-900">
            MO
          </span>
          <span className="font-medium">Maya Okafor</span>
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <MessageSquare className="size-3" aria-hidden />
            Comment
          </span>
        </div>
        <p className="mt-2 leading-snug">
          Swap this for the autumn shot — it feels too summery for the launch.
        </p>
        <div className="mt-2.5 border-t pt-2.5">
          <div className="flex items-center gap-2">
            <span className="bg-brand text-brand-foreground grid size-5 place-items-center rounded-full text-[9px] font-semibold">
              S
            </span>
            <span className="text-[12px] font-medium">Sam</span>
            <span className="bg-brand-soft text-brand rounded px-1 text-[10px] font-medium">Team</span>
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">On it — new photo in the next deploy.</p>
        </div>
        <div className="mt-2.5 flex items-center gap-1.5">
          <span className="flex-1 rounded-md border px-2 py-1 text-[11px] text-muted-foreground">Reply…</span>
          <span className="inline-flex items-center gap-1 rounded-md bg-foreground px-2 py-1 text-[11px] font-medium text-background">
            <Check className="size-3" aria-hidden />
            Resolve
          </span>
        </div>
      </div>

      {/* Bug report summary */}
      <div className="animate-pin-drop absolute -bottom-10 -left-2 hidden w-60 rounded-xl border bg-popover p-3 text-left text-[12px] shadow-xl [animation-delay:2100ms] sm:-left-10 sm:block">
        <div className="flex items-center gap-1.5 font-medium">
          <Bug className="size-3.5 text-red-700 dark:text-red-300" aria-hidden />
          Bug #142 · Add to cart does nothing
        </div>
        <ul className="mt-2 space-y-1 font-mono text-[10.5px]">
          <li className="truncate rounded bg-destructive/10 px-1.5 py-0.5 text-red-700 dark:text-red-300">
            TypeError: cart is undefined
          </li>
          <li className="truncate rounded bg-muted px-1.5 py-0.5">POST /api/cart → 500 · 212 ms</li>
          <li className="truncate rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
            Chrome 131 · macOS · 1440×900
          </li>
        </ul>
        <div className="mt-2 flex items-center gap-1 text-[10.5px] text-muted-foreground">
          <CornerDownLeft className="size-3" aria-hidden />
          Synced to GitHub issue
        </div>
      </div>
      <figcaption id="hero-mockup-caption" className="sr-only">
        A client drags a region over a hero image and leaves a pinned comment; a teammate replies. Below, a
        bug report carries a console error, a failed request and the browser details.
      </figcaption>
    </figure>
  );
}
