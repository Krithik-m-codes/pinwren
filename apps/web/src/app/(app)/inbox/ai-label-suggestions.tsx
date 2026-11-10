"use client";

import { Check, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";
import {
  errorMessage,
  useAiLabelSuggestionsQuery,
  useBulkAiLabelsMutation,
  useDecideLabelSuggestionMutation,
} from "@/lib/store/api";
import { LabelDot } from "./pickers";

/**
 * AI label suggestions as ghost chips (dashed, muted) next to the item's real labels: Accept applies the
 * label (a proposed new one is created), Dismiss drops it for good. Nothing is applied until someone clicks,
 * unless the project turned on auto-apply for existing labels.
 */
export function AiLabelSuggestions({ feedbackId }: { feedbackId: string }) {
  const { t, tn } = useI18n();
  const query = useAiLabelSuggestionsQuery(feedbackId);
  const [decide, { isLoading }] = useDecideLabelSuggestionMutation();
  const [bulk, { isLoading: bulking }] = useBulkAiLabelsMutation();
  const suggestions = query.data?.suggestions ?? [];
  if (!suggestions.length) return null;
  const busy = isLoading || bulking;

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 text-xs"
      role="group"
      aria-label={t("automation.suggestionsGroup")}
      data-testid="ai-label-suggestions"
    >
      <span className="flex items-center gap-1 font-medium text-primary">
        <Sparkles className="size-3.5" /> {t("automation.suggestsLabels")}
      </span>
      {suggestions.map((s) => (
        <span
          key={s.id}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-primary/40 bg-primary/5 py-px pr-0.5 pl-1.5 text-foreground/80"
          data-testid="ai-label-chip"
          title={s.reason ?? undefined}
        >
          <LabelDot color={s.color} className="size-1.5" />
          <span className="max-w-32 truncate">{s.name}</span>
          {s.labelId === null && (
            <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground uppercase">
              {t("automation.newLabel")}
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="size-5 text-emerald-600"
            disabled={busy}
            aria-label={t("automation.acceptLabel", { name: s.name })}
            onClick={() =>
              void decide({ feedbackId, id: s.id, action: "accept" })
                .unwrap()
                .then(() => toast.success(t("automation.labelAccepted", { name: s.name })))
                .catch((e: unknown) => toast.error(errorMessage(e)))
            }
          >
            <Check className="size-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="size-5"
            disabled={busy}
            aria-label={t("automation.dismissLabel", { name: s.name })}
            onClick={() =>
              void decide({ feedbackId, id: s.id, action: "dismiss" })
                .unwrap()
                .catch((e: unknown) => toast.error(errorMessage(e)))
            }
          >
            <X className="size-3" />
          </Button>
        </span>
      ))}
      {suggestions.length > 1 && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={busy}
          onClick={() =>
            void bulk({ feedbackIds: [feedbackId], action: "accept" })
              .unwrap()
              .then((r) => toast.success(tn("automation.labelsAccepted", r.accepted)))
              .catch((e: unknown) => toast.error(errorMessage(e)))
          }
        >
          {t("automation.acceptAll")}
        </Button>
      )}
    </div>
  );
}
