import { Suspense } from "react";
import { BrandMark } from "@/components/brand";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { serverApi } from "@/lib/server/api";
import { getOrgBranding, getWorkspaceName } from "@/lib/server/org-data";
import { requireViewer } from "@/lib/server/session";
import { HydrateQueries } from "@/lib/store/hydrate";
import type { Project, SavedView } from "@/lib/api";
import { MainNav, NavLinks } from "./main-nav";
import { SidebarLists } from "./sidebar-lists";
import { UserMenu } from "./user-menu";

/**
 * The sidebar: static chrome (prerendered into the shell) with three session-dependent parts streamed
 * behind their own <Suspense> — the brand header, the projects/views lists and the user menu.
 */
export function AppSidebar() {
  return (
    <Sidebar variant="inset">
      <SidebarHeader>
        <Suspense fallback={<BrandSkeleton />}>
          <SidebarBrand />
        </Suspense>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <Suspense fallback={<NavLinks />}>
              <MainNav />
            </Suspense>
          </SidebarGroupContent>
        </SidebarGroup>
        <Suspense fallback={<ListSkeleton />}>
          <SidebarData />
        </Suspense>
      </SidebarContent>
      <SidebarFooter>
        <Suspense fallback={<Skeleton className="h-12 w-full rounded-lg" />}>
          <SidebarUser />
        </Suspense>
      </SidebarFooter>
    </Sidebar>
  );
}

function BrandSkeleton() {
  return (
    <div className="flex items-center gap-2 px-1 py-1">
      <Skeleton className="size-7 rounded-lg" />
      <div className="grid gap-1">
        <Skeleton className="h-3.5 w-20" />
        <Skeleton className="h-3 w-28" />
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <SidebarGroup>
      <SidebarMenu>
        {[0, 1, 2].map((i) => (
          <SidebarMenuItem key={i}>
            <Skeleton className="h-7 w-full" />
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

async function SidebarBrand() {
  const viewer = await requireViewer();
  if (viewer.kind !== "member") return <BrandSkeleton />;
  const [branding, workspace] = await Promise.all([
    getOrgBranding(viewer.me.orgId),
    getWorkspaceName(viewer.me.orgId),
  ]);
  return (
    <div className="flex items-center gap-2 px-1 py-1">
      <BrandMark logoUrl={branding.logoUrl} />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold" data-testid="product-name">
          {branding.productName ?? "Pinwren"}
        </p>
        <p className="truncate text-xs text-muted-foreground">{workspace ?? "…"}</p>
      </div>
    </div>
  );
}

/** Projects and saved views, fetched on the server and handed to RTK Query (live counts afterwards). */
async function SidebarData() {
  const viewer = await requireViewer();
  if (viewer.kind !== "member") return <ListSkeleton />;
  const [projects, views] = await Promise.all([
    serverApi<{ projects: Project[] }>("/projects"),
    serverApi<{ views: SavedView[] }>("/views"),
  ]);
  return (
    <HydrateQueries
      entries={[
        { endpointName: "me", arg: undefined, value: viewer.me },
        ...(projects.ok ? [{ endpointName: "projects" as const, arg: undefined, value: projects.data }] : []),
        ...(views.ok ? [{ endpointName: "views" as const, arg: undefined, value: views.data }] : []),
      ]}
    >
      <SidebarLists />
    </HydrateQueries>
  );
}

async function SidebarUser() {
  const viewer = await requireViewer();
  if (viewer.kind !== "member") return null;
  const { me } = viewer;
  return <UserMenu user={me.user} role={me.role} update={me.update} />;
}
