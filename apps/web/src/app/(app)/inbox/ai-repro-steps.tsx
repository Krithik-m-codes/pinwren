"use client";

import { Check, Copy, ListOrdered } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function AiReproSteps({ steps }: { steps: string[] }) {
  const [copied, setCopied] = useState(false);

  if (!steps.length) return null;

  const handleCopy = async () => {
    try {
      const text = steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Reproduction steps copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy reproduction steps");
    }
  };

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4 text-sm text-card-foreground">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <ListOrdered className="size-4 text-primary" />
          <span>Reproduction Steps</span>
        </div>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="gap-1 text-muted-foreground hover:text-foreground"
          onClick={handleCopy}
        >
          {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
          <span>{copied ? "Copied" : "Copy steps"}</span>
        </Button>
      </div>

      <ol className="list-inside list-decimal space-y-1 pl-1 text-sm leading-relaxed text-muted-foreground">
        {steps.map((step, idx) => (
          <li key={idx} className="pl-1">
            <span className="text-foreground">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
