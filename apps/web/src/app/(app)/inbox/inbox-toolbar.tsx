"use client";

import { FEEDBACK_KINDS, PRIORITIES, type ViewFilters } from "@pinwren/core";
import {
  ArrowDownUp,
  AtSign,
  Bookmark,
  BookmarkCheck,
  CalendarClock,
  Download,
  Link2,
  Filter,
  Flag,
  Rows3,
  Search,
  Tag,
  UserRound,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { KIND_META, PRIORITY_META, PriorityIcon } from "@/components/feedback-meta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ViewDialog } from "@/components/views/view-dialogs";
import type { Key } from "@/lib/i18n/en";
import { useI18n, useT } from "@/lib/i18n/provider";
import {
  CLEAR_FILTERS,
  exportUrl,
  extraFilterCount,
  type FeedbackListArgs,
  type FILTER_PARAMS,
  type InboxLayout,
  sameFilters,
} from "@/lib/inbox-filters";
import {
  errorMessage,
  useLabelsQuery,
  useRoundsQuery,
  useUpdateViewMutation,
  useViewsQuery,
} from "@/lib/store/api";
import { useReviewLinksQuery } from "@/lib/store/api/onboarding";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { type Density, densityChanged } from "@/lib/store/slices/inbox";
import { useUrlParams } from "@/lib/use-url-params";
import { useMembers, useViewer } from "@/lib/viewer";
import { download, EXPORT_FORMATS } from "./inbox-list";
import { Kbd } from "./kbd";
import { LabelDot } from "./pickers";

const STATUS_TABS = [
  { value: "active", label: "inbox1.tabActive" },
  { value: "resolved", label: "inbox1.tabResolved" },
  { value: "all", label: "inbox1.tabAll" },
] as const satisfies readonly { value: string; label: Key }[];

const SINCE = [
  { value: "1", label: "inbox1.sinceLast24Hours" },
  { value: "7", label: "inbox1.sinceLast7Days" },
  { value: "30", label: "inbox1.sinceLast30Days" },
] as const satisfies readonly { value: string; label: Key }[];

/** The list orders (`sort` + `order` in the URL); the first is the default. */
export const SORTS = [
  { value: "created:desc", label: "inbox1.sortNewestFirst" },
  { value: "created:asc", label: "inbox1.sortOldestFirst" },
  { value: "updated:desc", label: "inbox1.sortRecentlyUpdated" },
  { value: "priority:desc", label: "inbox1.sortHighestPriority" },
  { value: "priority:asc", label: "inbox1.sortLowestPriority" },
] as const satisfies readonly { value: string; label: Key }[];

type Param = keyof typeof FILTER_PARAMS;

/** Status tabs, the filter menu with removable chips, sort, export, search, and saving the result as a view. */
export function InboxToolbar({
  filters,
  layout,
  trash,
  args,
  total,
  searchRef,
}: {
  filters: ViewFilters;
  layout: InboxLayout;
  trash: boolean;
  args: FeedbackListArgs;
  total: number | null;
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const { t, tn } = useI18n();
  const { params, setParams } = useUrlParams();
  const dispatch = useAppDispatch();
  const density = useAppSelector((s) => s.inbox.prefs.density);
  const members = useMembers();
  const { canWrite, isAdmin, userId } = useViewer();
  const rounds = useRoundsQuery(filters.projectId ?? "", { skip: !filters.projectId });
  const labels = useLabelsQuery(filters.projectId ?? "", { skip: !filters.projectId });
  // Review links are project settings (Admins); others still get the chip from a shared URL.
  const reviewLinks = useReviewLinksQuery(filters.projectId ?? "", { skip: !filters.projectId || !isAdmin });
  const views = useViewsQuery(undefined);
  const [updateView, viewUpdate] = useUpdateViewMutation();
  const [saving, setSaving] = useState(false);
  const [textFilters, setTextFilters] = useState(false);
  const savedId = params.get("saved");
  const saved = views.data?.views.find((v) => v.id === savedId);
  const changed = !!saved && (!sameFilters(saved.filters, filters) || saved.layout !== layout);
  const status = filters.status ?? "active";
  const sort = `${filters.sort ?? "created"}:${filters.order ?? "desc"}`;
  const sortLabel = t(SORTS.find((s) => s.value === sort)?.label ?? "inbox1.sortNewestFirst");

  const set = (param: Param, value: string | null) => setParams({ [param]: value, item: null });

  const chips: { param: Param; label: React.ReactNode }[] = [];
  if (filters.kind)
    chips.push({ param: "kind", label: t("inbox1.chipKind", { kind: t(KIND_META[filters.kind].labelKey) }) });
  if (filters.priority)
    chips.push({
      param: "priority",
      label: t("inbox1.chipPriority", { priority: t(PRIORITY_META[filters.priority].labelKey) }),
    });
  if (filters.assigneeId) {
    const name = members.find((m) => m.id === filters.assigneeId)?.name;
    chips.push({
      param: "assignee",
      label:
        filters.assigneeId === userId || filters.assigneeId === "me"
          ? t("inbox1.chipAssignedToMe")
          : name
            ? t("inbox1.chipAssignedTo", { name })
            : t("inbox1.chipAssignedToSomeone"),
    });
  }
  if (filters.labelId) {
    const l = labels.data?.labels.find((x) => x.id === filters.labelId);
    chips.push({ param: "label", label: t("inbox1.chipLabel", { name: l?.name ?? "…" }) });
  }
  if (filters.roundId) {
    const r = rounds.data?.rounds.find((x) => x.id === filters.roundId);
    chips.push({ param: "round", label: t("inbox1.chipRound", { name: r?.name ?? "…" }) });
  }
  if (filters.reviewLinkId) {
    const l = reviewLinks.data?.links.find((x) => x.id === filters.reviewLinkId);
    chips.push({
      param: "review",
      label: l ? t("inbox1.chipReviewLink", { name: l.label }) : t("inbox1.chipFromReviewLink"),
    });
  }
  if (filters.reporter)
    chips.push({ param: "reporter", label: t("inbox1.chipReporter", { name: filters.reporter }) });
  if (filters.page)
    chips.push({ param: "page", label: t("inbox1.chipPageContains", { text: filters.page }) });
  // A fixed format (not the browser's locale), so the server-rendered chip matches the client's.
  if (filters.since)
    chips.push({ param: "since", label: t("inbox1.chipSince", { date: filters.since.slice(0, 10) }) });
  if (filters.q) chips.push({ param: "q", label: t("inbox1.chipQuery", { q: filters.q }) });

  return (
    <div className="border-b">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        {trash ? (
          <p className="hidden text-sm text-muted-foreground sm:block">{t("inbox1.deletedItemsStay")}</p>
        ) : layout === "list" ? (
          <Tabs
            value={STATUS_TABS.some((tab) => tab.value === status) ? status : "all"}
            onValueChange={(v) => set("status", String(v) === "active" ? null : String(v))}
          >
            <TabsList>
              {STATUS_TABS.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value} className="px-3">
                  {t(tab.label)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : (
          <p className="hidden text-sm text-muted-foreground sm:block">
            {canWrite ? (
              <>
                {t("inbox1.dragCardsBefore")}
                <Kbd>m</Kbd>
                {t("inbox1.dragCardsAfter")}
              </>
            ) : (
              t("inbox1.everyStatusOneColumn")
            )}
          </p>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" data-testid="filter-menu" />}>
            <Filter /> {t("inbox1.filter")}
            {extraFilterCount(filters) > 0 && (
              <Badge variant="secondary" className="h-4 px-1 tabular-nums">
                {extraFilterCount(filters)}
              </Badge>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{t("inbox1.kind")}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44">
                <DropdownMenuRadioGroup
                  value={filters.kind ?? ""}
                  onValueChange={(v) => set("kind", String(v) || null)}
                >
                  <DropdownMenuRadioItem closeOnClick value="">
                    {t("inbox1.anyKind")}
                  </DropdownMenuRadioItem>
                  {FEEDBACK_KINDS.map((k) => {
                    const Icon = KIND_META[k].icon;
                    return (
                      <DropdownMenuRadioItem closeOnClick key={k} value={k}>
                        <Icon /> {t(KIND_META[k].labelKey)}
                      </DropdownMenuRadioItem>
                    );
                  })}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Flag /> {t("inbox1.priority")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44">
                <DropdownMenuRadioGroup
                  value={filters.priority ?? ""}
                  onValueChange={(v) => set("priority", String(v) || null)}
                >
                  <DropdownMenuRadioItem closeOnClick value="">
                    {t("inbox1.anyPriority")}
                  </DropdownMenuRadioItem>
                  {PRIORITIES.map((p) => (
                    <DropdownMenuRadioItem closeOnClick key={p} value={p}>
                      <PriorityIcon priority={p} /> {t(PRIORITY_META[p].labelKey)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <UserRound /> {t("inbox1.assignee")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52">
                <DropdownMenuRadioGroup
                  value={filters.assigneeId === "me" ? (userId ?? "me") : (filters.assigneeId ?? "")}
                  onValueChange={(v) => set("assignee", String(v) || null)}
                >
                  <DropdownMenuRadioItem closeOnClick value="">
                    {t("inbox1.anyone")}
                  </DropdownMenuRadioItem>
                  {userId && (
                    <DropdownMenuRadioItem closeOnClick value={userId}>
                      {t("inbox1.me")}
                    </DropdownMenuRadioItem>
                  )}
                  {members
                    .filter((m) => m.id !== userId)
                    .map((m) => (
                      <DropdownMenuRadioItem closeOnClick key={m.id} value={m.id}>
                        {m.name}
                      </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger data-testid="label-filter">
                <Tag /> {t("inbox1.label")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52">
                {!filters.projectId ? (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">
                    {t("inbox1.labelsBelongToProject")}
                  </p>
                ) : labels.isLoading ? (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">{t("inbox1.loadingLabels")}</p>
                ) : labels.isError ? (
                  <p className="px-2 py-1.5 text-xs text-destructive">{errorMessage(labels.error)}</p>
                ) : !labels.data?.labels.length ? (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">
                    {t("inbox1.noLabelsBefore")}
                    <Kbd>l</Kbd>
                    {t("inbox1.noLabelsAfter")}
                  </p>
                ) : (
                  <DropdownMenuRadioGroup
                    value={filters.labelId ?? ""}
                    onValueChange={(v) => set("label", String(v) || null)}
                  >
                    <DropdownMenuRadioItem closeOnClick value="">
                      {t("inbox1.anyLabel")}
                    </DropdownMenuRadioItem>
                    {labels.data.labels.map((l) => (
                      <DropdownMenuRadioItem closeOnClick key={l.id} value={l.id}>
                        <LabelDot color={l.color} />
                        <span className="truncate">{l.name}</span>
                        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{l.count}</span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {filters.projectId && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>{t("inbox1.reviewRound")}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-52">
                  <DropdownMenuRadioGroup
                    value={filters.roundId ?? ""}
                    onValueChange={(v) => set("round", String(v) || null)}
                  >
                    <DropdownMenuRadioItem closeOnClick value="">
                      {t("inbox1.anyRound")}
                    </DropdownMenuRadioItem>
                    {rounds.data?.rounds.map((r) => (
                      <DropdownMenuRadioItem closeOnClick key={r.id} value={r.id}>
                        <span className="truncate">{r.name}</span>
                        {r.status === "closed" && (
                          <span className="ml-auto text-xs text-muted-foreground">{t("inbox1.closed")}</span>
                        )}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {filters.projectId && isAdmin && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger data-testid="review-link-filter">
                  <Link2 /> {t("inbox1.reviewLink")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">
                  {reviewLinks.isLoading ? (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">
                      {t("inbox1.loadingReviewLinks")}
                    </p>
                  ) : reviewLinks.isError ? (
                    <p className="px-2 py-1.5 text-xs text-destructive">{errorMessage(reviewLinks.error)}</p>
                  ) : !reviewLinks.data?.links.length ? (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">{t("inbox1.noReviewLinks")}</p>
                  ) : (
                    <DropdownMenuRadioGroup
                      value={filters.reviewLinkId ?? ""}
                      onValueChange={(v) => set("review", String(v) || null)}
                    >
                      <DropdownMenuRadioItem closeOnClick value="">
                        {t("inbox1.anySource")}
                      </DropdownMenuRadioItem>
                      {reviewLinks.data.links.map((l) => (
                        <DropdownMenuRadioItem closeOnClick key={l.id} value={l.id}>
                          <span className="truncate">{l.label}</span>
                          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                            {l.feedbackCount}
                          </span>
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuItem data-testid="reporter-filter" onClick={() => setTextFilters(true)}>
              <AtSign /> {t("inbox1.reporterOrPage")}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <CalendarClock /> {t("inbox1.created")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44">
                <DropdownMenuItem onClick={() => set("since", null)}>{t("inbox1.anyTime")}</DropdownMenuItem>
                {SINCE.map((s) => (
                  <DropdownMenuItem
                    key={s.value}
                    onClick={() =>
                      set("since", new Date(Date.now() - Number(s.value) * 86_400_000).toISOString())
                    }
                  >
                    {t(s.label)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                <Rows3 className="mr-1 inline size-3.5" /> {t("inbox1.density")}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={density}
                onValueChange={(v) => dispatch(densityChanged(v as Density))}
              >
                <DropdownMenuRadioItem value="comfortable">
                  {t("inbox1.densityComfortable")}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="compact">{t("inbox1.densityCompact")}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <TextFiltersDialog
          open={textFilters}
          onOpenChange={setTextFilters}
          reporter={filters.reporter ?? ""}
          page={filters.page ?? ""}
          onApply={(reporter, page) =>
            setParams({ reporter: reporter || null, page: page || null, item: null })
          }
        />

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                data-testid="sort-menu"
                aria-label={t("inbox1.sortAria", { sort: sortLabel })}
              />
            }
          >
            <ArrowDownUp /> <span className="hidden md:inline">{sortLabel}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuRadioGroup
              value={sort}
              onValueChange={(v) => {
                const [s, o] = String(v).split(":");
                const isDefault = v === SORTS[0].value;
                setParams({ sort: isDefault ? null : (s ?? null), order: isDefault ? null : (o ?? null) });
              }}
            >
              {SORTS.map((s) => (
                <DropdownMenuRadioItem closeOnClick key={s.value} value={s.value}>
                  {t(s.label)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="sm" data-testid="export-menu" aria-label={t("inbox1.export")} />
            }
          >
            <Download /> <span className="hidden lg:inline">{t("inbox1.export")}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                {total === null ? t("inbox1.exportThisList") : tn("inbox1.exportItems", total)}
              </DropdownMenuLabel>
              {EXPORT_FORMATS.map((f) => (
                <DropdownMenuItem key={f.value} onClick={() => download(exportUrl(args, f.value))}>
                  {t(f.labelKey)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
          {!trash && saved && changed && (saved.mine || canWrite) ? (
            <Button
              size="sm"
              variant="outline"
              disabled={viewUpdate.isLoading}
              onClick={() =>
                updateView({ id: saved.id, patch: { filters: stripDefaults(filters), layout } })
                  .unwrap()
                  .then(() => toast.success(t("inbox1.viewUpdatedToast", { name: saved.name })))
                  .catch((e: unknown) => toast.error(errorMessage(e)))
              }
            >
              <BookmarkCheck /> {t("inbox1.updateView", { name: saved.name })}
            </Button>
          ) : null}
          {!trash && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSaving(true)}
              data-testid="save-view"
              aria-label={t("inbox1.saveView")}
            >
              <Bookmark /> <span className="hidden sm:inline">{t("inbox1.saveView")}</span>
            </Button>
          )}
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              key={filters.q ?? ""}
              defaultValue={filters.q ?? ""}
              placeholder={t("inbox1.searchPlaceholder")}
              aria-label={t("inbox1.searchFeedback")}
              className="h-8 pr-8 pl-8"
              onKeyDown={(e) => {
                if (e.key === "Enter") set("q", e.currentTarget.value.trim() || null);
                if (e.key === "Escape") e.currentTarget.blur();
              }}
            />
            <Kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">/</Kbd>
          </div>
        </div>
      </div>

      {chips.length > 0 && (
        <ul className="flex flex-wrap items-center gap-1.5 px-3 pb-2" aria-label={t("inbox1.activeFilters")}>
          {chips.map((c) => (
            <li key={c.param}>
              <Badge variant="secondary" className="h-6 gap-1 pr-1 font-normal">
                {c.label}
                <button
                  type="button"
                  aria-label={t("inbox1.removeFilter", {
                    filter: typeof c.label === "string" ? c.label : c.param,
                  })}
                  className="rounded p-0.5 hover:bg-foreground/10"
                  onClick={() => set(c.param, null)}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            </li>
          ))}
          <li>
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              onClick={() => setParams(CLEAR_FILTERS)}
            >
              {t("inbox1.clear")}
            </Button>
          </li>
        </ul>
      )}

      <ViewDialog
        open={saving}
        onOpenChange={setSaving}
        filters={stripDefaults(filters)}
        layout={layout}
        canShare={canWrite}
        onSaved={(v) => setParams({ saved: v.id })}
      />
    </div>
  );
}

/** A view keeps only what was chosen: the default status tab isn't stored. */
function stripDefaults(f: ViewFilters): ViewFilters {
  const { status, ...rest } = f;
  return status && status !== "active" ? { ...rest, status } : rest;
}

/** Free-text filters that don't fit a menu: the reporter's name or email, and part of the page URL. */
function TextFiltersDialog({
  open,
  onOpenChange,
  reporter,
  page,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reporter: string;
  page: string;
  onApply: (reporter: string, page: string) => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Remounted on every open, so the fields start from the current filters. */}
        {open && (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              const text = (name: string) => {
                const v = data.get(name);
                return typeof v === "string" ? v.trim() : "";
              };
              onApply(text("reporter"), text("page"));
              onOpenChange(false);
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("inbox1.filterByReporterOrPage")}</DialogTitle>
              <DialogDescription>{t("inbox1.leaveFieldEmpty")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="filter-reporter">{t("inbox1.reporterContains")}</Label>
              <Input id="filter-reporter" name="reporter" defaultValue={reporter} maxLength={200} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="filter-page">{t("inbox1.pageUrlContains")}</Label>
              <Input
                id="filter-page"
                name="page"
                defaultValue={page}
                maxLength={500}
                placeholder="/checkout"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("inbox1.cancel")}
              </Button>
              <Button type="submit">{t("inbox1.apply")}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
