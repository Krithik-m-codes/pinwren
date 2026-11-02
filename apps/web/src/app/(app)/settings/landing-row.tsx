"use client";

import { useState } from "react";
import { SettingRow } from "@/components/setting-row";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Key } from "@/lib/i18n/en";
import { useT } from "@/lib/i18n/provider";
import { landingCookie, type Landing, LANDINGS, readLandingCookie } from "@/lib/landing";
import { useMounted } from "@/lib/use-synced-state";
import { Skeleton } from "@/components/ui/skeleton";

const LABELS: Record<Landing, Key> = {
  inbox: "landing.inbox",
  dashboard: "landing.dashboard",
  "my-work": "landing.myWork",
};

/** Settings › Profile › Appearance › Start page: which screen `/` opens on this device. */
export function LandingRow() {
  const t = useT();
  const mounted = useMounted();
  // The cookie is only readable in the browser: render the control after hydration.
  const [value, setValue] = useState<Landing | null>(null);
  const current = value ?? (mounted ? readLandingCookie(document.cookie) : null);
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
