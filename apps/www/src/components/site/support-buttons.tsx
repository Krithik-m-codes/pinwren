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
          "inline-flex items-center gap-1.5 rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-sm font-medium text-orange-600 transition-colors hover:bg-orange-500/20 dark:text-orange-400",
          isStacked && "w-full justify-center",
          isMinimal && "px-2 py-1.5 text-xs",
        )}
        aria-label="Buy me a coffee"
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
          "inline-flex items-center gap-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-2 text-sm font-medium text-purple-600 transition-colors hover:bg-purple-500/20 dark:text-purple-400",
          isStacked && "w-full justify-center",
          isMinimal && "px-2 py-1.5 text-xs",
        )}
        aria-label="Sponsor on GitHub"
      >
        <Users className="size-4" aria-hidden />
        {showLabels && <span>Sponsor us</span>}
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
            className="flex items-center gap-2 text-muted-foreground transition-colors hover:text-orange-500"
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
            className="flex items-center gap-2 text-muted-foreground transition-colors hover:text-purple-500"
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
