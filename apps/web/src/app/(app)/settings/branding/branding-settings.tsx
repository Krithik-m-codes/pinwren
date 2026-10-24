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
import { refreshBranding } from "@/lib/server/actions";
import { errorMessage, useBrandingQuery, useMeQuery, useUpdateBrandingMutation } from "@/lib/store/api";
import { SectionTitle } from "../settings-shell";
import { useSyncedState } from "@/lib/use-synced-state";

const DEFAULT_ACCENT = "#d63a1c";

type Patch = Partial<Pick<OrgBranding, "productName" | "accent" | "logoAssetId">>;

/** Settings › Branding (F-094): product name, logo and accent for the dashboard and emails. */
export function BrandingSettings() {
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
          toast.error("Not saved", { description: errorMessage(e) });
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
            title="Workspace admins only"
            description="Ask an owner or admin of this workspace to change its branding."
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
      toast.error("Keep the name to 40 characters");
      return;
    }
    save.mutate({
      patch: { productName: v || null },
      message: v ? `Now called ${v}` : "Name reset to Pinwren",
    });
  };
  const shownName = name.trim() || "Pinwren";

  return (
    <div className="grid gap-4">
      <SectionTitle
        title="Branding"
        description="Your name, logo and colour replace Pinwren's in the dashboard header and in every email this workspace sends."
      />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
            <CardDescription>Shown to your team and in notification emails.</CardDescription>
          </CardHeader>
          <CardContent>
            <SettingGroup>
              <SettingRow
                label="Product name"
                htmlFor="brand-name"
                description="Up to 40 characters. Empty uses “Pinwren”."
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
              <SettingRow label="Logo" description="Square works best; it's shown at 28 px." stack>
                <div className="grid gap-2">
                  <LogoUpload
                    value={b.logoUrl}
                    onUploaded={(logo) =>
                      save.mutate({ patch: { logoAssetId: logo.id }, message: "Logo updated" })
                    }
                  />
                  {b.logoUrl && (
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      className="justify-self-start text-muted-foreground"
                      onClick={() => save.mutate({ patch: { logoAssetId: null }, message: "Logo removed" })}
                    >
                      Remove logo
                    </Button>
                  )}
                </div>
              </SettingRow>
              <SettingRow
                label="Accent colour"
                description="Buttons, focus rings and links in the dashboard; buttons in emails."
              >
                <div className="flex items-center gap-2">
                  <ColorPicker
                    id="brand-accent"
                    label="Brand colour"
                    value={accent}
                    onChange={setAccent}
                    onCommit={(hex) =>
                      hex !== (b.accent ?? DEFAULT_ACCENT) &&
                      save.mutate({ patch: { accent: hex }, message: "Accent colour saved" })
                    }
                  />
                  {b.accent && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Reset accent colour"
                      title="Reset to the default"
                      onClick={() => save.mutate({ patch: { accent: null }, message: "Accent colour reset" })}
                    >
                      <RotateCcw />
                    </Button>
                  )}
                </div>
              </SettingRow>
            </SettingGroup>
          </CardContent>
        </Card>

        <section className="lg:sticky lg:top-16" aria-label="Preview">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Email preview</p>
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
              <p className="text-sm font-semibold">#42 Checkout button does nothing</p>
              <p className="mt-1 text-xs text-[#55556a]">New bug in Marketing site from Dana.</p>
              <span
                className="mt-3 inline-block rounded-md px-3 py-1.5 text-xs font-medium"
                style={{ background: accent, color: contrastText(accent) }}
              >
                Open in {shownName}
              </span>
            </div>
            <p className="mt-2 text-center text-[11px] text-[#8b8b99]">Sent by {shownName}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
