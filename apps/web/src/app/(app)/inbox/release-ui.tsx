"use client";

import { ExternalLink, Rocket, RotateCcw, Tag, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FeedbackDetail, FeedbackRow } from "@/lib/api";
import type { Key } from "@/lib/i18n/en";
import { useI18n, useT } from "@/lib/i18n/provider";
import { errorMessage, useReleasesQuery, useUpdateFeedbackMutation } from "@/lib/store/api";
import { cn } from "@/lib/utils";

// Releases and regressions on an item (ADR 0036): the "Fixed in" picker beside the status, the badges, and
// the banner that says a new report looks like a resolved one coming back.

type Item = Pick<
  FeedbackRow,
  | "status"
  | "fixedInReleaseId"
  | "fixedInVersion"
  | "fixedInNextRelease"
  | "regressionOfId"
  | "regressionOfNumber"
  | "regressionConfidence"
  | "release"
>;

const NONE = "none";
const NEXT = "next";

/** "Fixed in …": the release that fixed a resolved item, or the promise of the next one. */
export function FixedInPicker({
  projectId,
  fixedInReleaseId,
  fixedInNextRelease,
  onPick,
}: {
  projectId: string;
  fixedInReleaseId: string | null | undefined;
  fixedInNextRelease: boolean | undefined;
  onPick: (patch: { fixedInReleaseId: string | null } | { fixedInNextRelease: true }) => void;
}) {
  const t = useT();
  const releases = useReleasesQuery(projectId);
  const list = releases.data?.releases ?? [];
  const items = [
    { value: NONE, label: t("releases.fixedInNone") },
    { value: NEXT, label: t("releases.fixedInNext") },
    ...list.map((r) => ({ value: r.id, label: r.version })),
  ];
  const value = fixedInReleaseId ?? (fixedInNextRelease ? NEXT : NONE);
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(v) => {
        if (!v || v === value) return;
        onPick(v === NEXT ? { fixedInNextRelease: true } : { fixedInReleaseId: v === NONE ? null : v });
      }}
    >
      <SelectTrigger size="sm" aria-label={t("releases.fixedInPicker")} data-testid="fixed-in-picker">
        <Rocket className="size-3.5" />
        <span className="text-muted-foreground">{t("releases.fixedIn")}</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            {i.label}
          </SelectItem>
        ))}
        {!releases.isLoading && list.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">{t("releases.noReleasesYet")}</p>
        )}
      </SelectContent>
    </Select>
  );
}

/** The small chips: fixed in, reported in, regression. Read-only, so viewers and the list use it too. */
export function ReleaseBadges({
  item,
  fixedInVersion,
  showFixed = true,
  className,
}: {
  item: Item;
  fixedInVersion?: string | null | undefined;
  /** Off beside the picker, which already shows the fix. */
  showFixed?: boolean;
  className?: string;
}) {
  const t = useT();
  const fixed = fixedInVersion ?? item.fixedInVersion ?? null;
  return (
    <>
      {showFixed && item.status === "resolved" && fixed && (
        <Badge
          variant="outline"
          className={cn("h-7 gap-1.5 px-2.5 font-normal text-emerald-700 dark:text-emerald-400", className)}
          data-testid="fixed-in-badge"
        >
          <Rocket className="size-3.5" /> {t("releases.fixedInBadge", { version: fixed })}
        </Badge>
      )}
      {showFixed && item.status === "resolved" && !fixed && item.fixedInNextRelease && (
        <Badge
          variant="outline"
          className={cn("h-7 gap-1.5 px-2.5 font-normal", className)}
          data-testid="fixed-in-badge"
        >
          <Rocket className="size-3.5" /> {t("releases.fixedInNextBadge")}
        </Badge>
      )}
      {item.release && (
        <Badge
          variant="outline"
          className={cn("h-7 gap-1.5 px-2.5 font-normal", className)}
          data-testid="reported-release"
        >
          <Tag className="size-3.5" /> {t("releases.reportedIn", { version: item.release })}
        </Badge>
      )}
      {item.regressionOfId && <RegressionChip item={item} className={className} />}
    </>
  );
}

/** "Possible regression of #41" as a chip. */
export function RegressionChip({ item, className }: { item: Item; className?: string | undefined }) {
  const t = useT();
  if (!item.regressionOfId) return null;
  const likely = item.regressionConfidence === "likely";
  const text =
    item.regressionOfNumber != null
      ? t(likely ? "releases.regressionOfLikely" : "releases.regressionOfPossible", {
          number: item.regressionOfNumber,
        })
      : t("releases.regressionBadge");
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-7 gap-1.5 px-2.5 font-normal",
        likely
          ? "border-red-500/40 text-red-700 dark:text-red-400"
          : "border-amber-500/40 text-amber-800 dark:text-amber-300",
        className,
      )}
      data-testid="regression-badge"
    >
      <TriangleAlert className="size-3.5" /> {text}
    </Badge>
  );
}

/** The compact badge on an inbox row. */
export function RegressionTag({ item }: { item: Item }) {
  const t = useT();
  if (!item.regressionOfId) return null;
  const likely = item.regressionConfidence === "likely";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded border px-1 text-[11px] leading-4",
        likely
          ? "border-red-500/40 text-red-700 dark:text-red-400"
          : "border-amber-500/40 text-amber-800 dark:text-amber-300",
      )}
      title={
        item.regressionOfNumber != null
          ? t(likely ? "releases.regressionOfLikely" : "releases.regressionOfPossible", {
              number: item.regressionOfNumber,
            })
          : undefined
      }
      data-testid="regression-tag"
    >
      <TriangleAlert aria-hidden className="size-3" /> {t("releases.regressionBadge")}
    </span>
  );
}

const SIGNAL_TEXT: Record<string, Key> = {
  error: "releases.signalError",
  element: "releases.signalElement",
  release: "releases.signalRelease",
};

/** On a flagged report: what it may be a regression of, why, and a way to reopen the original. */
export function RegressionBanner({
  feedback,
  canWrite,
  onOpen,
}: {
  feedback: FeedbackDetail["feedback"];
  canWrite: boolean;
  onOpen: (id: string) => void;
}) {
  const t = useT();
  const [update, state] = useUpdateFeedbackMutation();
  const of = feedback.regressionOf;
  if (!of) return null;
  const likely = feedback.regressionConfidence === "likely";
  const reasons = of.signals.length
    ? of.signals.flatMap((s) => SIGNAL_TEXT[s] ?? [])
    : (["releases.signalAi"] as Key[]);
  const reopen = () =>
    update({ ids: [of.id], patch: { status: "open" } })
      .unwrap()
      .then(() => toast.success(t("releases.originalReopened", { number: of.number })))
      .catch((e: unknown) => toast.error(t("releases.reopenFailed"), { description: errorMessage(e) }));
  return (
    <div
      className={cn(
        "space-y-2 rounded-xl border p-4 text-sm",
        likely ? "border-red-500/30 bg-red-500/10" : "border-amber-500/30 bg-amber-500/10",
      )}
      data-testid="regression-banner"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className={cn(
            "flex items-center gap-2 font-medium",
            likely ? "text-red-800 dark:text-red-300" : "text-amber-800 dark:text-amber-300",
          )}
        >
          <TriangleAlert className="size-4 shrink-0" />
          <span>{t(likely ? "releases.bannerLikely" : "releases.bannerPossible")}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="xs" variant="outline" onClick={() => onOpen(of.id)}>
            <ExternalLink /> {t("releases.viewOriginal", { number: of.number })}
          </Button>
          {canWrite && of.status === "resolved" && (
            <Button type="button" size="xs" variant="outline" disabled={state.isLoading} onClick={reopen}>
              <RotateCcw /> {t("releases.reopenOriginal", { number: of.number })}
            </Button>
          )}
        </div>
      </div>
      <p>{t("releases.bannerBody", { number: of.number, title: of.title })}</p>
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
        {reasons.map((k) => (
          <li key={k}>{t(k)}</li>
        ))}
        {feedback.release && <li>{t("releases.reportedIn", { version: feedback.release })}</li>}
      </ul>
    </div>
  );
}

/** On the resolved original: the newer reports that may be it coming back. */
export function RegressionsOfThis({
  regressions,
  onOpen,
}: {
  regressions: NonNullable<FeedbackDetail["regressions"]>;
  onOpen: (id: string) => void;
}) {
  const { tn } = useI18n();
  if (!regressions.length) return null;
  return (
    <div
      className="space-y-1 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
      data-testid="regressions-of-this"
    >
      <div className="flex items-center gap-2 font-medium text-amber-800 dark:text-amber-300">
        <TriangleAlert className="size-4 shrink-0" />
        {tn("releases.regressionsOfThis", regressions.length)}
      </div>
      <ul className="space-y-0.5 text-xs">
        {regressions.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onOpen(r.id)}
              className="font-medium text-primary underline hover:text-primary/80"
            >
              #{r.number} {r.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
