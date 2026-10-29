import { Suspense } from "react";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { SessionBoundary } from "@/components/shell/session-boundary";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { BrandingFavicon } from "@/components/shell/branding-favicon";

/**
 * Signed-in screens. The sidebar chrome and the page frame are prerendered into the static shell; the
 * session check, the workspace's data and the screen itself stream in behind <Suspense> (Cache
 * Components — ADR 0020).
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <SidebarProvider>
      <Suspense fallback={null}>
        <BrandingFavicon />
      </Suspense>
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
