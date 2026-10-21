"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpCircle, FolderKanban, Inbox, LogOut, Monitor, Moon, Plus, Settings, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect } from "react";
import { BrandMark, BrandTheme, useProductName } from "@/components/brand";
import { Logo } from "@/components/logo";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { initials } from "@/components/user-avatar";
import { useMeInfo } from "@/lib/account-hooks";
import { api, type Project } from "@/lib/api";
import { authClient, signOut, useSession } from "@/lib/auth-client";

export { initials } from "@/components/user-avatar";

/**
 * Client-side gate for every signed-in screen: no session → sign-in, no workspace → onboarding.
 * The API re-checks the session on every request; this only decides what to render.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const orgs = authClient.useListOrganizations();
  const activeOrgId = session?.session.activeOrganizationId;

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      router.replace("/sign-in");
      return;
    }
    if (activeOrgId || orgs.isPending) return;
    const first = orgs.data?.[0];
    if (first) void authClient.organization.setActive({ organizationId: first.id });
    else router.replace("/onboarding");
  }, [isPending, session, activeOrgId, orgs.isPending, orgs.data, router]);

  if (isPending || !session || !activeOrgId) {
    return (
      <div className="grid min-h-svh place-items-center">
        <Logo className="animate-pulse opacity-60" />
      </div>
    );
  }

  return (
    <SidebarProvider>
      <BrandTheme />
      <AppSidebar user={session.user} />
      <SidebarInset className="min-w-0">{children}</SidebarInset>
    </SidebarProvider>
  );
}

function AppSidebar({ user }: { user: { name: string; email: string; image?: string | null } }) {
  const pathname = usePathname();
  const router = useRouter();
  const { setTheme } = useTheme();
  const { data: activeOrg } = authClient.useActiveOrganization();
  const productName = useProductName();
  const update = useMeInfo().data?.update;
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<{ projects: Project[] }>("/projects"),
  });

  const nav = [
    { href: "/inbox", label: "Inbox", icon: Inbox },
    { href: "/projects", label: "Projects", icon: FolderKanban },
    { href: "/settings", label: "Settings", icon: Settings },
  ] as const;

  return (
    <Sidebar variant="inset">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-1 py-1">
          <BrandMark />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold" data-testid="product-name">
              {productName}
            </p>
            <p className="truncate text-xs text-muted-foreground">{activeOrg?.name ?? "…"}</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map(({ href, label, icon: Icon }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton
                    isActive={pathname === href || pathname.startsWith(`${href}/`)}
                    render={<Link href={href} />}
                  >
                    <Icon />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <SidebarGroupAction title="New project" render={<Link href="/projects?new=1" />}>
            <Plus />
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu>
              {projects.isPending &&
                [0, 1].map((i) => (
                  <SidebarMenuItem key={i}>
                    <Skeleton className="h-7 w-full" />
                  </SidebarMenuItem>
                ))}
              {projects.data?.projects.map((p) => (
                <SidebarMenuItem key={p.id}>
                  <SidebarMenuButton
                    isActive={pathname === `/projects/${p.id}`}
                    render={<Link href={`/inbox?project=${p.id}`} />}
                  >
                    <span className="size-2 shrink-0 rounded-full bg-primary/70" />
                    <span className="truncate">{p.name}</span>
                  </SidebarMenuButton>
                  {!!p.openCount && <SidebarMenuBadge>{p.openCount}</SidebarMenuBadge>}
                </SidebarMenuItem>
              ))}
              {projects.data?.projects.length === 0 && (
                <p className="px-2 text-xs text-muted-foreground">No projects yet.</p>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        {update && (
          <a
            href={update.url ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-2 py-1.5 text-xs text-foreground transition-colors hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring"
            data-testid="update-available"
          >
            <ArrowUpCircle className="size-3.5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate">
              Update available <span className="text-muted-foreground">· {update.latest}</span>
            </span>
          </a>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton size="lg" className="data-popup-open:bg-sidebar-accent">
                <Avatar className="size-7">
                  {user.image && <AvatarImage src={user.image} alt="" />}
                  <AvatarFallback className="text-xs">{initials(user.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 text-left">
                  <p className="truncate text-sm font-medium">{user.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                </div>
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Theme</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setTheme("light")}>
                <Sun /> Light
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")}>
                <Moon /> Dark
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("system")}>
                <Monitor /> System
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={async () => {
                await signOut();
                router.replace("/sign-in");
              }}
            >
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
