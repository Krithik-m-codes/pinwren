"use client";

import type { BillingInfo, BillingInterval } from "@pinwren/core";
import { CreditCard, ExternalLink, Sparkles, TriangleAlert } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Key } from "@/lib/i18n/en";
import { useI18n } from "@/lib/i18n/provider";
import {
  errorMessage,
  useBillingQuery,
  useOpenBillingPortalMutation,
  useStartCheckoutMutation,
} from "@/lib/store/api";
import { cn } from "@/lib/utils";
import { SectionTitle } from "../settings-shell";

const STATUS: Record<BillingInfo["status"], Key> = {
  none: "billing.statusNone",
  pending: "billing.statusPending",
  active: "billing.statusActive",
  past_due: "billing.statusPastDue",
  on_hold: "billing.statusOnHold",
  cancelled: "billing.statusCancelled",
  expired: "billing.statusExpired",
  failed: "billing.statusFailed",
};

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

/** Settings › Billing (WP-22, Cloud only): plan, usage against its limits, upgrade, billing portal. */
export function BillingSettings() {
  const { t, tn } = useI18n();
  const query = useBillingQuery(undefined);
  const returned = useSearchParams().get("checkout");
  const [interval, setInterval] = useState<BillingInterval>("annual");
  const [startCheckout, checkout] = useStartCheckoutMutation();
  const [openPortal, portal] = useOpenBillingPortalMutation();

  if (query.isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (!query.data) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const b = query.data;
  const intervals = b.checkout.intervals;
  const chosen = intervals.includes(interval) ? interval : (intervals[0] ?? "monthly");

  const go = async (run: () => Promise<{ url: string }>) => {
    try {
      const { url } = await run();
      window.location.assign(url);
    } catch (e) {
      toast.error(errorMessage(e, t("billing.couldNotStart")));
    }
  };

  return (
    <div className="grid gap-4">
      <SectionTitle title={t("billing.title")} description={t("billing.description")} />

      {returned === "return" && <Notice tone="info">{t("billing.checkoutReturned")}</Notice>}
      {returned === "cancelled" && <Notice tone="info">{t("billing.checkoutCancelled")}</Notice>}
      {b.dunning && (
        <Notice tone="error" testId="billing-dunning">
          {b.dunning.downgraded ? t("billing.downgraded") : tn("billing.pastDue", b.dunning.daysLeft)}
        </Notice>
      )}
      {b.usage.reports.limit !== null && b.usage.reports.used >= b.usage.reports.limit && (
        <Notice tone="warn">{t("billing.reportsAtLimit")}</Notice>
      )}

      <Card data-testid="billing-plan">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <CreditCard className="size-4 text-muted-foreground" />
            {t("billing.currentPlan")}: {b.plan === "pro" ? t("billing.planPro") : t("billing.planFree")}
            <Badge variant="outline" className="ml-auto font-normal">
              {t(STATUS[b.status])}
            </Badge>
          </CardTitle>
          <CardDescription>
            {b.interval &&
              b.plan === "pro" &&
              (b.interval === "annual" ? t("billing.billedAnnually") : t("billing.billedMonthly"))}
            {b.currentPeriodEnd && b.plan === "pro" && (
              <>
                {" · "}
                {b.status === "cancelled"
                  ? t("billing.endsOn", { date: date(b.currentPeriodEnd) })
                  : t("billing.renewsOn", { date: date(b.currentPeriodEnd) })}
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <h3 className="text-sm font-medium">{t("billing.usage")}</h3>
          <dl className="grid gap-4 sm:grid-cols-3">
            <Meter label={t("billing.usageSeats")} {...b.usage.seats} />
            <Meter label={t("billing.usageProjects")} {...b.usage.projects} />
            <Meter label={t("billing.usageReports")} {...b.usage.reports} />
          </dl>
        </CardContent>
      </Card>

      {b.plan === "free" || b.dunning?.downgraded ? (
        <Card data-testid="billing-upgrade">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-muted-foreground" />
              {t("billing.upgradeTitle")}
            </CardTitle>
            <CardDescription>{t("billing.upgradeDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {b.checkout.available ? (
              <>
                <ToggleGroup
                  aria-label={t("billing.intervalLabel")}
                  value={[chosen]}
                  onValueChange={(v) => {
                    const next = v[0] as BillingInterval | undefined;
                    if (next) setInterval(next);
                  }}
                  spacing={2}
                  className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2"
                >
                  {intervals.map((i) => (
                    <ToggleGroupItem
                      key={i}
                      value={i}
                      variant="outline"
                      data-testid={`billing-interval-${i}`}
                      className={cn(
                        "h-auto w-full flex-col items-start justify-start gap-1 rounded-lg! px-3 py-2.5 text-left whitespace-normal",
                        "aria-pressed:border-primary aria-pressed:bg-primary/5 aria-pressed:ring-1 aria-pressed:ring-primary/40",
                      )}
                    >
                      <span className="text-sm font-medium">
                        {i === "annual" ? t("billing.annual") : t("billing.monthly")}
                      </span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {i === "annual"
                          ? t("billing.priceAnnual", { price: money(b.prices.annualPerMonth) })
                          : t("billing.priceMonthly", { price: money(b.prices.monthly) })}
                      </span>
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <div>
                  <Button
                    disabled={checkout.isLoading}
                    onClick={() => void go(() => startCheckout(chosen).unwrap())}
                    data-testid="billing-subscribe"
                  >
                    {checkout.isLoading ? t("billing.redirecting") : t("billing.subscribe")}
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("billing.unavailable")}</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {b.checkout.manageable && (
        <Card>
          <CardHeader>
            <CardTitle>{t("billing.manage")}</CardTitle>
            <CardDescription>{t("billing.manageDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              disabled={portal.isLoading}
              onClick={() => void go(() => openPortal(undefined).unwrap())}
              data-testid="billing-manage"
            >
              <ExternalLink /> {portal.isLoading ? t("billing.opening") : t("billing.manage")}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const { t } = useI18n();
  const ratio = limit === null || limit === 0 ? 0 : Math.min(1, used / limit);
  return (
    <div className="grid gap-1.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">
        {limit === null ? t("billing.usageUnlimited", { used }) : t("billing.usageOf", { used, limit })}
      </dd>
      {limit !== null && (
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(used, limit)}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn("h-full rounded-full", ratio >= 1 ? "bg-destructive" : "bg-primary")}
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function Notice({
  tone,
  children,
  testId,
}: {
  tone: "info" | "warn" | "error";
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <p
      role="status"
      data-testid={testId ?? "billing-notice"}
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
        tone === "info" && "border-border bg-muted/50",
        tone === "warn" && "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
        tone === "error" && "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      {tone !== "info" && <TriangleAlert className="mt-0.5 size-4 shrink-0" />}
      <span>{children}</span>
    </p>
  );
}
