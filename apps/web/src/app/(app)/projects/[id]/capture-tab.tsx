"use client";

import {
  type CaptureConfigInput,
  captureConfig,
  MAX_REPLAY_SECONDS,
  MIN_REPLAY_SECONDS,
} from "@pinwren/core";
import { useWatch } from "react-hook-form";
import { z } from "zod";
import { controlProps, FieldError, useZodForm } from "@/components/form";
import { Plus, X } from "lucide-react";
import { Segmented } from "@/components/segmented";
import { SettingGroup, SettingRow } from "@/components/setting-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import type { ProjectDetail } from "@/lib/api";
import { sliderValue } from "@/lib/form";
import { useSyncedState } from "@/lib/use-synced-state";
import { useProjectPatch } from "./use-project";

const ALWAYS_MASKED = ["input[type=password]", "[autocomplete^=cc-]", "[data-pinwren-mask]"];

/** A selector to mask: core's rule for one entry, then the browser as the CSS validator. */
const selectorForm = z.object({
  selector: z
    .string()
    .trim()
    .min(1, "Enter a CSS selector")
    .pipe(captureConfig.shape.maskSelectors.unwrap().element.max(200, "200 characters at most"))
    .refine((s) => {
      try {
        document.createDocumentFragment().querySelector(s);
        return true;
      } catch {
        return false;
      }
    }, "That isn't a valid CSS selector"),
});

export function CaptureTab({ project }: { project: ProjectDetail }) {
  const save = useProjectPatch(project.id);
  const c = project.captureConfig;
  const commit = (patch: CaptureConfigInput) =>
    save.mutate({ patch: { captureConfig: patch }, message: "Capture settings saved" });

  return (
    <div className="grid max-w-3xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Diagnostics</CardTitle>
          <CardDescription>
            What the widget records with a bug report. URLs and tokens are redacted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SettingGroup>
            <SettingRow label="Console" description="Which console messages to attach.">
              <Segmented
                label="Console capture"
                value={c.console}
                onChange={(console) => commit({ console })}
                options={[
                  { value: "off", label: "Off" },
                  { value: "errors", label: "Errors" },
                  { value: "warnings", label: "+ Warnings" },
                  { value: "all", label: "All" },
                ]}
              />
            </SettingRow>
            <SettingRow
              label="Network"
              description="Failed and slow requests (status ≥ 400 or network errors)."
            >
              <Segmented
                label="Network capture"
                value={c.network}
                onChange={(network) => commit({ network })}
                options={[
                  { value: "off", label: "Off" },
                  { value: "failures", label: "Failures" },
                ]}
              />
            </SettingRow>
            <SettingRow
              label="Screenshot with every comment"
              htmlFor="shot-on-comment"
              description="Pinned comments also capture the visible page. Bug reports always offer one."
            >
              <Switch
                id="shot-on-comment"
                checked={c.screenshotOnComment}
                onCheckedChange={(screenshotOnComment) => commit({ screenshotOnComment })}
              />
            </SettingRow>
            <SettingRow
              label="Screenshot quality"
              description="High keeps full detail (larger uploads); Low is small and fast. Standard suits most sites."
            >
              <Segmented
                label="Screenshot quality"
                value={c.quality}
                onChange={(quality) => commit({ quality })}
                options={[
                  { value: "high", label: "High" },
                  { value: "standard", label: "Standard" },
                  { value: "low", label: "Low" },
                ]}
              />
            </SettingRow>
            <SettingRow
              label="Let reporters reduce quality"
              htmlFor="allow-reduce-quality"
              description='Adds a "Reduce capture quality" switch to the report form, for people on a slow connection. It sends that one screenshot as Low.'
            >
              <Switch
                id="allow-reduce-quality"
                checked={c.allowReduceQuality}
                onCheckedChange={(allowReduceQuality) => commit({ allowReduceQuality })}
              />
            </SettingRow>
          </SettingGroup>
        </CardContent>
      </Card>
      <ReplayCard
        enabled={c.replay.enabled}
        seconds={c.replay.seconds}
        privacyMode={project.widgetConfig.privacyMode}
        onSave={(replay, message) => save.mutate({ patch: { captureConfig: { replay } }, message })}
      />
      <MaskCard selectors={c.maskSelectors} onSave={(maskSelectors) => commit({ maskSelectors })} />
    </div>
  );
}

function MaskCard({ selectors, onSave }: { selectors: string[]; onSave: (s: string[]) => void }) {
  const form = useZodForm(selectorForm, { defaultValues: { selector: "" } });
  const { errors } = form.formState;
  const draft = useWatch({ control: form.control, name: "selector" });
  const add = form.handleSubmit(({ selector }) => {
    if (selectors.includes(selector)) {
      form.setError("selector", { message: "Already in the list" });
      return;
    }
    if (selectors.length >= 50) {
      form.setError("selector", { message: "50 selectors at most" });
      return;
    }
    form.reset({ selector: "" });
    onSave([...selectors, selector]);
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Masked elements</CardTitle>
        <CardDescription>
          Elements matching these selectors are blanked out in screenshots, before anything leaves the
          browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <p className="text-xs font-medium text-muted-foreground">Always masked</p>
          <ul className="flex flex-wrap gap-1.5">
            {ALWAYS_MASKED.map((s) => (
              <li key={s}>
                <Badge variant="outline" className="h-6 font-mono font-normal text-muted-foreground">
                  {s}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
        <div className="grid gap-2">
          <p className="text-xs font-medium text-muted-foreground">Your selectors</p>
          <ul className="flex flex-wrap gap-1.5" aria-label="Mask selectors">
            {selectors.length === 0 && <li className="text-sm text-muted-foreground">None yet.</li>}
            {selectors.map((s) => (
              <li key={s}>
                <Badge variant="secondary" className="h-6 gap-1 pr-1 font-mono">
                  {s}
                  <button
                    type="button"
                    aria-label={`Remove ${s}`}
                    className="rounded p-0.5 hover:bg-foreground/10"
                    onClick={() => onSave(selectors.filter((x) => x !== s))}
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              </li>
            ))}
          </ul>
        </div>
        <form className="grid gap-1.5" noValidate onSubmit={(e) => void add(e)}>
          <div className="flex gap-2">
            <Input
              {...controlProps("add-selector", errors.selector?.message)}
              {...form.register("selector")}
              placeholder=".customer-email, #account-balance"
              aria-label="Add a selector"
              className="font-mono"
            />
            <Button type="submit" variant="outline" disabled={!draft.trim()}>
              <Plus /> Add
            </Button>
          </div>
          <FieldError id="add-selector" message={errors.selector?.message} />
        </form>
      </CardContent>
    </Card>
  );
}

/** Session replay (F-007, wave-4 §3): the widget keeps a rolling rrweb buffer and attaches it to bug reports. */
function ReplayCard({
  enabled,
  seconds,
  privacyMode,
  onSave,
}: {
  enabled: boolean;
  seconds: number;
  privacyMode: boolean;
  onSave: (replay: { enabled?: boolean; seconds?: number }, message: string) => void;
}) {
  const [draft, setDraft] = useSyncedState(seconds);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Session replay</CardTitle>
        <CardDescription>
          Bug reports carry a replay of the last moments before the report — clicks, scrolls and page changes,
          with every input masked. The reporter can switch it off before sending.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SettingGroup>
          <SettingRow
            label="Record replays"
            htmlFor="replay-enabled"
            description={
              privacyMode
                ? "Privacy mode is on: the widget records only when the site allows it (allowReplayInPrivacyMode)."
                : "Off by default. Replays are stored with the report and count towards its size (up to 10 MB)."
            }
          >
            <Switch
              id="replay-enabled"
              checked={enabled}
              onCheckedChange={(on) =>
                onSave({ enabled: on }, on ? "Session replay on" : "Session replay off")
              }
            />
          </SettingRow>
          <SettingRow
            label="Length"
            description={`How far back a replay reaches: ${MIN_REPLAY_SECONDS}–${MAX_REPLAY_SECONDS} seconds.`}
          >
            <div className="flex w-full items-center gap-3 sm:w-64">
              <Slider
                aria-label="Replay length in seconds"
                min={MIN_REPLAY_SECONDS}
                max={MAX_REPLAY_SECONDS}
                step={10}
                disabled={!enabled}
                value={[draft]}
                onValueChange={(v) => setDraft(sliderValue(v))}
                onValueCommitted={(v) => {
                  const n = sliderValue(v);
                  if (n !== seconds) onSave({ seconds: n }, `Replays keep the last ${n} seconds`);
                }}
              />
              <span className="w-12 shrink-0 text-right text-sm tabular-nums" data-testid="replay-seconds">
                {draft} s
              </span>
            </div>
          </SettingRow>
        </SettingGroup>
      </CardContent>
    </Card>
  );
}
