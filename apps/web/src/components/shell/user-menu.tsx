"use client";

import { ArrowUpCircle, Eye, LogOut, Monitor, Moon, Settings, Sun } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { safeHref } from "@pinwren/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/user-avatar";
import { isViewerRole, type MeResponse } from "@/lib/api";
import { signOut } from "@/lib/auth-client";
import { useT } from "@/lib/i18n/provider";

/** Footer of the sidebar: update notice (instance admins), the account menu and theme switch. */
export function UserMenu({
  user,
  role,
  update,
}: {
  user: MeResponse["user"];
  role: string;
  update: MeResponse["update"];
}) {
  const { setTheme } = useTheme();
  const t = useT();
  const viewer = isViewerRole(role);
  return (
    <>
      {update && (
        <a
          href={safeHref(update.url) ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-2 py-1.5 text-xs text-foreground transition-colors hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring"
          data-testid="update-available"
        >
          <ArrowUpCircle className="size-3.5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate">
            {t("user.updateAvailable")} <span className="text-muted-foreground">· {update.latest}</span>
          </span>
        </a>
      )}
      {viewer && (
        <Tooltip>
          <TooltipTrigger
            render={
              <p
                className="flex items-center gap-2 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground"
                data-testid="read-only-badge"
              />
            }
          >
            <Eye className="size-3.5 shrink-0" /> {t("user.readOnly")}
          </TooltipTrigger>
          <TooltipContent>{t("user.readOnlyHint")}</TooltipContent>
        </Tooltip>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarMenuButton
              size="lg"
              className="data-popup-open:bg-sidebar-accent"
              aria-label={t("user.accountMenu")}
            >
              <UserAvatar name={user.name} image={user.image} className="size-7" />
              <div className="min-w-0 text-left">
                <p className="truncate text-sm font-medium">{user.name}</p>
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              </div>
            </SidebarMenuButton>
          }
        />
        <DropdownMenuContent side="top" align="start" className="w-56">
          <DropdownMenuItem render={<Link href="/settings" />} data-testid="profile-settings">
            <Settings /> {t("user.profileSettings")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("user.theme")}</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setTheme("light")}>
              <Sun /> {t("user.themeLight")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("dark")}>
              <Moon /> {t("user.themeDark")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("system")}>
              <Monitor /> {t("user.themeSystem")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={async () => {
              await signOut();
              // A full page load: the Redux store and the router cache belong to the old session.
              window.location.assign(new URL("/sign-in", window.location.href).href);
            }}
          >
            <LogOut /> {t("user.signOut")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
