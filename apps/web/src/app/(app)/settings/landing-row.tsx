"use client";

import { useState } from "react";
import { SettingRow } from "@/components/setting-row";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Key } from "@/lib/i18n/en";
import { useT } from "@/lib/i18n/provider";
import { landingCookie, type Landing, LANDINGS, readLandingCookie } from "@/lib/landing";
import { useUiStateQuery, useUpdateUiStateMutation } from "@/lib/store/api/dashboards";
import { useMounted } from "@/lib/use-synced-state";
import { Skeleton } from "@/components/ui/skeleton";

const LABELS: Record<Landing, Key> = {
  inbox: "landing.inbox",
  dashboard: "landing.dashboard",
  "my-work": "landing.myWork",
};

/**
 * Settings › Profile › Appearance › Start page: which screen `/` opens. It follows the account (ADR 0033); the
 * cookie is the copy the server reads to redirect `/` before anything loads (`UiStateSync` keeps it current).
 */
export function LandingRow() {
  const t = useT();
  const mounted = useMounted();
  // The cookie is only readable in the browser: render the control after hydration.
  const [value, setValue] = useState<Landing | null>(null);
  const account = useUiStateQuery(undefined);
  const [save] = useUpdateUiStateMutation();
  const saved = account.data?.uiState.startPage;
  const current = value ?? saved ?? (mounted ? readLandingCookie(document.cookie) : null);
  const items = LANDINGS.map((l) => ({ value: l, label: t(LABELS[l]) }));

  return (
    <SettingRow label={t("landing.label")} htmlFor="landing-picker" description={t("landing.description")}>
      {current === null ? (
        <Skeleton className="h-8 w-56" />
      ) : (
        <Select
          items={items}
          value={current}
          onValueChange={(v) => {
            const next = LANDINGS.find((l) => l === v);
            if (!next) return;
            document.cookie = landingCookie(next);
            setValue(next);
            void save({ startPage: next });
          }}
        >
          <SelectTrigger id="landing-picker" size="sm" className="w-56" aria-label={t("landing.label")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((i) => (
              <SelectItem key={i.value} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </SettingRow>
  );
}
