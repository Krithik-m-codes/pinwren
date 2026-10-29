"use client";

import { Palette, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { ColorPicker } from "@/components/color-picker";
import { Logo } from "@/components/logo";
import { LogoUpload } from "@/components/logo-upload";
import { SettingGroup, SettingRow } from "@/components/setting-row";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { isAdminRole, type OrgBranding } from "@/lib/api";
import { contrastText } from "@/lib/color";
import { useT } from "@/lib/i18n/provider";
import { refreshBranding } from "@/lib/server/actions";
import { errorMessage, useBrandingQuery, useMeQuery, useUpdateBrandingMutation } from "@/lib/store/api";
import { SectionTitle } from "../settings-shell";
import { useSyncedState } from "@/lib/use-synced-state";

const DEFAULT_ACCENT = "#d63a1c";

type Patch = Partial<Pick<OrgBranding, "productName" | "accent" | "logoAssetId" | "faviconAssetId">>;

/** Settings › Branding (F-094): product name, logo and accent for the dashboard and emails. */
export function BrandingSettings() {
  const t = useT();
  const query = useBrandingQuery(undefined);
  const me = useMeQuery(undefined);
  const b = query.data?.branding;
  // Both follow the saved branding whenever it (re)loads.
  const [name, setName] = useSyncedState(b?.productName ?? "", b);
  const [accent, setAccent] = useSyncedState(b?.accent ?? DEFAULT_ACCENT, b);

  const [updateBranding] = useUpdateBrandingMutation();
  const save = {
    mutate: ({ patch, message }: { patch: Patch; message: string }) => {
      updateBranding(patch)
        .unwrap()
        // The sidebar's brand is rendered on the server from a cached copy: expire it (updateTag), and
        // the server action's response re-renders it.
        .then(() => refreshBranding())
        .then(() => toast.success(message))
        .catch((e: unknown) => {
          toast.error(t("settings1.notSaved"), { description: errorMessage(e) });
          if (b) setAccent(b.accent ?? DEFAULT_ACCENT);
        });
    },
  };

  if (query.isLoading || me.isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  if (!isAdminRole(me.data?.role)) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={Palette}
            title={t("settings1.workspaceAdminsOnly")}
            description={t("settings1.brandingAdminsOnlyDescription")}
          />
        </CardContent>
      </Card>
    );
  }
  if (!b) return null;

  const commitName = () => {
    const v = name.trim();
    if ((v || null) === b.productName) return;
    if (v.length > 40) {
      toast.error(t("settings1.keepNameTo40"));
      return;
    }
    save.mutate({
      patch: { productName: v || null },
      message: v ? t("settings1.nowCalled", { name: v }) : t("settings1.nameResetToPinwren"),
    });
  };
  const shownName = name.trim() || "Pinwren";

  return (
    <div className="grid gap-4">
      <SectionTitle title={t("settings1.branding")} description={t("settings1.brandingDescription")} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card>
          <CardHeader>
            <CardTitle>{t("settings1.identity")}</CardTitle>
            <CardDescription>{t("settings1.identityDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <SettingGroup>
              <SettingRow
                label={t("settings1.productName")}
                htmlFor="brand-name"
                description={t("settings1.productNameDescription")}
              >
                <Input
                  id="brand-name"
                  className="w-full sm:w-64"
                  value={name}
                  maxLength={40}
                  placeholder="Pinwren"
                  onChange={(e) => setName(e.target.value)}
                  onBlur={commitName}
                  onKeyDown={(e) => e.key === "Enter" && commitName()}
                />
              </SettingRow>
              <SettingRow
                label="Favicon"
                description="Image shown in browser tabs. PNG recommended; up to 512 KB."
                stack
              >
                <div className="grid gap-2">
                  <LogoUpload
                    label="Upload favicon"
                    value={b.faviconUrl}
                    onUploaded={(asset) =>
                      save.mutate({ patch: { faviconAssetId: asset.id }, message: "Favicon updated" })
                    }
                  />
                  {b.faviconUrl && (
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      className="justify-self-start text-muted-foreground"
                      onClick={() =>
                        save.mutate({ patch: { faviconAssetId: null }, message: "Favicon removed" })
                      }
                    >
                      Remove favicon
                    </Button>
                  )}
                </div>
              </SettingRow>
              <SettingRow label={t("settings1.logo")} description={t("settings1.logoDescription")} stack>
                <div className="grid gap-2">
                  <LogoUpload
                    value={b.logoUrl}
                    onUploaded={(logo) =>
                      save.mutate({ patch: { logoAssetId: logo.id }, message: t("settings1.logoUpdated") })
                    }
                  />
                  {b.logoUrl && (
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      className="justify-self-start text-muted-foreground"
                      onClick={() =>
                        save.mutate({ patch: { logoAssetId: null }, message: t("settings1.logoRemoved") })
                      }
                    >
                      {t("settings1.removeLogo")}
                    </Button>
                  )}
                </div>
              </SettingRow>
              <SettingRow
                label={t("settings1.accentColour")}
                description={t("settings1.accentColourDescription")}
              >
                <div className="flex items-center gap-2">
                  <ColorPicker
                    id="brand-accent"
                    label={t("settings1.brandColour")}
                    value={accent}
                    onChange={setAccent}
                    onCommit={(hex) =>
                      hex !== (b.accent ?? DEFAULT_ACCENT) &&
                      save.mutate({ patch: { accent: hex }, message: t("settings1.accentColourSaved") })
                    }
                  />
                  {b.accent && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("settings1.resetAccentColour")}
                      title={t("settings1.resetToDefault")}
                      onClick={() =>
                        save.mutate({ patch: { accent: null }, message: t("settings1.accentColourReset") })
                      }
                    >
                      <RotateCcw />
                    </Button>
                  )}
                </div>
              </SettingRow>
            </SettingGroup>
          </CardContent>
        </Card>

        <section className="lg:sticky lg:top-16" aria-label={t("settings1.preview")}>
          <p className="mb-2 text-xs font-medium text-muted-foreground">{t("settings1.emailPreview")}</p>
          <div className="rounded-xl border bg-[#f6f6f9] p-3 text-[#1c1c24]">
            <div className="rounded-lg bg-white p-4 shadow-xs">
              <div className="mb-3 flex items-center gap-2">
                {b.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- user-uploaded logo (any host, any size); nothing for next/image to optimise
                  <img src={b.logoUrl} alt="" className="size-7 rounded-md object-contain" />
                ) : (
                  <Logo compact />
                )}
                <span className="truncate text-sm font-semibold">{shownName}</span>
              </div>
              <p className="text-sm font-semibold">{t("settings1.sampleIssueTitle")}</p>
              <p className="mt-1 text-xs text-[#55556a]">{t("settings1.sampleIssueBody")}</p>
              <span
                className="mt-3 inline-block rounded-md px-3 py-1.5 text-xs font-medium"
                style={{ background: accent, color: contrastText(accent) }}
              >
                {t("settings1.openInName", { name: shownName })}
              </span>
            </div>
            <p className="mt-2 text-center text-[11px] text-[#8b8b99]">
              {t("settings1.sentByName", { name: shownName })}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
