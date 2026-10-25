"use client";

import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AiSummaryCard({
  summary,
  suggestedTitle,
  onApplyTitle,
}: {
  summary: string;
  suggestedTitle?: string | null | undefined;
  onApplyTitle?: ((title: string) => void) | undefined;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-foreground">
      <div className="flex items-center gap-2 font-medium text-primary">
        <Sparkles className="size-4" />
        <span>AI Executive Summary</span>
      </div>

      <p className="leading-relaxed text-muted-foreground">{summary}</p>

      {suggestedTitle && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-primary/10 pt-2">
          <div className="min-w-0">
            <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Suggested title:{" "}
            </span>
            <span className="font-medium text-foreground">{suggestedTitle}</span>
          </div>
          {onApplyTitle && (
            <Button
              type="button"
              size="xs"
              variant="outline"
              className="gap-1 border-primary/30 text-primary hover:bg-primary/10"
              onClick={() => onApplyTitle(suggestedTitle)}
            >
              <Check className="size-3" />
              Apply title
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
