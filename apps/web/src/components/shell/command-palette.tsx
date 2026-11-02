"use client";

import {
  Bookmark,
  CircleDot,
  Clock,
  Command as CommandIcon,
  FolderKanban,
  FolderPlus,
  Inbox,
  LayoutDashboard,
  Link2,
  Monitor,
  Moon,
  SlidersHorizontal,
  Sun,
} from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { useRecentItems } from "@/lib/recent";
import {
  useEntitlementsQuery,
  useListFeedbackInfiniteQuery,
  useProjectsQuery,
  useViewsQuery,
} from "@/lib/store/api";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { paletteToggled, shortcutsToggled } from "@/lib/store/slices/ui";
import { useViewer } from "@/lib/viewer";
import { visibleSettingsPages } from "@/lib/settings-nav";
import { viewHref } from "./sidebar-lists";

const PAGES: { href: Route; label: Key; icon: typeof Inbox; keywords?: string[] }[] = [
  {
    href: "/dashboard",
    label: "nav.dashboard",
    icon: LayoutDashboard,
    keywords: ["home", "overview", "stats"],
  },
  { href: "/inbox", label: "components2.inbox", icon: Inbox, keywords: ["feedback", "triage"] },
  {
    href: "/projects",
    label: "components2.projects",
    icon: FolderKanban,
    keywords: ["sites", "install", "widget"],
  },
];

const SEARCH_MIN = 2;
const SEARCH_DELAY_MS = 250;

/** The text, after it has stopped changing for `ms` (so typing doesn't fire a request per key). */
function useDebounced(value: string, ms: number) {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return out;
}

/**
 * ⌘K / Ctrl+K: jump to any screen, project or saved view, find feedback by its text, reopen what you
 * looked at recently, and run a few app-wide actions (blueprint 06 §5, ADR 0025).
 */
export function CommandPalette() {
  const t = useT();
  const open = useAppSelector((s) => s.ui.paletteOpen);
  const dispatch = useAppDispatch();
  const router = useRouter();
  const { setTheme } = useTheme();
  const { isAdmin, role, instanceAdmin, userId } = useViewer();
  const [query, setQuery] = useState("");
  const typed = query.trim();
  const settled = useDebounced(typed, SEARCH_DELAY_MS);
  const searching = open && settled.length >= SEARCH_MIN;
  const found = useListFeedbackInfiniteQuery({ status: "all", q: settled, limit: 6 }, { skip: !searching });
  const hits = searching ? (found.data?.pages[0]?.items ?? []) : [];
  const waiting = typed.length >= SEARCH_MIN && (typed !== settled || found.isFetching);
  const recent = useRecentItems(userId).items;
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
  const openItem = (id: string) => run(() => router.push(`/inbox?status=all&item=${id}`));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setQuery("");
        dispatch(paletteToggled(o));
      }}
    >
      <DialogContent
        className="top-1/3 translate-y-0 overflow-hidden p-0 sm:max-w-lg"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{t("components2.commandPalette")}</DialogTitle>
        <DialogDescription className="sr-only">{t("components2.commandPaletteHint")}</DialogDescription>
        <Command>
          <CommandInput
            placeholder={t("components2.goToPlaceholder")}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>{waiting ? t("palette.searching") : t("components2.noResults")}</CommandEmpty>
            {/* Search hits carry the typed text in their value so the palette's own filter keeps them. */}
            {hits.length > 0 && (
              <CommandGroup heading={t("palette.feedback")}>
                {hits.map((f) => (
                  <CommandItem key={f.id} value={`${typed} feedback ${f.id}`} onSelect={() => openItem(f.id)}>
                    <CircleDot />
                    <span className="min-w-0 flex-1 truncate">{f.title ?? f.body}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      #{f.number} · {f.projectName}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {searching && (
              <CommandGroup>
                <CommandItem
                  value={`${typed} search all`}
                  onSelect={() => run(() => router.push(`/inbox?status=all&q=${encodeURIComponent(typed)}`))}
                >
                  <Inbox /> {t("palette.searchAll", { q: typed })}
                </CommandItem>
              </CommandGroup>
            )}
            {!typed && recent.length > 0 && (
              <CommandGroup heading={t("palette.recent")}>
                {recent.map((r) => (
                  <CommandItem
                    key={r.id}
                    value={`recent ${r.number} ${r.title}`}
                    onSelect={() => openItem(r.id)}
                  >
                    <Clock />
                    <span className="min-w-0 flex-1 truncate">{r.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      #{r.number} · {r.project}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
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
              <CommandItem
                value={t("dash.customiseCommand")}
                keywords={["widgets", "layout", "edit"]}
                onSelect={() => run(() => router.push("/dashboard?edit=1"))}
              >
                <SlidersHorizontal /> {t("dash.customiseCommand")}
              </CommandItem>
              <CommandItem
                value={t("shortcuts.command")}
                keywords={["keys", "help", "hotkeys"]}
                onSelect={() => run(() => dispatch(shortcutsToggled(true)))}
              >
                <CommandIcon /> {t("shortcuts.command")}
              </CommandItem>
              <CommandItem
                value={t("shortcuts.copyLink")}
                keywords={["share", "url"]}
                onSelect={() =>
                  run(() => {
                    void navigator.clipboard
                      .writeText(window.location.href)
                      .then(() => toast.success(t("shortcuts.linkCopied")))
                      .catch(() => undefined);
                  })
                }
              >
                <Link2 /> {t("shortcuts.copyLink")}
              </CommandItem>
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
