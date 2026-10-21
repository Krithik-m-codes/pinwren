"use client";

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

  return (
    <div className="grid max-w-3xl gap-4">
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
