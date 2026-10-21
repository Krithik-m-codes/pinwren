"use client";

import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { ColorPicker } from "@/components/color-picker";
import { LogoUpload } from "@/components/logo-upload";
import { SettingGroup, SettingRow } from "@/components/setting-row";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useBranding } from "@/lib/account-hooks";
import type { ProjectDetail } from "@/lib/api";
import { useProjectPatch } from "./use-project";

/** Widget white-label (F-094, wave-3 contract §2): "Powered by", dialog colour, logo. */
export function WidgetBrandingCard({ project }: { project: ProjectDetail }) {
  const save = useProjectPatch(project.id);
  const b = project.widgetBranding;
  const orgLogo = useBranding().data?.branding.logoUrl ?? null;
  const fallback = project.widgetConfig.launcher.accent;
  const [accent, setAccent] = useState(b.dialogAccent ?? fallback);
  useEffect(() => setAccent(b.dialogAccent ?? fallback), [b.dialogAccent, fallback]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Widget branding</CardTitle>
        <CardDescription>Make the widget look like part of your product.</CardDescription>
      </CardHeader>
      <CardContent>
        <SettingGroup>
          <SettingRow
            label="Hide “Powered by Annota”"
            htmlFor="hide-powered-by"
            description="Removes the credit line from the widget's cards and dialogs."
          >
            <Switch
              id="hide-powered-by"
              checked={b.hidePoweredBy}
              onCheckedChange={(hidePoweredBy) =>
                save.mutate({
                  patch: { widgetBranding: { hidePoweredBy } },
                  message: "Widget branding saved",
                })
              }
            />
          </SettingRow>
          <SettingRow
            label="Dialog colour"
            description={
              b.dialogAccent
                ? "Primary buttons in the widget's cards and dialogs."
                : "Uses the launcher's accent colour."
            }
          >
            <div className="flex items-center gap-2">
              <ColorPicker
                id="dialog-accent"
                label="Dialog colour"
                value={accent}
                onChange={setAccent}
                onCommit={(dialogAccent) =>
                  dialogAccent !== (b.dialogAccent ?? fallback) &&
                  save.mutate({ patch: { widgetBranding: { dialogAccent } }, message: "Dialog colour saved" })
                }
              />
              {b.dialogAccent && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Use the launcher colour"
                  title="Use the launcher colour"
                  onClick={() =>
                    save.mutate({
                      patch: { widgetBranding: { dialogAccent: null } },
                      message: "Dialog colour reset",
                    })
                  }
                >
                  <RotateCcw />
                </Button>
              )}
            </div>
          </SettingRow>
          <SettingRow label="Logo" description="Shown in the header of the bug-report dialog." stack>
            <div className="grid gap-2">
              <LogoUpload
                value={b.logoUrl}
                onUploaded={(logo) =>
                  save.mutate({
                    patch: { widgetBranding: { logoUrl: logo.url } },
                    message: "Widget logo saved",
                  })
                }
              />
              <div className="flex flex-wrap gap-1">
                {orgLogo && orgLogo !== b.logoUrl && (
                  <Button
                    size="xs"
                    variant="ghost"
                    className="text-muted-foreground"
                    onClick={() =>
                      save.mutate({
                        patch: { widgetBranding: { logoUrl: orgLogo } },
                        message: "Using the workspace logo",
                      })
                    }
                  >
                    Use the workspace logo
                  </Button>
                )}
                {b.logoUrl && (
                  <Button
                    size="xs"
                    variant="ghost"
                    className="text-muted-foreground"
                    onClick={() =>
                      save.mutate({
                        patch: { widgetBranding: { logoUrl: null } },
                        message: "Widget logo removed",
                      })
                    }
                  >
                    Remove logo
                  </Button>
                )}
              </div>
            </div>
          </SettingRow>
        </SettingGroup>
      </CardContent>
    </Card>
  );
}
