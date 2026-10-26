"use client";

import { Heart, Users, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

const BUY_ME_COFFEE_URL = "https://www.buymeacoffee.com/krithikm92f";
const GITHUB_SPONSORS_URL = "https://github.com/sponsors/Krithik-m-codes";

type SupportButtonsProps = {
  variant?: "inline" | "stacked" | "minimal";
  className?: string;
  showLabels?: boolean;
};

export function SupportButtons({ variant = "inline", className, showLabels = true }: SupportButtonsProps) {
  const isStacked = variant === "stacked";
  const isMinimal = variant === "minimal";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2",
        isStacked && "w-full flex-col items-start gap-3",
        isMinimal && "gap-1",
        className,
      )}
      role="group"
      aria-label="Support Pinwren"
    >
      {/* Buy Me a Coffee - for individuals */}
      <a
        href={BUY_ME_COFFEE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "bg-brand-soft text-brand-ink inline-flex items-center gap-1.5 rounded-lg border border-brand/30 px-3 py-2 text-sm font-medium transition-colors hover:bg-brand/20",
          isStacked && "w-full justify-center",
          isMinimal && "px-2 py-1.5 text-xs",
        )}
      >
        <Heart className="size-4" aria-hidden />
        {showLabels && <span>Buy me a coffee</span>}
        {!isMinimal && <ExternalLink className="size-3 opacity-60" aria-hidden />}
      </a>

      {/* GitHub Sponsors - for companies/organizations */}
      <a
        href={GITHUB_SPONSORS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent",
          isStacked && "w-full justify-center",
          isMinimal && "px-2 py-1.5 text-xs",
        )}
      >
        <Users className="size-4" aria-hidden />
        {showLabels && <span>Sponsor on GitHub</span>}
        {!isMinimal && <ExternalLink className="size-3 opacity-60" aria-hidden />}
      </a>
    </div>
  );
}

/** Compact version for footer */
export function FooterSupport() {
  return (
    <nav aria-label="Support" className="space-y-3">
      <h2 className="text-sm font-semibold">Support</h2>
      <ul className="space-y-2 text-sm">
        <li>
          <a
            href={BUY_ME_COFFEE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Heart className="size-4" aria-hidden />
            <span>Buy me a coffee</span>
            <ExternalLink className="ml-auto size-3 opacity-60" aria-hidden />
          </a>
        </li>
        <li>
          <a
            href={GITHUB_SPONSORS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Users className="size-4" aria-hidden />
            <span>Sponsor on GitHub</span>
            <ExternalLink className="ml-auto size-3 opacity-60" aria-hidden />
          </a>
        </li>
      </ul>
    </nav>
  );
}
