"use client";

import {
  type CaptureConfigInput,
  captureConfig,
  MAX_REPLAY_SECONDS,
  MIN_REPLAY_SECONDS,
} from "@pinwren/core";
import { useMemo } from "react";
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
import type { TFn } from "@/lib/i18n/english";
import { useT } from "@/lib/i18n/provider";
import { useSyncedState } from "@/lib/use-synced-state";
import { useProjectPatch } from "./use-project";

const ALWAYS_MASKED = ["input[type=password]", "[autocomplete^=cc-]", "[data-pinwren-mask]"];

/** A selector to mask: core's rule for one entry, then the browser as the CSS validator. */
const selectorForm = (t: TFn) =>
  z.object({
    selector: z
      .string()
      .trim()
      .min(1, t("projects1.enterSelector"))
      .pipe(captureConfig.shape.maskSelectors.unwrap().element.max(200, t("projects1.selectorMax200")))
      .refine((s) => {
        try {
          document.createDocumentFragment().querySelector(s);
          return true;
        } catch {
          return false;
        }
      }, t("projects1.invalidSelector")),
  });

export function CaptureTab({ project }: { project: ProjectDetail }) {
  const t = useT();
  const save = useProjectPatch(project.id);
  const c = project.captureConfig;
  const commit = (patch: CaptureConfigInput) =>
    save.mutate({ patch: { captureConfig: patch }, message: t("projects1.captureSettingsSaved") });

  return (
    <div className="grid max-w-3xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("projects1.diagnostics")}</CardTitle>
          <CardDescription>{t("projects1.diagnosticsDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingGroup>
            <SettingRow label={t("projects1.console")} description={t("projects1.consoleDescription")}>
              <Segmented
                label={t("projects1.consoleCapture")}
                value={c.console}
                onChange={(console) => commit({ console })}
                options={[
                  { value: "off", label: t("projects1.off") },
                  { value: "errors", label: t("projects1.errors") },
                  { value: "warnings", label: t("projects1.plusWarnings") },
                  { value: "all", label: t("projects1.all") },
                ]}
              />
            </SettingRow>
            <SettingRow label={t("projects1.network")} description={t("projects1.networkDescription")}>
              <Segmented
                label={t("projects1.networkCapture")}
                value={c.network}
                onChange={(network) => commit({ network })}
                options={[
                  { value: "off", label: t("projects1.off") },
                  { value: "failures", label: t("projects1.failures") },
                ]}
              />
            </SettingRow>
            <SettingRow
              label={t("projects1.screenshotEveryComment")}
              htmlFor="shot-on-comment"
              description={t("projects1.screenshotEveryCommentDescription")}
            >
              <Switch
                id="shot-on-comment"
                checked={c.screenshotOnComment}
                onCheckedChange={(screenshotOnComment) => commit({ screenshotOnComment })}
              />
            </SettingRow>
            <SettingRow
              label={t("projects1.screenshotQuality")}
              description={t("projects1.screenshotQualityDescription")}
            >
              <Segmented
                label={t("projects1.screenshotQuality")}
                value={c.quality}
                onChange={(quality) => commit({ quality })}
                options={[
                  { value: "high", label: t("projects1.high") },
                  { value: "standard", label: t("projects1.standard") },
                  { value: "low", label: t("projects1.low") },
                ]}
              />
            </SettingRow>
            <SettingRow
              label={t("projects1.reduceQualityLabel")}
              htmlFor="allow-reduce-quality"
              description={t("projects1.reduceQualityDescription")}
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
  const t = useT();
  const schema = useMemo(() => selectorForm(t), [t]);
  const form = useZodForm(schema, { defaultValues: { selector: "" } });
  const { errors } = form.formState;
  const draft = useWatch({ control: form.control, name: "selector" });
  const add = form.handleSubmit(({ selector }) => {
    if (selectors.includes(selector)) {
      form.setError("selector", { message: t("projects1.alreadyInList") });
      return;
    }
    if (selectors.length >= 50) {
      form.setError("selector", { message: t("projects1.maxSelectors") });
      return;
    }
    form.reset({ selector: "" });
    onSave([...selectors, selector]);
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("projects1.maskedElements")}</CardTitle>
        <CardDescription>{t("projects1.maskedElementsDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <p className="text-xs font-medium text-muted-foreground">{t("projects1.alwaysMasked")}</p>
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
          <p className="text-xs font-medium text-muted-foreground">{t("projects1.yourSelectors")}</p>
          <ul className="flex flex-wrap gap-1.5" aria-label={t("projects1.maskSelectors")}>
            {selectors.length === 0 && (
              <li className="text-sm text-muted-foreground">{t("projects1.noneYet")}</li>
            )}
            {selectors.map((s) => (
              <li key={s}>
                <Badge variant="secondary" className="h-6 gap-1 pr-1 font-mono">
                  {s}
                  <button
                    type="button"
                    aria-label={t("projects1.removeSelector", { selector: s })}
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
              aria-label={t("projects1.addASelector")}
              className="font-mono"
            />
            <Button type="submit" variant="outline" disabled={!draft.trim()}>
              <Plus /> {t("projects1.add")}
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
  const t = useT();
  const [draft, setDraft] = useSyncedState(seconds);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("projects1.sessionReplay")}</CardTitle>
        <CardDescription>{t("projects1.sessionReplayDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <SettingGroup>
          <SettingRow
            label={t("projects1.recordReplays")}
            htmlFor="replay-enabled"
            description={privacyMode ? t("projects1.replayPrivacyOn") : t("projects1.replayOffByDefault")}
          >
            <Switch
              id="replay-enabled"
              checked={enabled}
              onCheckedChange={(on) =>
                onSave({ enabled: on }, on ? t("projects1.replayOn") : t("projects1.replayOff"))
              }
            />
          </SettingRow>
          <SettingRow
            label={t("projects1.length")}
            description={t("projects1.replayLengthDescription", {
              min: MIN_REPLAY_SECONDS,
              max: MAX_REPLAY_SECONDS,
            })}
          >
            <div className="flex w-full items-center gap-3 sm:w-64">
              <Slider
                aria-label={t("projects1.replayLengthAria")}
                min={MIN_REPLAY_SECONDS}
                max={MAX_REPLAY_SECONDS}
                step={10}
                disabled={!enabled}
                value={[draft]}
                onValueChange={(v) => setDraft(sliderValue(v))}
                onValueCommitted={(v) => {
                  const n = sliderValue(v);
                  if (n !== seconds) onSave({ seconds: n }, t("projects1.replayKeeps", { n }));
                }}
              />
              <span className="w-12 shrink-0 text-right text-sm tabular-nums" data-testid="replay-seconds">
                {t("projects1.secondsShort", { n: draft })}
              </span>
            </div>
          </SettingRow>
        </SettingGroup>
      </CardContent>
    </Card>
  );
}
