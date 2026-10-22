"use client";

import { FEEDBACK_KINDS, PRIORITIES, type ViewFilters } from "@pinwren/core";
import {
  Bookmark,
  BookmarkCheck,
  CalendarClock,
  Filter,
  Flag,
  Rows3,
  Search,
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
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ViewDialog } from "@/components/views/view-dialogs";
import { extraFilterCount, type FILTER_PARAMS, type InboxLayout, sameFilters } from "@/lib/inbox-filters";
import { errorMessage, useRoundsQuery, useUpdateViewMutation, useViewsQuery } from "@/lib/store/api";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { type Density, densityChanged } from "@/lib/store/slices/inbox";
import { useUrlParams } from "@/lib/use-url-params";
import { useMembers, useViewer } from "@/lib/viewer";
import { Kbd } from "./kbd";

const STATUS_TABS = [
  { value: "active", label: "Active" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
] as const;

const SINCE = [
  { value: "1", label: "Last 24 hours" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
] as const;

type Param = keyof typeof FILTER_PARAMS;

/** Status tabs, the filter menu with removable chips, search, and saving the result as a view. */
export function InboxToolbar({
  filters,
  layout,
  searchRef,
}: {
  filters: ViewFilters;
  layout: InboxLayout;
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const { params, setParams } = useUrlParams();
  const dispatch = useAppDispatch();
  const density = useAppSelector((s) => s.inbox.prefs.density);
  const members = useMembers();
  const { canWrite, userId } = useViewer();
  const rounds = useRoundsQuery(filters.projectId ?? "", { skip: !filters.projectId });
  const views = useViewsQuery(undefined);
  const [updateView, viewUpdate] = useUpdateViewMutation();
  const [saving, setSaving] = useState(false);
  const savedId = params.get("saved");
  const saved = views.data?.views.find((v) => v.id === savedId);
  const changed = !!saved && (!sameFilters(saved.filters, filters) || saved.layout !== layout);
  const status = filters.status ?? "active";

  const set = (param: Param, value: string | null) => setParams({ [param]: value, item: null });

  const chips: { param: Param; label: React.ReactNode }[] = [];
  if (filters.kind) chips.push({ param: "kind", label: `Kind: ${KIND_META[filters.kind].label}` });
  if (filters.priority)
    chips.push({ param: "priority", label: `Priority: ${PRIORITY_META[filters.priority].label}` });
  if (filters.assigneeId) {
    const who =
      filters.assigneeId === userId
        ? "me"
        : (members.find((m) => m.id === filters.assigneeId)?.name ?? "someone");
    chips.push({ param: "assignee", label: `Assigned to ${who}` });
  }
  if (filters.roundId) {
    const r = rounds.data?.rounds.find((x) => x.id === filters.roundId);
    chips.push({ param: "round", label: `Round: ${r?.name ?? "…"}` });
  }
  if (filters.page) chips.push({ param: "page", label: `Page contains “${filters.page}”` });
  // A fixed format (not the browser's locale), so the server-rendered chip matches the client's.
  if (filters.since) chips.push({ param: "since", label: `Since ${filters.since.slice(0, 10)}` });
  if (filters.q) chips.push({ param: "q", label: `“${filters.q}”` });

  return (
    <div className="border-b">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        {layout === "list" ? (
          <Tabs
            value={STATUS_TABS.some((t) => t.value === status) ? status : "all"}
            onValueChange={(v) => set("status", String(v) === "active" ? null : String(v))}
          >
            <TabsList>
              {STATUS_TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className="px-3">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : (
          <p className="hidden text-sm text-muted-foreground sm:block">
            {canWrite ? (
              <>
                Drag cards between columns, or press <Kbd>m</Kbd> on a card.
              </>
            ) : (
              "Every status, one column each."
            )}
          </p>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" data-testid="filter-menu" />}>
            <Filter /> Filter
            {extraFilterCount(filters) > 0 && (
              <Badge variant="secondary" className="h-4 px-1 tabular-nums">
                {extraFilterCount(filters)}
              </Badge>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Kind</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44">
                <DropdownMenuRadioGroup
                  value={filters.kind ?? ""}
                  onValueChange={(v) => set("kind", String(v) || null)}
                >
                  <DropdownMenuRadioItem closeOnClick value="">
                    Any kind
                  </DropdownMenuRadioItem>
                  {FEEDBACK_KINDS.map((k) => {
                    const Icon = KIND_META[k].icon;
                    return (
                      <DropdownMenuRadioItem closeOnClick key={k} value={k}>
                        <Icon /> {KIND_META[k].label}
                      </DropdownMenuRadioItem>
                    );
                  })}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Flag /> Priority
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44">
                <DropdownMenuRadioGroup
                  value={filters.priority ?? ""}
                  onValueChange={(v) => set("priority", String(v) || null)}
                >
                  <DropdownMenuRadioItem closeOnClick value="">
                    Any priority
                  </DropdownMenuRadioItem>
                  {PRIORITIES.map((p) => (
                    <DropdownMenuRadioItem closeOnClick key={p} value={p}>
                      <PriorityIcon priority={p} /> {PRIORITY_META[p].label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <UserRound /> Assignee
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52">
                <DropdownMenuRadioGroup
                  value={filters.assigneeId ?? ""}
                  onValueChange={(v) => set("assignee", String(v) || null)}
                >
                  <DropdownMenuRadioItem closeOnClick value="">
                    Anyone
                  </DropdownMenuRadioItem>
                  {userId && (
                    <DropdownMenuRadioItem closeOnClick value={userId}>
                      Me
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
            {filters.projectId && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Review round</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-52">
                  <DropdownMenuRadioGroup
                    value={filters.roundId ?? ""}
                    onValueChange={(v) => set("round", String(v) || null)}
                  >
                    <DropdownMenuRadioItem closeOnClick value="">
                      Any round
                    </DropdownMenuRadioItem>
                    {rounds.data?.rounds.map((r) => (
                      <DropdownMenuRadioItem closeOnClick key={r.id} value={r.id}>
                        <span className="truncate">{r.name}</span>
                        {r.status === "closed" && (
                          <span className="ml-auto text-xs text-muted-foreground">closed</span>
                        )}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <CalendarClock /> Created
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44">
                <DropdownMenuItem onClick={() => set("since", null)}>Any time</DropdownMenuItem>
                {SINCE.map((s) => (
                  <DropdownMenuItem
                    key={s.value}
                    onClick={() =>
                      set("since", new Date(Date.now() - Number(s.value) * 86_400_000).toISOString())
                    }
                  >
                    {s.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                <Rows3 className="mr-1 inline size-3.5" /> Density
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={density}
                onValueChange={(v) => dispatch(densityChanged(v as Density))}
              >
                <DropdownMenuRadioItem value="comfortable">Comfortable</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="compact">Compact</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
          {saved && changed && (saved.mine || canWrite) ? (
            <Button
              size="sm"
              variant="outline"
              disabled={viewUpdate.isLoading}
              onClick={() =>
                updateView({ id: saved.id, patch: { filters: stripDefaults(filters), layout } })
                  .unwrap()
                  .then(() => toast.success(`“${saved.name}” updated`))
                  .catch((e: unknown) => toast.error(errorMessage(e)))
              }
            >
              <BookmarkCheck /> Update “{saved.name}”
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSaving(true)}
            data-testid="save-view"
            aria-label="Save view"
          >
            <Bookmark /> <span className="hidden sm:inline">Save view</span>
          </Button>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              key={filters.q ?? ""}
              defaultValue={filters.q ?? ""}
              placeholder="Search feedback"
              aria-label="Search feedback"
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
        <ul className="flex flex-wrap items-center gap-1.5 px-3 pb-2" aria-label="Active filters">
          {chips.map((c) => (
            <li key={c.param}>
              <Badge variant="secondary" className="h-6 gap-1 pr-1 font-normal">
                {c.label}
                <button
                  type="button"
                  aria-label={`Remove filter: ${typeof c.label === "string" ? c.label : c.param}`}
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
              onClick={() =>
                setParams({
                  kind: null,
                  priority: null,
                  assignee: null,
                  round: null,
                  page: null,
                  since: null,
                  q: null,
                  item: null,
                })
              }
            >
              Clear
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
