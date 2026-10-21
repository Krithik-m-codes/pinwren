"use client";

import type { CaptureConfigInput } from "@pinwren/core";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Segmented } from "@/components/segmented";
import { SettingGroup, SettingRow } from "@/components/setting-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { ProjectDetail } from "@/lib/api";
import { useProjectPatch } from "./use-project";

const ALWAYS_MASKED = ["input[type=password]", "[autocomplete^=cc-]", "[data-pinwren-mask]"];

/** Throws on an invalid CSS selector — the browser is the best validator. */
function selectorError(s: string): string | null {
  if (!s) return "Enter a CSS selector";
  if (s.length > 200) return "200 characters at most";
  try {
    document.createDocumentFragment().querySelector(s);
    return null;
  } catch {
    return "That isn't a valid CSS selector";
  }
}

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
          </SettingGroup>
        </CardContent>
      </Card>
      <MaskCard selectors={c.maskSelectors} onSave={(maskSelectors) => commit({ maskSelectors })} />
    </div>
  );
}

function MaskCard({ selectors, onSave }: { selectors: string[]; onSave: (s: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const s = draft.trim();
    const err = selectorError(s) ?? (selectors.includes(s) ? "Already in the list" : null);
    if (!err && selectors.length >= 50) return setError("50 selectors at most");
    if (err) return setError(err);
    setError(null);
    setDraft("");
    onSave([...selectors, s]);
  };
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
        <form
          className="grid gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <div className="flex gap-2">
            <Input
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setError(null);
              }}
              placeholder=".customer-email, #account-balance"
              aria-label="Add a selector"
              className="font-mono"
              aria-invalid={!!error || undefined}
            />
            <Button type="submit" variant="outline" disabled={!draft.trim()}>
              <Plus /> Add
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
