"use client";

import { useSearchContext } from "@fumadocs/base-ui/contexts/search";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

/** Opens the docs search (⌘K / Ctrl K) from the marketing header. */
export function SearchButton({ className }: { className?: string }) {
  const { setOpenSearch } = useSearchContext();
  return (
    <button
      type="button"
      onClick={() => setOpenSearch(true)}
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-lg border bg-muted/40 pr-1.5 pl-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        className,
      )}
    >
      <Search className="size-3.5" aria-hidden />
      <span>Search docs</span>
      <kbd className="ml-3 rounded border bg-background px-1.5 font-mono text-[11px]">⌘K</kbd>
    </button>
  );
}
