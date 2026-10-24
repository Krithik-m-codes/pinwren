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
import { errorMessage } from "@/lib/store/api";
import {
  type EmailDelivery,
  useEmailDeliveriesQuery,
  useResendDeliveryMutation,
  useResendSkippedMutation,
} from "@/lib/store/api/notifications";
import { cn } from "@/lib/utils";

const STATUS: Record<EmailDeliveryStatus, { label: string; className: string }> = {
  sent: { label: "Sent", className: "bg-emerald-500" },
  skipped: { label: "Skipped", className: "bg-amber-500" },
  failed: { label: "Failed", className: "bg-destructive" },
};

const FILTERS = [
  { value: "all", label: "All" },
  { value: "failed", label: "Failed" },
  { value: "skipped", label: "Skipped" },
  { value: "sent", label: "Sent" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

/** "feedback_created" → "feedback created". */
const templateName = (key: string) => key.replace(/_/g, " ");

/**
 * Recent deliveries (30 days): every email the server sent, skipped or gave up on, with the reason. Skipped
 * because SMTP wasn't set up yet → "Send skipped emails" once it is; a failed one can be sent again.
 */
export function EmailDeliveries({ configured }: { configured: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");
  const query = useEmailDeliveriesQuery(filter === "all" ? null : filter);
  const [resendSkipped, bulk] = useResendSkippedMutation();
  const skipped = query.data?.skippedNotConfigured ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent deliveries</CardTitle>
        <CardDescription>
          The last 50 emails this server handled in the past 30 days, and why any didn&apos;t go out.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Show" value={filter} onChange={setFilter} options={[...FILTERS]} />
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RotateCw className={cn(query.isFetching && "animate-spin")} /> Refresh
          </Button>
        </div>
        {skipped > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
            <span className="min-w-0 flex-1">
              {skipped} {skipped === 1 ? "email was" : "emails were"} skipped because SMTP wasn&apos;t set up.
              {configured ? "" : " Set it up above to send them."}
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
                    .then((r) => toast.success(`${r.queued} ${r.queued === 1 ? "email" : "emails"} queued`))
                    .catch((e: unknown) => toast.error("Not sent", { description: errorMessage(e) }))
                }
              >
                <Send /> Send skipped emails
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
            title={filter === "all" ? "No emails yet" : `No ${filter} emails`}
            description="Emails appear here as Pinwren sends them, e.g. when a report arrives."
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
  const [resend, state] = useResendDeliveryMutation();
  const s = STATUS[d.status];
  const canResend = configured && d.status !== "sent" && d.error !== "unsubscribed";
  return (
    <li className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-3">
      <Badge variant="outline" className="w-fit shrink-0 gap-1.5 font-normal">
        <span className={cn("size-1.5 rounded-full", s.className)} /> {s.label}
      </Badge>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{d.subject}</p>
        <p className="truncate text-xs text-muted-foreground">
          To {d.to} · {templateName(d.templateKey)}
          {d.attempts > 1 ? ` · ${d.attempts} attempts` : ""}
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
                    ? toast.success(`Sent to ${r.delivery.to}`)
                    : toast.error("Still not sent", { description: r.delivery.error ?? undefined }),
                )
                .catch((e: unknown) => toast.error("Not sent", { description: errorMessage(e) }))
            }
          >
            {state.isLoading ? "Sending…" : "Send again"}
          </Button>
        )}
      </div>
    </li>
  );
}
