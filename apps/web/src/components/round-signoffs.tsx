"use client";

import { CircleCheck, MessageSquareWarning } from "lucide-react";
import { RelativeTime } from "@/components/feedback-meta";
import { ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { Key } from "@/lib/i18n/en";
import { useT } from "@/lib/i18n/provider";
import { useRoundSignoffsQuery } from "@/lib/store/api/share";
import { cn } from "@/lib/utils";

type State = "none" | "approved" | "changes_requested";

const STATE_LABEL: Record<State, Key> = {
  none: "share.stateNone",
  approved: "share.stateApproved",
  changes_requested: "share.stateChanges",
};

/** The round's sign-off state as a badge; "Awaiting" only while the round needs one. */
export function SignoffBadge({ state, required }: { state: State; required: boolean }) {
  const t = useT();
  if (state === "none" && !required) return null;
  return (
    <Badge
      variant="outline"
      data-testid="signoff-badge"
      data-state={state}
      className={cn(
        "gap-1 font-normal",
        state === "approved" && "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
        state === "changes_requested" && "border-amber-500/40 text-amber-700 dark:text-amber-400",
      )}
    >
      {state === "approved" ? (
        <CircleCheck className="size-3" />
      ) : state === "changes_requested" ? (
        <MessageSquareWarning className="size-3" />
      ) : null}
      {t(STATE_LABEL[state])}
    </Badge>
  );
}

/** Timeline of the client's answers on a round, newest first. */
export function SignoffsDialog({
  roundId,
  roundName,
  open,
  onOpenChange,
}: {
  roundId: string;
  roundName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const q = useRoundSignoffsQuery(roundId, { skip: !open });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="signoffs-dialog">
        <DialogHeader>
          <DialogTitle>{t("share.signoffsTitle", { name: roundName })}</DialogTitle>
          <DialogDescription>{t("share.signoffsDescription")}</DialogDescription>
        </DialogHeader>
        {q.isLoading && <Skeleton className="h-16 w-full" />}
        {q.isError && <ErrorState error={q.error} retry={() => void q.refetch()} />}
        {q.data?.signoffs.length === 0 && (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            {t("share.signoffsEmpty")}
          </p>
        )}
        {q.data && q.data.signoffs.length > 0 && (
          <ol className="grid gap-3" aria-label={t("share.signoffsTimeline")}>
            {q.data.signoffs.map((s) => (
              <li key={s.id} className="grid gap-1 rounded-lg border p-3 text-sm" data-testid="signoff-entry">
                <div className="flex flex-wrap items-center gap-2">
                  <SignoffBadge state={s.decision} required={false} />
                  <span className="font-medium">{s.name}</span>
                  <span className="text-xs text-muted-foreground">{s.email}</span>
                  <RelativeTime iso={s.createdAt} className="ml-auto text-xs text-muted-foreground" />
                </div>
                {s.note && <p className="break-words whitespace-pre-wrap text-muted-foreground">{s.note}</p>}
              </li>
            ))}
          </ol>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("share.done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
