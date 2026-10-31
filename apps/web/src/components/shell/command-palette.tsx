"use client";

import { Bookmark, FolderKanban, FolderPlus, Inbox, Monitor, Moon, Sun } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { Key } from "@/lib/i18n/en";
import { useT } from "@/lib/i18n/provider";
import { useEntitlementsQuery, useProjectsQuery, useViewsQuery } from "@/lib/store/api";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { paletteToggled } from "@/lib/store/slices/ui";
import { useViewer } from "@/lib/viewer";
import { visibleSettingsPages } from "@/lib/settings-nav";
import { viewHref } from "./sidebar-lists";

const PAGES: { href: Route; label: Key; icon: typeof Inbox; keywords?: string[] }[] = [
  { href: "/inbox", label: "components2.inbox", icon: Inbox, keywords: ["feedback", "triage"] },
  {
    href: "/projects",
    label: "components2.projects",
    icon: FolderKanban,
    keywords: ["sites", "install", "widget"],
  },
];

/** ⌘K / Ctrl+K: jump to any screen, project or saved view, and run a few app-wide actions (blueprint 06 §5). */
export function CommandPalette() {
  const t = useT();
  const open = useAppSelector((s) => s.ui.paletteOpen);
  const dispatch = useAppDispatch();
  const router = useRouter();
  const { setTheme } = useTheme();
  const { isAdmin, role, instanceAdmin } = useViewer();
  // Settings pages with the same access filter as the settings rail (lib/settings-nav).
  const cloud = useEntitlementsQuery(undefined).data?.edition === "cloud";
  const settings = visibleSettingsPages({ role, instanceAdmin, cloud });
  const projects = useProjectsQuery(undefined, { skip: !open });
  const views = useViewsQuery(undefined, { skip: !open });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        dispatch(paletteToggled());
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch]);

  const run = (fn: () => void) => {
    dispatch(paletteToggled(false));
    fn();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => dispatch(paletteToggled(o))}>
      <DialogContent
        className="top-1/3 translate-y-0 overflow-hidden p-0 sm:max-w-lg"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{t("components2.commandPalette")}</DialogTitle>
        <DialogDescription className="sr-only">{t("components2.commandPaletteHint")}</DialogDescription>
        <Command>
          <CommandInput placeholder={t("components2.goToPlaceholder")} />
          <CommandList>
            <CommandEmpty>{t("components2.noResults")}</CommandEmpty>
            <CommandGroup heading={t("components2.goTo")}>
              {PAGES.map((p) => (
                <CommandItem
                  key={p.href}
                  value={t(p.label)}
                  keywords={p.keywords ?? []}
                  onSelect={() => run(() => router.push(p.href))}
                >
                  <p.icon /> {t(p.label)}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading={t("components2.settings")}>
              {settings.map((p) => (
                <CommandItem
                  key={p.href}
                  value={`${t("components2.settings")} ${t(p.labelKey)}`}
                  keywords={[...(p.keywords ?? []), "settings", p.label]}
                  onSelect={() => run(() => router.push(p.href))}
                >
                  <p.icon /> {t(p.labelKey)}
                </CommandItem>
              ))}
            </CommandGroup>
            {!!views.data?.views.length && (
              <CommandGroup heading={t("components2.views")}>
                {views.data.views.map((v) => (
                  <CommandItem
                    key={v.id}
                    value={`view ${v.name}`}
                    onSelect={() => run(() => router.push(viewHref(v)))}
                  >
                    <Bookmark /> {v.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {!!projects.data?.projects.length && (
              <CommandGroup heading={t("components2.projects")}>
                {projects.data.projects.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={`project ${p.name}`}
                    onSelect={() => run(() => router.push(`/inbox?project=${p.id}`))}
                  >
                    <FolderKanban /> {p.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandSeparator />
            <CommandGroup heading={t("components2.actions")}>
              {isAdmin && (
                <CommandItem
                  value={t("components2.newProject")}
                  onSelect={() => run(() => router.push("/projects?new=1"))}
                >
                  <FolderPlus /> {t("components2.newProject")}
                </CommandItem>
              )}
              <CommandItem value={t("components2.lightTheme")} onSelect={() => run(() => setTheme("light"))}>
                <Sun /> {t("components2.lightTheme")}
              </CommandItem>
              <CommandItem value={t("components2.darkTheme")} onSelect={() => run(() => setTheme("dark"))}>
                <Moon /> {t("components2.darkTheme")}
              </CommandItem>
              <CommandItem
                value={t("components2.systemTheme")}
                onSelect={() => run(() => setTheme("system"))}
              >
                <Monitor /> {t("components2.systemTheme")}
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
