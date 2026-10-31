"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/provider";
import { useBillingQuery, useEntitlementsQuery } from "@/lib/store/api";
import { useViewer } from "@/lib/viewer";

/**
 * Failed renewal on Pinwren Cloud (WP-22 dunning): workspace admins see how long Pro is kept, or that the
 * workspace is back on Free limits. Fetches billing only for admins of a Cloud workspace with billing on.
 */
export function BillingBanner() {
  const { t, tn } = useI18n();
  const { isAdmin } = useViewer();
  const cloud = useEntitlementsQuery(undefined).data?.edition === "cloud";
  const { data } = useBillingQuery(undefined, { skip: !cloud || !isAdmin });
  if (!data?.dunning) return null;
  return (
    <div
      role="status"
      data-testid="billing-banner"
      className="flex flex-wrap items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
    >
      <TriangleAlert className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        {data.dunning.downgraded ? t("billing.downgraded") : tn("billing.pastDue", data.dunning.daysLeft)}
      </span>
      <Link href="/settings/billing" className="font-medium underline-offset-4 hover:underline">
        {t("billing.fixPayment")}
      </Link>
    </div>
  );
}
