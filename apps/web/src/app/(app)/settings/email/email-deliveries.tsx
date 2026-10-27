"use client";

import type { EmailDeliveryStatus } from "@pinwren/core";
import { Inbox, RotateCw, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { LocalDate } from "@/components/feedback-meta";
import { Segmented } from "@/components/segmented";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Key } from "@/lib/i18n/en";
import { useI18n, useT } from "@/lib/i18n/provider";
import { errorMessage } from "@/lib/store/api";
import {
  type EmailDelivery,
  useEmailDeliveriesQuery,
  useResendDeliveryMutation,
  useResendSkippedMutation,
} from "@/lib/store/api/notifications";
import { cn } from "@/lib/utils";

const STATUS: Record<EmailDeliveryStatus, { label: Key; className: string }> = {
  sent: { label: "settings2.sent", className: "bg-emerald-500" },
  skipped: { label: "settings2.skipped", className: "bg-amber-500" },
  failed: { label: "settings2.failed", className: "bg-destructive" },
};

const FILTERS = [
  { value: "all", label: "settings2.filterAll" },
  { value: "failed", label: "settings2.failed" },
  { value: "skipped", label: "settings2.skipped" },
  { value: "sent", label: "settings2.sent" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

const NO_EMAILS: Record<Exclude<Filter, "all">, Key> = {
  failed: "settings2.noFailedEmails",
  skipped: "settings2.noSkippedEmails",
  sent: "settings2.noSentEmails",
};

/** "feedback_created" → "feedback created". */
const templateName = (key: string) => key.replace(/_/g, " ");

/**
 * Recent deliveries (30 days): every email the server sent, skipped or gave up on, with the reason. Skipped
 * because SMTP wasn't set up yet → "Send skipped emails" once it is; a failed one can be sent again.
 */
export function EmailDeliveries({ configured }: { configured: boolean }) {
  const { t, tn } = useI18n();
  const [filter, setFilter] = useState<Filter>("all");
  const query = useEmailDeliveriesQuery(filter === "all" ? null : filter);
  const [resendSkipped, bulk] = useResendSkippedMutation();
  const skipped = query.data?.skippedNotConfigured ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings2.recentDeliveries")}</CardTitle>
        <CardDescription>{t("settings2.recentDeliveriesDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label={t("settings2.show")}
            value={filter}
            onChange={setFilter}
            options={FILTERS.map((x) => ({ value: x.value, label: t(x.label) }))}
          />
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RotateCw className={cn(query.isFetching && "animate-spin")} /> {t("settings2.refresh")}
          </Button>
        </div>
        {skipped > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
            <span className="min-w-0 flex-1">
              {tn("settings2.skippedNoSmtp", skipped)}
              {configured ? "" : ` ${t("settings2.setItUpAbove")}`}
            </span>
            {configured && (
              <Button
                size="sm"
                variant="outline"
                disabled={bulk.isLoading}
                data-testid="resend-skipped"
                onClick={() =>
                  void resendSkipped(undefined)
                    .unwrap()
                    .then((r) => toast.success(tn("settings2.emailsQueued", r.queued)))
                    .catch((e: unknown) =>
                      toast.error(t("settings2.notSent"), { description: errorMessage(e) }),
                    )
                }
              >
                <Send /> {t("settings2.sendSkippedEmails")}
              </Button>
            )}
          </div>
        )}
        {query.isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        )}
        {query.isError && <ErrorState error={query.error} retry={() => void query.refetch()} />}
        {query.data?.items.length === 0 && (
          <EmptyState
            icon={Inbox}
            title={filter === "all" ? t("settings2.noEmailsYet") : t(NO_EMAILS[filter])}
            description={t("settings2.emailsAppearHere")}
          />
        )}
        {query.data && query.data.items.length > 0 && (
          <ul className="divide-y rounded-lg border" data-testid="email-deliveries">
            {query.data.items.map((d) => (
              <DeliveryRow key={d.id} d={d} configured={configured} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DeliveryRow({ d, configured }: { d: EmailDelivery; configured: boolean }) {
  const t = useT();
  const [resend, state] = useResendDeliveryMutation();
  const s = STATUS[d.status];
  const canResend = configured && d.status !== "sent" && d.error !== "unsubscribed";
  return (
    <li className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-3">
      <Badge variant="outline" className="w-fit shrink-0 gap-1.5 font-normal">
        <span className={cn("size-1.5 rounded-full", s.className)} /> {t(s.label)}
      </Badge>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{d.subject}</p>
        <p className="truncate text-xs text-muted-foreground">
          {t("settings2.toRecipient", { to: d.to })} · {templateName(d.templateKey)}
          {d.attempts > 1 ? ` · ${t("settings2.attemptsCount", { n: d.attempts })}` : ""}
        </p>
        {d.error && d.status !== "sent" && (
          <p className="mt-0.5 text-xs break-words text-destructive">{d.error}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <LocalDate iso={d.createdAt} time className="text-xs text-muted-foreground" />
        {canResend && (
          <Button
            size="xs"
            variant="outline"
            disabled={state.isLoading}
            onClick={() =>
              void resend(d.id)
                .unwrap()
                .then((r) =>
                  r.delivery.status === "sent"
                    ? toast.success(t("settings2.sentTo", { to: r.delivery.to }))
                    : toast.error(t("settings2.stillNotSent"), {
                        description: r.delivery.error ?? undefined,
                      }),
                )
                .catch((e: unknown) => toast.error(t("settings2.notSent"), { description: errorMessage(e) }))
            }
          >
            {state.isLoading ? t("settings2.sending") : t("settings2.sendAgain")}
          </Button>
        )}
      </div>
    </li>
  );
}
