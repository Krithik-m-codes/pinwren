"use client";

import { RotateCcw } from "lucide-react";
import { ColorPicker } from "@/components/color-picker";
import { LogoUpload } from "@/components/logo-upload";
import { SettingGroup, SettingRow } from "@/components/setting-row";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { ProjectDetail } from "@/lib/api";
import { useBrandingQuery, useEntitlementsQuery } from "@/lib/store/api";
import { UpgradeNote } from "@/components/upgrade-note";
import { useT } from "@/lib/i18n/provider";
import { useSyncedState } from "@/lib/use-synced-state";
import { useProjectPatch } from "./use-project";

/** Widget white-label (F-094, wave-3 contract §2): "Powered by", dialog colour, logo. */
export function WidgetBrandingCard({ project }: { project: ProjectDetail }) {
  const t = useT();
  const save = useProjectPatch(project.id);
  const b = project.widgetBranding;
  const orgLogo = useBrandingQuery(undefined).data?.branding.logoUrl ?? null;
  const entitlements = useEntitlementsQuery(undefined).data;
  const whiteLabel = !!entitlements?.features.includes("white_label");
  const frozen = whiteLabel && !!entitlements?.readOnly;
  const fallback = project.widgetConfig.launcher.accent;
  const [accent, setAccent] = useSyncedState(b.dialogAccent ?? fallback);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("projects2.widgetBranding")}</CardTitle>
        <CardDescription>{t("projects2.widgetBrandingDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <SettingGroup>
          <SettingRow
            label={t("projects2.hidePoweredBy")}
            htmlFor="hide-powered-by"
            description={
              <>
                {t("projects2.removesCreditLine")}
                {!whiteLabel && <UpgradeNote feature="white_label" applied={b.hidePoweredBy} />}
                {frozen && ` ${t("projects2.readOnlyUntilRenewed")}`}
              </>
            }
          >
            <Switch
              id="hide-powered-by"
              disabled={frozen}
              checked={b.hidePoweredBy}
              onCheckedChange={(hidePoweredBy) =>
                save.mutate({
                  patch: { widgetBranding: { hidePoweredBy } },
                  message: t("projects2.widgetBrandingSaved"),
                })
              }
            />
          </SettingRow>
          <SettingRow
            label={t("projects2.dialogColour")}
            description={
              b.dialogAccent ? t("projects2.dialogColourCustom") : t("projects2.dialogColourDefault")
            }
          >
            <div className="flex items-center gap-2">
              <ColorPicker
                id="dialog-accent"
                label={t("projects2.dialogColour")}
                value={accent}
                onChange={setAccent}
                onCommit={(dialogAccent) =>
                  dialogAccent !== (b.dialogAccent ?? fallback) &&
                  save.mutate({
                    patch: { widgetBranding: { dialogAccent } },
                    message: t("projects2.dialogColourSaved"),
                  })
                }
              />
              {b.dialogAccent && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("projects2.useLauncherColour")}
                  title={t("projects2.useLauncherColour")}
                  onClick={() =>
                    save.mutate({
                      patch: { widgetBranding: { dialogAccent: null } },
                      message: t("projects2.dialogColourReset"),
                    })
                  }
                >
                  <RotateCcw />
                </Button>
              )}
            </div>
          </SettingRow>
          <SettingRow label={t("projects2.logo")} description={t("projects2.logoDescription")} stack>
            <div className="grid gap-2">
              <LogoUpload
                value={b.logoUrl}
                onUploaded={(logo) =>
                  save.mutate({
                    patch: { widgetBranding: { logoUrl: logo.url } },
                    message: t("projects2.widgetLogoSaved"),
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
                        message: t("projects2.usingWorkspaceLogo"),
                      })
                    }
                  >
                    {t("projects2.useWorkspaceLogo")}
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
                        message: t("projects2.widgetLogoRemoved"),
                      })
                    }
                  >
                    {t("projects2.removeLogo")}
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
