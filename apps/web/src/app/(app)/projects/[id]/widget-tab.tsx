"use client";

import { mergeConfig, type WidgetConfig, type WidgetConfigInput, widgetConfig } from "@pinwren/core";
import { useState } from "react";
import { ColorPicker } from "@/components/color-picker";
import { NumberInput } from "@/components/number-input";
import { Segmented } from "@/components/segmented";
import { SettingGroup, SettingRow } from "@/components/setting-row";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ProjectDetail } from "@/lib/api";
import type { Key } from "@/lib/i18n/en";
import { useI18n, useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { LAUNCHER_ICONS, LauncherPreview } from "./launcher-preview";
import { useProjectPatch } from "./use-project";
import { ActiveRoundCard } from "./active-round-card";
import { ReporterEmailsCard } from "./reporter-emails-card";
import { WidgetBrandingCard } from "./widget-branding-card";
import { useSyncedState } from "@/lib/use-synced-state";
import { sliderValue } from "@/lib/form";

const POSITIONS = [
  { value: "top-left", label: "projects2.topLeft" },
  { value: "top-right", label: "projects2.topRight" },
  { value: "bottom-left", label: "projects2.bottomLeft" },
  { value: "bottom-right", label: "projects2.bottomRight" },
] as const satisfies readonly { value: string; label: Key }[];

const ICON_TITLES = {
  pin: "projects2.iconPin",
  comment: "projects2.iconComment",
  bug: "projects2.iconBug",
} as const;

type Errors = Record<string, string>;

/**
 * Every `WidgetConfig` field (wave-1 contract §1) with a live launcher preview. Toggles save at once;
 * text saves on blur / Enter. Each change is validated against the core schema before it is sent.
 */
export function WidgetTab({ project }: { project: ProjectDetail }) {
  const { t, tm } = useI18n();
  const save = useProjectPatch(project.id);
  const server = project.widgetConfig;
  const serverKey = JSON.stringify(server);
  // Re-synced only when the saved config changes by value, not on every refetch.
  const [draft, setDraft] = useSyncedState<WidgetConfig>(server, serverKey);
  const [errors, setErrors] = useState<Errors>({});

  /** Preview-only change (typing, dragging). */
  const preview = (patch: WidgetConfigInput) =>
    setDraft((d) => mergeConfig(d, patch) as unknown as WidgetConfig);

  /** Validate the merged config, then save. Errors are keyed by the failing path. */
  const commit = (patch: WidgetConfigInput, message = t("projects2.widgetSettingsSaved")) => {
    preview(patch);
    const parsed = widgetConfig.safeParse(mergeConfig(server, patch));
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) next[issue.path.join(".")] = tm(issue.message);
      setErrors(next);
      return;
    }
    setErrors({});
    save.mutate({ patch: { widgetConfig: patch }, message });
  };

  const l = draft.launcher;
  const textCommit = (path: "label" | "tooltip", raw: string) => {
    const v = raw.trim();
    if ((v || null) === server.launcher[path]) return;
    commit({ launcher: { [path]: v || null } });
  };

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid min-w-0 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{t("projects2.launcher")}</CardTitle>
            <CardDescription>{t("projects2.launcherDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <SettingGroup>
              <SettingRow label={t("projects2.position")} description={t("projects2.positionDescription")}>
                <div
                  className="grid w-44 grid-cols-2 gap-1 rounded-lg bg-muted p-1"
                  role="radiogroup"
                  aria-label={t("projects2.position")}
                >
                  {POSITIONS.map((p) => {
                    const active = l.position === p.value;
                    const [v, h] = p.value.split("-");
                    return (
                      // A button, not a native radio: styled radio needs a button for the corner glyph
                      <button
                        key={p.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        aria-label={t(p.label)}
                        onClick={() => !active && commit({ launcher: { position: p.value } })}
                        className={cn(
                          "relative h-10 rounded-md border border-transparent transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                          active
                            ? "border-border bg-background shadow-xs dark:bg-input/50"
                            : "hover:bg-background/60",
                        )}
                      >
                        <span
                          className={cn(
                            "absolute size-2.5 rounded-full",
                            v === "top" ? "top-1.5" : "bottom-1.5",
                            h === "left" ? "left-1.5" : "right-1.5",
                            active ? "bg-foreground" : "bg-muted-foreground/40",
                          )}
                          style={active ? { background: l.accent } : undefined}
                        />
                      </button>
                    );
                  })}
                </div>
              </SettingRow>
              <SettingRow
                label={t("projects2.distanceFromEdge")}
                description={t("projects2.distanceFromEdgeDescription")}
              >
                <div className="grid w-full gap-3 sm:w-64">
                  {(["x", "y"] as const).map((axis) => (
                    <div key={axis} className="flex items-center gap-3">
                      <span className="w-3 text-xs text-muted-foreground uppercase">{axis}</span>
                      <Slider
                        aria-label={t("projects2.offsetAxis", { axis })}
                        min={0}
                        max={200}
                        value={[Math.min(l.offset[axis], 200)]}
                        onValueChange={(val) =>
                          preview({ launcher: { offset: { [axis]: sliderValue(val) } } })
                        }
                        onValueCommitted={(val) =>
                          commit({ launcher: { offset: { [axis]: sliderValue(val) } } })
                        }
                      />
                      <NumberInput
                        aria-label={t("projects2.offsetAxisPixels", { axis })}
                        className="w-20 shrink-0"
                        value={l.offset[axis]}
                        min={0}
                        max={400}
                        suffix="px"
                        onChange={(n) => preview({ launcher: { offset: { [axis]: n } } })}
                        onCommit={(n) =>
                          n !== null &&
                          n !== server.launcher.offset[axis] &&
                          commit({ launcher: { offset: { [axis]: n } } })
                        }
                      />
                    </div>
                  ))}
                </div>
              </SettingRow>
              <SettingRow label={t("projects2.shape")} description={t("projects2.shapeDescription")}>
                <Segmented
                  label={t("projects2.shape")}
                  value={l.shape}
                  onChange={(shape) => commit({ launcher: { shape } })}
                  options={[
                    { value: "round", label: t("projects2.round") },
                    { value: "pill", label: t("projects2.pill") },
                  ]}
                />
              </SettingRow>
              <SettingRow
                label={t("projects2.pillLabel")}
                htmlFor="launcher-label"
                description={
                  l.shape === "pill" ? t("projects2.upTo40Characters") : t("projects2.shownWhenPill")
                }
              >
                <div className="grid w-full gap-1 sm:w-64">
                  <Input
                    id="launcher-label"
                    defaultValue={l.label ?? ""}
                    key={`label-${server.launcher.label ?? ""}`}
                    maxLength={40}
                    disabled={l.shape !== "pill"}
                    placeholder={t("projects2.feedback")}
                    aria-invalid={!!errors["launcher.label"] || undefined}
                    onChange={(e) => preview({ launcher: { label: e.target.value || null } })}
                    onBlur={(e) => textCommit("label", e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && textCommit("label", e.currentTarget.value)}
                  />
                  {errors["launcher.label"] && (
                    <p className="text-xs text-destructive">{errors["launcher.label"]}</p>
                  )}
                </div>
              </SettingRow>
              <SettingRow label={t("projects2.icon")}>
                <Segmented
                  label={t("projects2.icon")}
                  value={l.icon}
                  onChange={(icon) => commit({ launcher: { icon } })}
                  options={(["pin", "comment", "bug"] as const).map((k) => {
                    const Icon = LAUNCHER_ICONS[k];
                    return { value: k, title: t(ICON_TITLES[k]), label: <Icon /> };
                  })}
                />
              </SettingRow>
              <SettingRow
                label={t("projects2.accentColour")}
                description={t("projects2.accentColourDescription")}
              >
                <div className="grid gap-1">
                  <ColorPicker
                    id="accent"
                    value={l.accent}
                    onChange={(accent) => preview({ launcher: { accent } })}
                    onCommit={(accent) =>
                      accent !== server.launcher.accent && commit({ launcher: { accent } })
                    }
                  />
                  {errors["launcher.accent"] && (
                    <p className="text-xs text-destructive">{errors["launcher.accent"]}</p>
                  )}
                </div>
              </SettingRow>
              <SettingRow
                label={t("projects2.tooltip")}
                htmlFor="launcher-tooltip"
                description={t("projects2.tooltipDescription")}
              >
                <div className="grid w-full gap-1 sm:w-64">
                  <Input
                    id="launcher-tooltip"
                    defaultValue={l.tooltip ?? ""}
                    key={`tooltip-${server.launcher.tooltip ?? ""}`}
                    maxLength={80}
                    placeholder={t("projects2.noTooltip")}
                    onChange={(e) => preview({ launcher: { tooltip: e.target.value || null } })}
                    onBlur={(e) => textCommit("tooltip", e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && textCommit("tooltip", e.currentTarget.value)}
                  />
                  {errors["launcher.tooltip"] && (
                    <p className="text-xs text-destructive">{errors["launcher.tooltip"]}</p>
                  )}
                </div>
              </SettingRow>
              <SettingRow
                label={t("projects2.hideLauncher")}
                htmlFor="launcher-hidden"
                description={t("projects2.hideLauncherDescription")}
              >
                <Switch
                  id="launcher-hidden"
                  checked={l.hidden}
                  onCheckedChange={(hidden) => commit({ launcher: { hidden } })}
                />
              </SettingRow>
            </SettingGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("projects2.behaviour")}</CardTitle>
            <CardDescription>{t("projects2.behaviourDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <SettingGroup>
              <SettingRow
                label={t("projects2.pinnedComments")}
                htmlFor="mode-comment"
                description={t("projects2.pinnedCommentsDescription")}
              >
                <Switch
                  id="mode-comment"
                  checked={draft.modes.comment}
                  onCheckedChange={(comment) => commit({ modes: { comment } })}
                />
              </SettingRow>
              <SettingRow
                label={t("projects2.bugReports")}
                htmlFor="mode-bug"
                description={t("projects2.bugReportsDescription")}
              >
                <Switch
                  id="mode-bug"
                  checked={draft.modes.bug}
                  onCheckedChange={(bug) => commit({ modes: { bug } })}
                />
              </SettingRow>
              <SettingRow
                label={t("projects2.keyboardShortcuts")}
                htmlFor="shortcuts"
                description={
                  <>
                    <kbd className="font-mono">C</kbd> {t("projects2.shortcutComment")}{" "}
                    <kbd className="font-mono">B</kbd> {t("projects2.shortcutBug")}{" "}
                    <kbd className="font-mono">Esc</kbd> {t("projects2.shortcutCancel")}
                  </>
                }
              >
                <Switch
                  id="shortcuts"
                  checked={draft.shortcuts}
                  onCheckedChange={(shortcuts) => commit({ shortcuts })}
                />
              </SettingRow>
              <SettingRow
                label={t("projects2.rightClickToComment")}
                htmlFor="right-click"
                description={t("projects2.rightClickDescription")}
              >
                <Switch
                  id="right-click"
                  checked={draft.rightClickComment}
                  onCheckedChange={(rightClickComment) => commit({ rightClickComment })}
                />
              </SettingRow>
              <SettingRow
                label={t("projects2.readOnly")}
                htmlFor="read-only"
                description={t("projects2.readOnlyDescription")}
              >
                <Switch
                  id="read-only"
                  checked={draft.readOnly}
                  onCheckedChange={(readOnly) => commit({ readOnly })}
                />
              </SettingRow>
              <SettingRow
                label={t("projects2.visitorsCanResolve")}
                htmlFor="visitors-resolve"
                description={
                  project.publicRead
                    ? t("projects2.visitorsResolvePublic")
                    : t("projects2.visitorsResolveNeedsPublic")
                }
              >
                <Switch
                  id="visitors-resolve"
                  checked={draft.visitorsCanResolve}
                  onCheckedChange={(visitorsCanResolve) => commit({ visitorsCanResolve })}
                />
              </SettingRow>
            </SettingGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("projects2.whereItShows")}</CardTitle>
            <CardDescription>
              {t("projects2.whereItShowsDescription")}{" "}
              <code className="font-mono text-xs">data-force-show</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SettingGroup>
              <SettingRow
                label={t("projects2.environments")}
                description={
                  draft.visibility.environments === "non-production"
                    ? t("projects2.environmentsNonProduction")
                    : t("projects2.environmentsAll")
                }
              >
                <Segmented
                  label={t("projects2.environments")}
                  value={draft.visibility.environments}
                  onChange={(environments) => commit({ visibility: { environments } })}
                  options={[
                    { value: "all", label: t("projects2.everywhere") },
                    { value: "non-production", label: t("projects2.notInProduction") },
                  ]}
                />
              </SettingRow>
              <SettingRow
                label={t("projects2.minimumScreenWidth")}
                htmlFor="min-viewport"
                description={t("projects2.minimumScreenWidthDescription")}
              >
                <div className="grid gap-1">
                  <NumberInput
                    id="min-viewport"
                    className="w-32"
                    value={draft.visibility.minViewportWidth}
                    min={0}
                    max={10000}
                    suffix="px"
                    onCommit={(n) =>
                      n !== null &&
                      n !== server.visibility.minViewportWidth &&
                      commit({ visibility: { minViewportWidth: n } })
                    }
                  />
                  {errors["visibility.minViewportWidth"] && (
                    <p className="text-xs text-destructive">{errors["visibility.minViewportWidth"]}</p>
                  )}
                </div>
              </SettingRow>
            </SettingGroup>
          </CardContent>
        </Card>

        <ActiveRoundCard project={project} />
        <ReporterEmailsCard project={project} />

        <ConsentCard draft={draft} server={server} errors={errors} preview={preview} commit={commit} />
        <WidgetBrandingCard project={project} />
      </div>

      <div className="lg:sticky lg:top-16">
        <p className="mb-2 text-xs font-medium text-muted-foreground">{t("projects2.livePreview")}</p>
        <LauncherPreview config={draft} />
        <p className="mt-2 text-xs text-muted-foreground">{t("projects2.changesReachSite")}</p>
      </div>
    </div>
  );
}

function ConsentCard({
  draft,
  server,
  errors,
  preview,
  commit,
}: {
  draft: WidgetConfig;
  server: WidgetConfig;
  errors: Errors;
  preview: (p: WidgetConfigInput) => void;
  commit: (p: WidgetConfigInput, message?: string) => void;
}) {
  const t = useT();
  const c = draft.consent;
  const [urlError, setUrlError] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("projects2.consentNotice")}</CardTitle>
        <CardDescription>{t("projects2.consentNoticeDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <SettingGroup>
          <SettingRow
            label={t("projects2.askForConsent")}
            htmlFor="consent-enabled"
            description={
              draft.privacyMode ? t("projects2.consentAlwaysShown") : t("projects2.consentShownOnce")
            }
          >
            <Switch
              id="consent-enabled"
              checked={c.enabled || draft.privacyMode}
              disabled={draft.privacyMode}
              onCheckedChange={(enabled) => commit({ consent: { enabled } })}
            />
          </SettingRow>
          <SettingRow
            label={t("projects2.noticeText")}
            htmlFor="consent-text"
            description={t("projects2.noticeTextDescription")}
            stack
          >
            <Textarea
              id="consent-text"
              rows={3}
              maxLength={1000}
              disabled={!c.enabled && !draft.privacyMode}
              key={`consent-${server.consent.text ?? ""}`}
              defaultValue={c.text ?? ""}
              placeholder={t("projects2.consentPlaceholder")}
              onChange={(e) => preview({ consent: { text: e.target.value || null } })}
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v !== server.consent.text) commit({ consent: { text: v } });
              }}
            />
            {errors["consent.text"] && (
              <p className="mt-1 text-xs text-destructive">{errors["consent.text"]}</p>
            )}
          </SettingRow>
          <SettingRow
            label={t("projects2.privacyPolicyLink")}
            htmlFor="consent-url"
            description={t("projects2.privacyPolicyLinkDescription")}
          >
            <div className="grid w-full gap-1 sm:w-72">
              <Input
                id="consent-url"
                type="url"
                inputMode="url"
                disabled={!c.enabled && !draft.privacyMode}
                key={`url-${server.consent.privacyUrl ?? ""}`}
                defaultValue={c.privacyUrl ?? ""}
                placeholder="https://example.com/privacy"
                aria-invalid={!!(urlError ?? errors["consent.privacyUrl"]) || undefined}
                onChange={() => setUrlError(null)}
                onBlur={(e) => {
                  const v = e.target.value.trim() || null;
                  if (v && !/^https?:\/\/[^\s]+\.[^\s]+/.test(v)) {
                    setUrlError(t("projects2.enterFullUrl"));
                    return;
                  }
                  if (v !== server.consent.privacyUrl) commit({ consent: { privacyUrl: v } });
                }}
              />
              {(urlError ?? errors["consent.privacyUrl"]) && (
                <p className="text-xs text-destructive">{urlError ?? errors["consent.privacyUrl"]}</p>
              )}
            </div>
          </SettingRow>
        </SettingGroup>
      </CardContent>
    </Card>
  );
}
