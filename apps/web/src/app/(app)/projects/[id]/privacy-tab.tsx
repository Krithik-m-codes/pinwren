"use client";

import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { NumberInput } from "@/components/number-input";
import { SettingGroup, SettingRow } from "@/components/setting-row";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ProjectDetail } from "@/lib/api";
import type { Key } from "@/lib/i18n/en";
import { useT } from "@/lib/i18n/provider";
import { useViewer } from "@/lib/viewer";
import { DataExportCard, EraseReporterCard } from "./privacy-data";
import { useProjectPatch } from "./use-project";

const RETENTION = [
  { value: "forever", label: "projects2.keepForever" },
  { value: "30", label: "projects2.days30" },
  { value: "90", label: "projects2.days90" },
  { value: "180", label: "projects2.months6" },
  { value: "365", label: "projects2.year1" },
  { value: "730", label: "projects2.years2" },
  { value: "custom", label: "projects2.custom" },
] as const satisfies readonly { value: string; label: Key }[];

export function PrivacyTab({ project: p }: { project: ProjectDetail }) {
  const t = useT();
  const save = useProjectPatch(p.id);
  const preset = p.retentionDays === null ? "forever" : String(p.retentionDays);
  const isPreset = RETENTION.some((r) => r.value === preset);
  const [custom, setCustom] = useState(!isPreset);
  const retentionValue = custom ? "custom" : preset;

  const privacy = p.widgetConfig.privacyMode;
  const { isAdmin } = useViewer();

  return (
    <div className="grid max-w-3xl gap-4">
      <Card className={privacy ? "ring-1 ring-emerald-500/40" : undefined}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className={privacy ? "size-4 text-emerald-600" : "size-4 text-muted-foreground"} />
            {t("projects2.euPrivacyMode")}
          </CardTitle>
          <CardDescription>{t("projects2.euPrivacyModeDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingRow
            label={t("projects2.privacyMode")}
            htmlFor="privacy-mode"
            description={t("projects2.privacyModeDescription")}
          >
            <Switch
              id="privacy-mode"
              checked={privacy}
              onCheckedChange={(privacyMode) =>
                save.mutate({
                  patch: { widgetConfig: { privacyMode } },
                  message: privacyMode ? t("projects2.privacyModeOn") : t("projects2.privacyModeOff"),
                })
              }
            />
          </SettingRow>
          <ul
            className="mt-3 grid gap-1.5 text-sm text-muted-foreground sm:grid-cols-2"
            aria-label={t("projects2.whatPrivacyModeDoes")}
          >
            {[
              t("projects2.privacyBullet1"),
              t("projects2.privacyBullet2"),
              t("projects2.privacyBullet3"),
              t("projects2.privacyBullet4"),
              t("projects2.privacyBullet5"),
              t("projects2.privacyBullet6"),
              t("projects2.privacyBullet7"),
            ].map((bullet) => (
              <li key={bullet} className="flex items-start gap-2">
                <span
                  className={`mt-1.5 size-1.5 shrink-0 rounded-full ${privacy ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
                />
                {bullet}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("projects2.visibility")}</CardTitle>
          <CardDescription>{t("projects2.visibilityDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingRow
            label={t("projects2.showExistingPins")}
            htmlFor="public-read"
            description={t("projects2.showExistingPinsDescription")}
          >
            <Switch
              id="public-read"
              checked={p.publicRead}
              onCheckedChange={(publicRead) => save.mutate({ patch: { publicRead } })}
            />
          </SettingRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("projects2.data")}</CardTitle>
          <CardDescription>{t("projects2.dataDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingGroup>
            <SettingRow label={t("projects2.retention")} description={t("projects2.retentionDescription")}>
              <div className="flex flex-wrap items-start gap-2">
                <Select
                  items={RETENTION.map((r) => ({ value: r.value, label: t(r.label) }))}
                  value={retentionValue}
                  onValueChange={(v) => {
                    if (!v) return;
                    if (v === "custom") {
                      setCustom(true);
                      return;
                    }
                    setCustom(false);
                    const days = v === "forever" ? null : Number(v);
                    save.mutate({
                      patch: { retentionDays: days },
                      message: days
                        ? t("projects2.feedbackKeptDays", { days })
                        : t("projects2.feedbackKeptForever"),
                    });
                  }}
                >
                  <SelectTrigger className="w-40" aria-label={t("projects2.retention")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RETENTION.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {t(r.label)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {retentionValue === "custom" && (
                  <NumberInput
                    aria-label={t("projects2.retentionInDays")}
                    className="w-28"
                    value={p.retentionDays}
                    placeholder="60"
                    min={1}
                    max={3650}
                    suffix={t("projects2.days")}
                    onCommit={(retentionDays) =>
                      retentionDays !== null &&
                      retentionDays !== p.retentionDays &&
                      save.mutate({
                        patch: { retentionDays },
                        message: t("projects2.feedbackKeptDays", { days: retentionDays }),
                      })
                    }
                  />
                )}
              </div>
            </SettingRow>
          </SettingGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("projects2.abuseProtection")}</CardTitle>
          <CardDescription>{t("projects2.abuseProtectionDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingGroup>
            <SettingRow
              label={t("projects2.useInstanceDefault")}
              htmlFor="rate-default"
              description={t("projects2.useInstanceDefaultDescription")}
            >
              <Switch
                id="rate-default"
                checked={p.widgetRateLimitPerMin === null}
                onCheckedChange={(useDefault) =>
                  save.mutate({ patch: { widgetRateLimitPerMin: useDefault ? null : 10 } })
                }
              />
            </SettingRow>
            <SettingRow
              label={t("projects2.reportsPerMinute")}
              htmlFor="rate-limit"
              description={t("projects2.reportsPerMinuteDescription")}
            >
              <NumberInput
                id="rate-limit"
                className="w-32"
                value={p.widgetRateLimitPerMin}
                placeholder={t("projects2.default")}
                disabled={p.widgetRateLimitPerMin === null}
                min={1}
                max={1000}
                suffix={t("projects2.perMinSuffix")}
                onCommit={(n) =>
                  n !== null &&
                  n !== p.widgetRateLimitPerMin &&
                  save.mutate({
                    patch: { widgetRateLimitPerMin: n },
                    message: t("projects2.limitSet", { n }),
                  })
                }
              />
            </SettingRow>
          </SettingGroup>
        </CardContent>
      </Card>
      {isAdmin && <DataExportCard project={p} />}
      {isAdmin && <EraseReporterCard />}
    </div>
  );
}
