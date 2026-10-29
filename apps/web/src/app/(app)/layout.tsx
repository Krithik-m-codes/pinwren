import { Suspense } from "react";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { SessionBoundary } from "@/components/shell/session-boundary";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import type { Metadata } from "next";
import { getSession } from "@/lib/server/session";
import { getOrgBranding } from "@/lib/server/org-data";

export async function generateMetadata(): Promise<Metadata> {
  const session = await getSession();
  if (!session?.activeOrgId) return {};
  const branding = await getOrgBranding(session.activeOrgId);
  return branding.faviconUrl ? { icons: { icon: branding.faviconUrl } } : {};
}

/**
 * Signed-in screens. The sidebar chrome and the page frame are prerendered into the static shell; the
 * session check, the workspace's data and the screen itself stream in behind <Suspense> (Cache
 * Components — ADR 0020).
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <Suspense fallback={<ScreenSkeleton />}>
          <SessionBoundary>{children}</SessionBoundary>
        </Suspense>
      </SidebarInset>
    </SidebarProvider>
  );
}

function ScreenSkeleton() {
  return (
    <div aria-busy className="flex min-h-svh flex-col">
      <div className="flex h-12 items-center gap-2 border-b px-3">
        <Skeleton className="size-7" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="space-y-3 p-4">
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    </div>
  );
}
