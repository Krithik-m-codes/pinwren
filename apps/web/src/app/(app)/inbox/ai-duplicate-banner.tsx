"use client";

import { CopyCheck, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/provider";

export function AiDuplicateBanner({
  candidateId,
  candidateNumber,
  candidateTitle,
  confidence,
  reason,
  onLinkDuplicate,
  onViewCandidate,
}: {
  candidateId: string;
  candidateNumber?: number | undefined;
  candidateTitle?: string | null | undefined;
  confidence?: number | null | undefined;
  reason?: string | null | undefined;
  onLinkDuplicate?: ((candidateId: string) => void) | undefined;
  onViewCandidate?: ((candidateId: string) => void) | undefined;
}) {
  const t = useT();
  return (
    <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-foreground">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium text-amber-800 dark:text-amber-300">
          <CopyCheck className="size-4 shrink-0" />
          <span>
            {typeof confidence === "number"
              ? t("inbox2.duplicateDetectedConfidence", { confidence })
              : t("inbox2.duplicateDetected")}
          </span>
        </div>
        {onLinkDuplicate && (
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="border-amber-500/40 text-amber-800 hover:bg-amber-500/20 dark:text-amber-300"
            onClick={() => onLinkDuplicate(candidateId)}
          >
            {t("inbox2.linkAsDuplicate")}
          </Button>
        )}
      </div>

      <div className="text-sm">
        <span className="text-muted-foreground">{t("inbox2.matchesItem")}</span>
        {onViewCandidate ? (
          <button
            type="button"
            onClick={() => onViewCandidate(candidateId)}
            className="inline-flex items-center gap-1 font-medium text-primary underline hover:text-primary/80"
          >
            <span>
              {candidateNumber ? `#${candidateNumber} ` : ""}
              {candidateTitle || candidateId}
            </span>
            <ExternalLink className="size-3" />
          </button>
        ) : (
          <span className="font-medium">
            {candidateNumber ? `#${candidateNumber} ` : ""}
            {candidateTitle || candidateId}
          </span>
        )}
      </div>

      {reason && <p className="text-xs text-muted-foreground">{reason}</p>}
    </div>
  );
}
