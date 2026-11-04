"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/lib/i18n/provider";

export default function ShareLoading() {
  const t = useT();
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6" aria-label={t("share.loading")} aria-busy="true">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-3 h-4 w-72 max-w-full" />
      <Skeleton className="mt-8 h-64 w-full" />
    </main>
  );
}
