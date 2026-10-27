"use client";

import { Bookmark, MoreHorizontal, Pencil, Plus, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { ViewDialog } from "@/components/views/view-dialogs";
import type { SavedView } from "@/lib/api";
import { useT } from "@/lib/i18n/provider";
import { paramsForFilters } from "@/lib/inbox-filters";
import { here } from "@/lib/routes";
import { errorMessage, useDeleteViewMutation, useProjectsQuery, useViewsQuery } from "@/lib/store/api";
import { useViewer } from "@/lib/viewer";

/** Link to the inbox showing a saved view's filters and layout (`saved` marks it active). */
export function viewHref(v: SavedView) {
  const sp = paramsForFilters(v.filters, v.layout);
  sp.set("saved", v.id);
  return here("/inbox", sp);
}

/** Saved views (personal and shared) and projects, from RTK Query — seeded by the server, live after. */
export function SidebarLists() {
  return (
    <>
      <ViewsGroup />
      <ProjectsGroup />
    </>
  );
}

function ViewsGroup() {
  const t = useT();
  const views = useViewsQuery(undefined);
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { isAdmin, canWrite } = useViewer();
  const [editing, setEditing] = useState<SavedView | null>(null);
  const [removing, setRemoving] = useState<SavedView | null>(null);
  const [remove, removal] = useDeleteViewMutation();
  const active = pathname === "/inbox" ? params.get("saved") : null;
  const list = views.data?.views ?? [];

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t("components2.views")}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu aria-label={t("components2.savedViews")}>
          {list.length === 0 && (
            <p className="px-2 text-xs text-muted-foreground">{t("components2.viewsEmpty")}</p>
          )}
          {list.map((v) => {
            const manage = v.mine || (isAdmin && v.shared);
            return (
              <SidebarMenuItem key={v.id} data-view={v.name}>
                <SidebarMenuButton isActive={active === v.id} render={<Link href={viewHref(v)} />}>
                  {v.shared ? <Users /> : <Bookmark />}
                  <span className="truncate">{v.name}</span>
                </SidebarMenuButton>
                {manage && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <SidebarMenuAction
                          showOnHover
                          aria-label={t("components2.viewActions", { name: v.name })}
                        />
                      }
                    >
                      <MoreHorizontal />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="right" align="start" className="w-44">
                      <DropdownMenuItem onClick={() => setEditing(v)}>
                        <Pencil /> {t("components2.edit")}
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => setRemoving(v)}>
                        <Trash2 /> {t("components2.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
      <ViewDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        view={editing ?? undefined}
        canShare={canWrite}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t("components2.deleteViewTitle", { name: removing?.name ?? "" })}
        description={
          removing?.shared ? t("components2.deleteViewShared") : t("components2.deleteViewPersonal")
        }
        pending={removal.isLoading}
        onConfirm={() => {
          if (!removing) return;
          remove(removing.id)
            .unwrap()
            .then(() => {
              toast.success(t("components2.viewDeleted", { name: removing.name }));
              if (active === removing.id) router.replace("/inbox");
              setRemoving(null);
            })
            .catch((e: unknown) => toast.error(errorMessage(e)));
        }}
      />
    </SidebarGroup>
  );
}

function ProjectsGroup() {
  const t = useT();
  const projects = useProjectsQuery(undefined);
  const params = useSearchParams();
  const pathname = usePathname();
  // Creating projects is an Admin permission (projects.manage, wave-5 §3.7).
  const { isAdmin } = useViewer();
  const current = pathname === "/inbox" ? params.get("project") : null;
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t("components2.projects")}</SidebarGroupLabel>
      {isAdmin && (
        <SidebarGroupAction title={t("components2.newProject")} render={<Link href="/projects?new=1" />}>
          <Plus />
        </SidebarGroupAction>
      )}
      <SidebarGroupContent>
        <SidebarMenu>
          {projects.data?.projects.map((p) => (
            <SidebarMenuItem key={p.id}>
              <SidebarMenuButton
                isActive={current === p.id || pathname.startsWith(`/projects/${p.id}`)}
                render={<Link href={`/inbox?project=${p.id}`} />}
              >
                <span className="size-2 shrink-0 rounded-full bg-primary/70" />
                <span className="truncate">{p.name}</span>
              </SidebarMenuButton>
              {!!p.openCount && <SidebarMenuBadge>{p.openCount}</SidebarMenuBadge>}
            </SidebarMenuItem>
          ))}
          {projects.data?.projects.length === 0 && (
            <p className="px-2 text-xs text-muted-foreground">{t("components2.noProjectsYet")}</p>
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
