"use client";

import { ShieldAlert, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { LocalDate } from "@/components/feedback-meta";
import { useT } from "@/lib/i18n/provider";
import { useEntitlementsQuery } from "@/lib/store/api";
import { useViewer } from "@/lib/viewer";

/**
 * Licence state for the people who can act on it (instance and workspace admins): a grace-period
 * reminder, or that Enterprise settings are read-only after it (F-098, ADR 0019).
 */
export function LicenseBanner() {
  const t = useT();
  const { data } = useEntitlementsQuery(undefined);
  const { isAdmin, instanceAdmin } = useViewer();
  if (!data || (!isAdmin && !instanceAdmin)) return null;
  if (data.status !== "grace" && data.status !== "expired") return null;
  const expired = data.status === "expired";
  const graceEnds = data.license ? <LocalDate iso={data.license.graceEndsAt} /> : null;
  // The date is an element, so split the sentence around it and keep word order in the catalogue.
  const [graceBefore = "", graceAfter = ""] = t("components2.licenceGrace", { date: "\u0001" }).split(
    "\u0001",
  );
  return (
    <div
      role="status"
      data-testid="license-banner"
      className={
        expired
          ? "flex flex-wrap items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
          : "flex flex-wrap items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-800 dark:text-amber-300"
      }
    >
      {expired ? <ShieldAlert className="size-4 shrink-0" /> : <TriangleAlert className="size-4 shrink-0" />}
      <span className="min-w-0 flex-1">
        {expired ? (
          t("components2.licenceExpired")
        ) : (
          <>
            {graceBefore}
            {graceEnds ?? t("components2.licenceGraceEnds")}
            {graceAfter}
          </>
        )}
      </span>
      {instanceAdmin && (
        <Link href="/settings/license" className="font-medium underline-offset-4 hover:underline">
          {t("components2.manageLicence")}
        </Link>
      )}
    </div>
  );
}
