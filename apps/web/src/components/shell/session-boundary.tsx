import type { Entitlements } from "@pinwren/core";
import { I18nProvider } from "@/lib/i18n/provider";
import { loadCatalog, requestLocale } from "@/lib/i18n/server";
import type { UserPreferences } from "@/lib/store/api/notifications";
import { BrandTheme } from "@/components/brand";
import { EmailSetupBanner } from "@/components/notifications/notification-parts";
import type { Project, SavedView } from "@/lib/api";
import { serverApi } from "@/lib/server/api";
import { getOrgBranding } from "@/lib/server/org-data";
import { BrandingFavicon } from "@/components/shell/branding-favicon";
import { requireViewer } from "@/lib/server/session";
import { HydrateQueries } from "@/lib/store/hydrate";
import { ActivateWorkspace } from "./activate-workspace";
import { CommandPalette } from "./command-palette";
import { GlobalShortcuts } from "./global-shortcuts";
import { LicenseBanner } from "./license-banner";
import { RealtimeConnection } from "./realtime-connection";
import { WorkspaceFromLink } from "./workspace-from-link";

/**
 * The signed-in part of every app screen, streamed behind the layout's <Suspense>: checks the session on
 * the server (redirecting to sign-in or onboarding), applies the workspace theme, seeds RTK Query with
 * `me`, branding and entitlements, and opens the real-time stream.
 */
export async function SessionBoundary({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  if (viewer.kind === "activate") return <ActivateWorkspace orgId={viewer.orgId} />;
  const { me } = viewer;
  // Everything a screen below reads on its first render is seeded here (not only in the sidebar, which
  // streams in its own boundary): server HTML and client hydration then see the same data.
  const [branding, entitlements, projects, views, prefs] = await Promise.all([
    getOrgBranding(me.orgId),
    serverApi<Entitlements>("/me/entitlements"),
    serverApi<{ projects: Project[] }>("/projects"),
    serverApi<{ views: SavedView[] }>("/views"),
    serverApi<{ preferences: UserPreferences }>("/me/preferences"),
  ]);
  const locale = await requestLocale(prefs.ok ? prefs.data.preferences.locale : null);
  const catalog = await loadCatalog(locale);
  return (
    <HydrateQueries
      entries={[
        { endpointName: "me", arg: undefined, value: me },
        { endpointName: "branding", arg: undefined, value: { branding } },
        ...(entitlements.ok
          ? [{ endpointName: "entitlements" as const, arg: undefined, value: entitlements.data }]
          : []),
        ...(projects.ok ? [{ endpointName: "projects" as const, arg: undefined, value: projects.data }] : []),
        ...(views.ok ? [{ endpointName: "views" as const, arg: undefined, value: views.data }] : []),
      ]}
    >
      <I18nProvider locale={locale} catalog={catalog}>
        <BrandingFavicon href={branding.faviconUrl} />
        <BrandTheme accent={branding.accent} />
        <RealtimeConnection />
        <WorkspaceFromLink orgId={me.orgId} />
        <LicenseBanner />
        <EmailSetupBanner />
        <CommandPalette />
        <GlobalShortcuts />
        {children}
      </I18nProvider>
    </HydrateQueries>
  );
}
