"use client";

import { useSearchParams } from "next/navigation";
import { Dashboard } from "@/components/dashboard/dashboard";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n/provider";

/** The workspace home: the full, customisable dashboard. `?edit=1` opens it in edit mode (command palette). */
export function DashboardView() {
  const { t } = useI18n();
  const edit = useSearchParams().get("edit") === "1";
  return (
    <>
      <PageHeader title={t("dash.title")} />
      <div className="p-3">
        <Dashboard scope="home" startEditing={edit} />
      </div>
    </>
  );
}
