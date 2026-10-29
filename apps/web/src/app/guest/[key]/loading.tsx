"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/lib/i18n/provider";

export default function GuestPortalLoading() {
  const t = useT();
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6" aria-label={t("guest.loading")} aria-busy="true">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-3 h-4 w-64 max-w-full" />
      <div className="mt-8 grid gap-6 md:grid-cols-[20rem_1fr]">
        <div className="space-y-3">
          {[1, 2, 3].map((n) => (
            <Skeleton key={n} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    </main>
  );
}
