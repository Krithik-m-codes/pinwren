"use client";

import { mergeConfig, type WidgetConfig, type WidgetConfigInput, widgetConfig } from "@annota/core";
import { useEffect, useState } from "react";
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
import { cn } from "@/lib/utils";
import { LAUNCHER_ICONS, LauncherPreview } from "./launcher-preview";
import { useProjectPatch } from "./use-project";
import { WidgetBrandingCard } from "./widget-branding-card";

const POSITIONS = [
  { value: "top-left", label: "Top left" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" },
] as const;

type Errors = Record<string, string>;

/**
 * Every `WidgetConfig` field (wave-1 contract §1) with a live launcher preview. Toggles save at once;
 * text saves on blur / Enter. Each change is validated against the core schema before it is sent.
 */
export function WidgetTab({ project }: { project: ProjectDetail }) {
  const save = useProjectPatch(project.id);
  const server = project.widgetConfig;
  const serverKey = JSON.stringify(server);
  const [draft, setDraft] = useState<WidgetConfig>(server);
  const [errors, setErrors] = useState<Errors>({});
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-sync only when the saved config changes
  useEffect(() => setDraft(server), [serverKey]);

  /** Preview-only change (typing, dragging). */
  const preview = (patch: WidgetConfigInput) =>
    setDraft((d) => mergeConfig(d, patch) as unknown as WidgetConfig);

  /** Validate the merged config, then save. Errors are keyed by the failing path. */
  const commit = (patch: WidgetConfigInput, message = "Widget settings saved") => {
    preview(patch);
    const parsed = widgetConfig.safeParse(mergeConfig(server, patch));
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) next[issue.path.join(".")] = issue.message;
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
            <CardTitle>Launcher</CardTitle>
            <CardDescription>The button visitors click to leave feedback.</CardDescription>
          </CardHeader>
          <CardContent>
            <SettingGroup>
              <SettingRow label="Position" description="Which corner of the page it sits in.">
                <div
                  className="grid w-44 grid-cols-2 gap-1 rounded-lg bg-muted p-1"
                  role="radiogroup"
                  aria-label="Position"
                >
                  {POSITIONS.map((p) => {
                    const active = l.position === p.value;
                    const [v, h] = p.value.split("-");
                    return (
                      // biome-ignore lint/a11y/useSemanticElements: styled radio needs a button for the corner glyph
                      <button
                        key={p.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        aria-label={p.label}
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
                label="Distance from the edge"
                description="Horizontal and vertical offset in pixels."
              >
                <div className="grid w-full gap-3 sm:w-64">
                  {(["x", "y"] as const).map((axis) => (
                    <div key={axis} className="flex items-center gap-3">
                      <span className="w-3 text-xs text-muted-foreground uppercase">{axis}</span>
                      <Slider
                        aria-label={`Offset ${axis}`}
                        min={0}
                        max={200}
                        value={[Math.min(l.offset[axis], 200)]}
                        onValueChange={(val) =>
                          preview({ launcher: { offset: { [axis]: Array.isArray(val) ? val[0] : val } } })
                        }
                        onValueCommitted={(val) =>
                          commit({ launcher: { offset: { [axis]: Array.isArray(val) ? val[0] : val } } })
                        }
                      />
                      <NumberInput
                        aria-label={`Offset ${axis} in pixels`}
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
              <SettingRow label="Shape" description="A round icon button, or a pill with a text label.">
                <Segmented
                  label="Shape"
                  value={l.shape}
                  onChange={(shape) => commit({ launcher: { shape } })}
                  options={[
                    { value: "round", label: "Round" },
                    { value: "pill", label: "Pill" },
                  ]}
                />
              </SettingRow>
              <SettingRow
                label="Pill label"
                htmlFor="launcher-label"
                description={l.shape === "pill" ? "Up to 40 characters." : "Shown when the shape is Pill."}
              >
                <div className="grid w-full gap-1 sm:w-64">
                  <Input
                    id="launcher-label"
                    defaultValue={l.label ?? ""}
                    key={`label-${server.launcher.label}`}
                    maxLength={40}
                    disabled={l.shape !== "pill"}
                    placeholder="Feedback"
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
              <SettingRow label="Icon">
                <Segmented
                  label="Icon"
                  value={l.icon}
                  onChange={(icon) => commit({ launcher: { icon } })}
                  options={(["pin", "comment", "bug"] as const).map((k) => {
                    const Icon = LAUNCHER_ICONS[k];
                    return { value: k, title: k[0]?.toUpperCase() + k.slice(1), label: <Icon /> };
                  })}
                />
              </SettingRow>
              <SettingRow label="Accent colour" description="Launcher, pins and buttons in the widget.">
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
                label="Tooltip"
                htmlFor="launcher-tooltip"
                description="Shown on hover. Leave empty for none."
              >
                <div className="grid w-full gap-1 sm:w-64">
                  <Input
                    id="launcher-tooltip"
                    defaultValue={l.tooltip ?? ""}
                    key={`tooltip-${server.launcher.tooltip}`}
                    maxLength={80}
                    placeholder="No tooltip"
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
                label="Hide the launcher"
                htmlFor="launcher-hidden"
                description="Open the widget only with a keyboard shortcut or Annota.open() from your code."
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
            <CardTitle>Behaviour</CardTitle>
            <CardDescription>What visitors can do with the widget.</CardDescription>
          </CardHeader>
          <CardContent>
            <SettingGroup>
              <SettingRow
                label="Pinned comments"
                htmlFor="mode-comment"
                description="Click anywhere on the page to leave a comment."
              >
                <Switch
                  id="mode-comment"
                  checked={draft.modes.comment}
                  onCheckedChange={(comment) => commit({ modes: { comment } })}
                />
              </SettingRow>
              <SettingRow
                label="Bug reports"
                htmlFor="mode-bug"
                description="Annotated screenshot with console and network details."
              >
                <Switch
                  id="mode-bug"
                  checked={draft.modes.bug}
                  onCheckedChange={(bug) => commit({ modes: { bug } })}
                />
              </SettingRow>
              <SettingRow
                label="Keyboard shortcuts"
                htmlFor="shortcuts"
                description={
                  <>
                    <kbd className="font-mono">C</kbd> to comment, <kbd className="font-mono">B</kbd> to
                    report a bug, <kbd className="font-mono">Esc</kbd> to cancel.
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
                label="Right-click to comment"
                htmlFor="right-click"
                description="Opens the composer at the cursor. Links, inputs and modifier-clicks keep the browser menu."
              >
                <Switch
                  id="right-click"
                  checked={draft.rightClickComment}
                  onCheckedChange={(rightClickComment) => commit({ rightClickComment })}
                />
              </SettingRow>
              <SettingRow
                label="Read-only"
                htmlFor="read-only"
                description="Visitors can see pins and threads but can't post, reply or resolve."
              >
                <Switch
                  id="read-only"
                  checked={draft.readOnly}
                  onCheckedChange={(readOnly) => commit({ readOnly })}
                />
              </SettingRow>
              <SettingRow
                label="Visitors can resolve"
                htmlFor="visitors-resolve"
                description={
                  project.publicRead
                    ? "Anyone on the page can mark a pin resolved or reopen it. Reporters can always resolve their own."
                    : "Needs “Show existing pins to visitors” (Privacy & data). Reporters can always resolve their own."
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

        <ConsentCard draft={draft} server={server} errors={errors} preview={preview} commit={commit} />
        <WidgetBrandingCard project={project} />
      </div>

      <div className="lg:sticky lg:top-16">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Live preview</p>
        <LauncherPreview config={draft} />
        <p className="mt-2 text-xs text-muted-foreground">
          Changes reach your site the next time a page loads the widget.
        </p>
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
  const c = draft.consent;
  const [urlError, setUrlError] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Consent notice</CardTitle>
        <CardDescription>Tell reporters what is sent before they send it.</CardDescription>
      </CardHeader>
      <CardContent>
        <SettingGroup>
          <SettingRow
            label="Ask for consent"
            htmlFor="consent-enabled"
            description={
              draft.privacyMode
                ? "Always shown while privacy mode is on (Privacy & data)."
                : "Shown once; the answer is remembered on that browser."
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
            label="Notice text"
            htmlFor="consent-text"
            description="Up to 1000 characters. Empty uses the default wording."
            stack
          >
            <Textarea
              id="consent-text"
              rows={3}
              maxLength={1000}
              disabled={!c.enabled && !draft.privacyMode}
              key={`consent-${server.consent.text}`}
              defaultValue={c.text ?? ""}
              placeholder="Your comment, the page address, browser details and any screenshot are sent to the site owner."
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
            label="Privacy policy link"
            htmlFor="consent-url"
            description="Optional. Must start with https:// or http://."
          >
            <div className="grid w-full gap-1 sm:w-72">
              <Input
                id="consent-url"
                type="url"
                inputMode="url"
                disabled={!c.enabled && !draft.privacyMode}
                key={`url-${server.consent.privacyUrl}`}
                defaultValue={c.privacyUrl ?? ""}
                placeholder="https://example.com/privacy"
                aria-invalid={!!(urlError ?? errors["consent.privacyUrl"]) || undefined}
                onChange={() => setUrlError(null)}
                onBlur={(e) => {
                  const v = e.target.value.trim() || null;
                  if (v && !/^https?:\/\/[^\s]+\.[^\s]+/.test(v)) {
                    setUrlError("Enter a full URL, like https://example.com/privacy");
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
