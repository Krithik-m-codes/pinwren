"use client";

import { FolderKanban, Inbox, Search, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { useT } from "@/lib/i18n/provider";
import type { Key } from "@/lib/i18n/en";
import { useAppDispatch } from "@/lib/store/hooks";
import { paletteToggled } from "@/lib/store/slices/ui";

const NAV = [
  { href: "/inbox", label: "nav.inbox", icon: Inbox },
  { href: "/projects", label: "nav.projects", icon: FolderKanban },
  { href: "/settings", label: "nav.settings", icon: Settings },
] as const satisfies readonly { href: string; label: Key; icon: unknown }[];

/** Top-level navigation with the current section highlighted (the path is request data, so this streams). */
export function MainNav() {
  const pathname = usePathname();
  return <NavLinks pathname={pathname} />;
}

/** The same links without a highlight — what the prerendered shell shows until the path is known. */
export function NavLinks({ pathname = null }: { pathname?: string | null }) {
  const dispatch = useAppDispatch();
  const t = useT();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          onClick={() => dispatch(paletteToggled(true))}
          className="text-muted-foreground"
          aria-keyshortcuts="Control+K Meta+K"
        >
          <Search />
          <span>{t("nav.search")}</span>
          <kbd className="ml-auto rounded border bg-muted px-1 font-mono text-[10px]">⌘K</kbd>
        </SidebarMenuButton>
      </SidebarMenuItem>
      {NAV.map(({ href, label, icon: Icon }) => (
        <SidebarMenuItem key={href}>
          <SidebarMenuButton
            isActive={!!pathname && (pathname === href || pathname.startsWith(`${href}/`))}
            render={<Link href={href} />}
          >
            <Icon />
            <span>{t(label)}</span>
          </SidebarMenuButton>
          {href === "/inbox" && (
            // Items assigned to the signed-in member, every project (`g m` anywhere).
            <SidebarMenuButton
              render={<Link href="/inbox?assignee=me" />}
              className="mt-0.5 text-muted-foreground"
              aria-keyshortcuts="g m"
              data-testid="my-work"
            >
              <UserRound />
              <span>{t("nav.myWork")}</span>
            </SidebarMenuButton>
          )}
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}
