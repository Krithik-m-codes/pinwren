"use client";

import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { NumberInput } from "@/components/number-input";
import { SettingGroup, SettingRow } from "@/components/setting-row";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ProjectDetail } from "@/lib/api";
import { useProjectPatch } from "./use-project";

const RETENTION = [
  { value: "forever", label: "Keep forever" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "180", label: "6 months" },
  { value: "365", label: "1 year" },
  { value: "730", label: "2 years" },
  { value: "custom", label: "Custom…" },
];

export function PrivacyTab({ project: p }: { project: ProjectDetail }) {
  const save = useProjectPatch(p.id);
  const preset = p.retentionDays === null ? "forever" : String(p.retentionDays);
  const isPreset = RETENTION.some((r) => r.value === preset);
  const [custom, setCustom] = useState(!isPreset);
  const retentionValue = custom ? "custom" : preset;

  const privacy = p.widgetConfig.privacyMode;

  return (
    <div className="grid max-w-3xl gap-4">
      <Card className={privacy ? "ring-1 ring-emerald-500/40" : undefined}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className={privacy ? "size-4 text-emerald-600" : "size-4 text-muted-foreground"} />
            EU privacy mode
          </CardTitle>
          <CardDescription>One switch for stricter data handling on this project.</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingRow
            label="Privacy mode"
            htmlFor="privacy-mode"
            description="For sites that must keep visitor data to a minimum (GDPR). Turning it on:"
          >
            <Switch
              id="privacy-mode"
              checked={privacy}
              onCheckedChange={(privacyMode) =>
                save.mutate({
                  patch: { widgetConfig: { privacyMode } },
                  message: privacyMode ? "Privacy mode on" : "Privacy mode off",
                })
              }
            />
          </SettingRow>
          <ul
            className="mt-3 grid gap-1.5 text-sm text-muted-foreground sm:grid-cols-2"
            aria-label="What privacy mode does"
          >
            {[
              "Shows the consent notice before anything is sent",
              "Masks every text field in screenshots",
              "Keeps console errors only — no warnings or logs",
              "Stores only the browser and OS family, no performance data",
              "Truncates visitor IP addresses (/24, /48) before they are stored",
              "Turns off the instance's update check (no third-party calls)",
              "Shortens “keep forever” retention to 90 days",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2">
                <span
                  className={`mt-1.5 size-1.5 shrink-0 rounded-full ${privacy ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
                />
                {t}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Visibility</CardTitle>
          <CardDescription>What visitors on your site can see.</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingRow
            label="Show existing pins to visitors"
            htmlFor="public-read"
            description="Reviewers see each other's comments on the page. Turn off for private bug reporting."
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
          <CardTitle>Data</CardTitle>
          <CardDescription>How long feedback is kept, and who hears about changes.</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingGroup>
            <SettingRow
              label="Retention"
              description="Feedback older than this is deleted with its screenshots and files by a daily job."
            >
              <div className="flex flex-wrap items-start gap-2">
                <Select
                  items={RETENTION}
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
                      message: days ? `Feedback is kept for ${days} days` : "Feedback is kept forever",
                    });
                  }}
                >
                  <SelectTrigger className="w-40" aria-label="Retention">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RETENTION.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {retentionValue === "custom" && (
                  <NumberInput
                    aria-label="Retention in days"
                    className="w-28"
                    value={p.retentionDays}
                    placeholder="60"
                    min={1}
                    max={3650}
                    suffix="days"
                    onCommit={(retentionDays) =>
                      retentionDays !== null &&
                      retentionDays !== p.retentionDays &&
                      save.mutate({
                        patch: { retentionDays },
                        message: `Feedback is kept for ${retentionDays} days`,
                      })
                    }
                  />
                )}
              </div>
            </SettingRow>
            <SettingRow
              label="Email the reporter"
              htmlFor="notify-reporter"
              description="When a reporter left an address, email them about public replies and status changes."
            >
              <Switch
                id="notify-reporter"
                checked={p.notifyReporter}
                onCheckedChange={(notifyReporter) => save.mutate({ patch: { notifyReporter } })}
              />
            </SettingRow>
          </SettingGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Abuse protection</CardTitle>
          <CardDescription>Limits what one visitor can send.</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingGroup>
            <SettingRow
              label="Use the instance default"
              htmlFor="rate-default"
              description="The server's WIDGET_RATE_LIMIT_PER_MIN (10 unless your admin changed it)."
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
              label="Reports and replies per minute"
              htmlFor="rate-limit"
              description="Per visitor IP address. Between 1 and 1000."
            >
              <NumberInput
                id="rate-limit"
                className="w-32"
                value={p.widgetRateLimitPerMin}
                placeholder="Default"
                disabled={p.widgetRateLimitPerMin === null}
                min={1}
                max={1000}
                suffix="/ min"
                onCommit={(n) =>
                  n !== null &&
                  n !== p.widgetRateLimitPerMin &&
                  save.mutate({
                    patch: { widgetRateLimitPerMin: n },
                    message: `Limit set to ${n} per minute`,
                  })
                }
              />
            </SettingRow>
          </SettingGroup>
        </CardContent>
      </Card>
    </div>
  );
}
