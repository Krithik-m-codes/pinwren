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
import { useProjectsQuery, useViewsQuery } from "@/lib/store/api";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { paletteToggled } from "@/lib/store/slices/ui";
import { useViewer } from "@/lib/viewer";
import { visibleSettingsPages } from "@/lib/settings-nav";
import { viewHref } from "./sidebar-lists";

const PAGES: { href: Route; label: string; icon: typeof Inbox; keywords?: string[] }[] = [
  { href: "/inbox", label: "Inbox", icon: Inbox, keywords: ["feedback", "triage"] },
  { href: "/projects", label: "Projects", icon: FolderKanban, keywords: ["sites", "install", "widget"] },
];

/** ⌘K / Ctrl+K: jump to any screen, project or saved view, and run a few app-wide actions (blueprint 06 §5). */
export function CommandPalette() {
  const open = useAppSelector((s) => s.ui.paletteOpen);
  const dispatch = useAppDispatch();
  const router = useRouter();
  const { setTheme } = useTheme();
  const { isAdmin, role, instanceAdmin } = useViewer();
  // Settings pages with the same access filter as the settings rail (lib/settings-nav).
  const settings = visibleSettingsPages({ role, instanceAdmin });
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
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">Go to a screen, a project or a saved view.</DialogDescription>
        <Command>
          <CommandInput placeholder="Go to…" />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup heading="Go to">
              {PAGES.map((p) => (
                <CommandItem
                  key={p.href}
                  value={p.label}
                  keywords={p.keywords ?? []}
                  onSelect={() => run(() => router.push(p.href))}
                >
                  <p.icon /> {p.label}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="Settings">
              {settings.map((p) => (
                <CommandItem
                  key={p.href}
                  value={`settings ${p.label}`}
                  keywords={p.keywords ?? []}
                  onSelect={() => run(() => router.push(p.href))}
                >
                  <p.icon /> {p.label}
                </CommandItem>
              ))}
            </CommandGroup>
            {!!views.data?.views.length && (
              <CommandGroup heading="Views">
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
              <CommandGroup heading="Projects">
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
            <CommandGroup heading="Actions">
              {isAdmin && (
                <CommandItem value="New project" onSelect={() => run(() => router.push("/projects?new=1"))}>
                  <FolderPlus /> New project
                </CommandItem>
              )}
              <CommandItem value="Light theme" onSelect={() => run(() => setTheme("light"))}>
                <Sun /> Light theme
              </CommandItem>
              <CommandItem value="Dark theme" onSelect={() => run(() => setTheme("dark"))}>
                <Moon /> Dark theme
              </CommandItem>
              <CommandItem value="System theme" onSelect={() => run(() => setTheme("system"))}>
                <Monitor /> System theme
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
