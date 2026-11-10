"use client";

import { appRoleOf } from "@pinwren/core";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  GripVertical,
  LayoutDashboard,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { type DragEvent, useState } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  addWidget,
  HEIGHTS,
  type Layout,
  moveWidget,
  nudgeWidget,
  type Range,
  removeWidget,
  resizeWidget,
  type Scope,
  setRange,
  type Slot,
  WIDGETS,
  widgetsFor,
  type WidgetId,
} from "@/lib/dashboard/catalog";
import { type DashFilters, filtersPatch, parseFilters, statsArgs } from "@/lib/dashboard/filters";
import { useCollapsed } from "@/lib/dashboard/storage";
import { useDashboards } from "@/lib/dashboard/use-dashboards";
import { useI18n } from "@/lib/i18n/provider";
import { errorMessage } from "@/lib/store/api";
import { useDashboardStatsQuery } from "@/lib/store/api/stats";
import { useUrlParams } from "@/lib/use-url-params";
import { cn } from "@/lib/utils";
import { useViewer } from "@/lib/viewer";
import { DashboardSwitcher } from "./dashboard-switcher";
import { FilterBar } from "./filter-bar";
import { WidgetBody } from "./widgets";

// One customisable dashboard surface, used full-page (`home`) and as the compact overview strip of other
// screens. Everything on it reads the same `/api/stats` response, so the layout can change freely.

const RANGES: Range[] = [7, 14, 30, 90];

const COLS: Record<Slot["w"], string> = {
  3: "col-span-6 lg:col-span-3",
  4: "col-span-12 sm:col-span-6 lg:col-span-4",
  6: "col-span-12 lg:col-span-6",
  8: "col-span-12 lg:col-span-8",
  12: "col-span-12",
};
const ROWS: Record<Slot["h"], string> = { 1: "row-span-1", 2: "row-span-2", 3: "row-span-3" };
const WIDTH_NAMES: Record<
  Slot["w"],
  "dash.span3" | "dash.span4" | "dash.span6" | "dash.span8" | "dash.span12"
> = {
  3: "dash.span3",
  4: "dash.span4",
  6: "dash.span6",
  8: "dash.span8",
  12: "dash.span12",
};

export function Dashboard({
  scope,
  projectId,
  className,
  startEditing = false,
}: {
  scope: Scope;
  projectId?: string;
  className?: string;
  startEditing?: boolean;
}) {
  return scope === "home" ? (
    <HomeDashboard className={className} startEditing={startEditing} />
  ) : (
    <LocalSelectionDashboard
      scope={scope}
      projectId={projectId}
      className={className}
      startEditing={startEditing}
    />
  );
}

/** The home page keeps the open dashboard and the filters in the URL, so a view can be linked. */
function HomeDashboard({
  className,
  startEditing,
}: {
  className: string | undefined;
  startEditing: boolean;
}) {
  const { params, setParams } = useUrlParams();
  const filters = parseFilters(params);
  return (
    <DashboardBoard
      scope="home"
      projectId={undefined}
      className={className}
      startEditing={startEditing}
      filters={filters}
      onFilters={(patch) => setParams(filtersPatch(patch))}
      selectedId={params.get("dash")}
      onSelect={(id) => setParams({ dash: id })}
    />
  );
}

/** Overview strips: the open dashboard is a choice of this visit, and there is no filter bar. */
function LocalSelectionDashboard({
  scope,
  projectId,
  className,
  startEditing,
}: {
  scope: Scope;
  projectId: string | undefined;
  className: string | undefined;
  startEditing: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <DashboardBoard
      scope={scope}
      projectId={projectId}
      className={className}
      startEditing={startEditing}
      selectedId={selectedId}
      onSelect={setSelectedId}
    />
  );
}

function DashboardBoard({
  scope,
  projectId,
  className,
  startEditing,
  filters,
  onFilters,
  selectedId,
  onSelect,
}: {
  scope: Scope;
  projectId: string | undefined;
  className: string | undefined;
  startEditing: boolean;
  /** Home only: the dashboard-wide filters from the URL, and how to change them. */
  filters?: DashFilters;
  onFilters?: (patch: { [K in keyof DashFilters]?: string | null }) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { t } = useI18n();
  const { userId, role, isAdmin } = useViewer();
  const appRole = role ? appRoleOf(role) : undefined;
  const board = useDashboards({
    scope,
    userId,
    role: appRole,
    isAdmin,
    selectedId,
    defaultName: t("dashx.myDashboard"),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const { layout, editable } = board;
  const { collapsed: folded, setCollapsed } = useCollapsed(userId, scope);
  const [editing, setEditing] = useState(startEditing);
  const [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState<WidgetId | null>(null);
  const home = scope === "home";
  const collapsed = !home && folded;
  const stats = useDashboardStatsQuery(statsArgs(layout.days, filters ?? {}, projectId), { skip: collapsed });
  const edit = (next: Layout) => void board.save(next);

  const onDrop = (target: WidgetId) => (e: DragEvent) => {
    e.preventDefault();
    if (dragging) edit(moveWidget(layout, dragging, target));
    setDragging(null);
  };

  // A shared dashboard someone else owns is read-only: "Customise" copies it to the person's own first.
  const customise = async () => {
    if (!board.active || editable) {
      setEditing(true);
      return;
    }
    try {
      const made = await board.duplicate(board.active.id);
      onSelect(made.id);
      toast.success(t("dashx.duplicated", { name: made.name }));
      setEditing(true);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <section
      aria-label={t("dash.title")}
      className={cn("space-y-2", className)}
      data-testid={`dashboard-${scope}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {!home && (
          <button
            type="button"
            aria-expanded={!folded}
            onClick={() => setCollapsed(!folded)}
            className="flex items-center gap-1 rounded text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {folded ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            {t("dash.overview")}
          </button>
        )}
        <div className={cn("flex flex-wrap items-center gap-1.5", collapsed && "hidden")}>
          <DashboardSwitcher
            board={board}
            isAdmin={isAdmin}
            onSelect={onSelect}
            builtinName={t("dashx.builtin")}
          />
          {!home && (
            <RangeMenu days={layout.days} onChange={(d) => edit(setRange(layout, d))} disabled={!editable} />
          )}
        </div>
        <div className={cn("ml-auto flex items-center gap-1.5", collapsed && "hidden")}>
          {editing ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
                <Plus /> {t("dash.addWidget")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!board.customised}
                onClick={() => void board.reset()}
              >
                <RotateCcw /> {t("dash.reset")}
              </Button>
              <Button size="sm" onClick={() => setEditing(false)}>
                <Check /> {t("dash.done")}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void customise()}
              data-testid="dashboard-customise"
            >
              {editable ? <SlidersHorizontal /> : <Copy />}{" "}
              {editable ? t("dash.customise") : t("dashx.duplicateToMine")}
            </Button>
          )}
        </div>
      </div>

      {home && filters && onFilters && !collapsed && (
        <FilterBar
          filters={filters}
          days={layout.days}
          onChange={onFilters}
          onDays={(d) => edit(setRange(layout, d))}
        />
      )}
      {board.isError && !collapsed && (
        <p role="status" className="text-xs text-muted-foreground" data-testid="dashboard-offline">
          {t("dashx.offline")}{" "}
          <button type="button" className="underline underline-offset-2" onClick={() => void board.refetch()}>
            {t("dashx.retry")}
          </button>
        </p>
      )}
      {!collapsed && !editable && board.active && (
        <p className="text-xs text-muted-foreground" data-testid="dashboard-readonly">
          {t("dashx.readOnlyHint", { name: board.active.ownerName ?? t("dashx.aTeammate") })}
        </p>
      )}

      {collapsed ? null : stats.isError && !stats.data ? (
        <ErrorState error={stats.error} retry={() => void stats.refetch()} className="py-6" />
      ) : layout.slots.length === 0 ? (
        <div className="rounded-xl ring-1 ring-foreground/10">
          <EmptyState
            icon={LayoutDashboard}
            title={t("dash.emptyTitle")}
            description={t("dash.emptyBody")}
            className="py-8"
            action={
              editable ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setEditing(true);
                    setAdding(true);
                  }}
                >
                  <Plus /> {t("dash.addWidget")}
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <ul
          className={cn(
            "grid grid-cols-12 gap-2",
            // One row unit: a tile is one, a chart two, a list three (plus the gaps between them).
            "auto-rows-[4.25rem]",
          )}
          aria-busy={stats.isLoading}
        >
          {layout.slots.map((slot, i) => (
            <li
              key={slot.id}
              className={cn(
                "relative min-w-0 overflow-hidden rounded-xl bg-card text-card-foreground ring-1 ring-foreground/10",
                COLS[slot.w],
                ROWS[slot.h],
                editing && "cursor-grab outline-1 outline-offset-1 outline-border outline-dashed",
                dragging === slot.id && "opacity-40",
              )}
              draggable={editing}
              onDragStart={(e) => {
                if (!editing) return;
                e.dataTransfer.effectAllowed = "move";
                setDragging(slot.id);
              }}
              onDragEnd={() => setDragging(null)}
              onDragOver={(e) => editing && dragging && e.preventDefault()}
              onDrop={onDrop(slot.id)}
              data-widget={slot.id}
            >
              {stats.data ? (
                <div className={cn("h-full", editing && "pointer-events-none select-none")}>
                  <WidgetBody id={slot.id} stats={stats.data} projectId={projectId ?? filters?.projectId} />
                </div>
              ) : (
                <Skeleton className="size-full rounded-none" />
              )}
              {editing && (
                <WidgetControls
                  slot={slot}
                  first={i === 0}
                  last={i === layout.slots.length - 1}
                  onMove={(by) => edit(nudgeWidget(layout, slot.id, by))}
                  onResize={(size) => edit(resizeWidget(layout, slot.id, size))}
                  onRemove={() => edit(removeWidget(layout, slot.id))}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && !collapsed && (
        <p className="text-[11px] text-muted-foreground">{t("dashx.savedToAccount")}</p>
      )}

      <WidgetCatalog
        open={adding}
        onOpenChange={setAdding}
        scope={scope}
        layout={layout}
        onAdd={(id) => edit(addWidget(layout, id))}
      />
    </section>
  );
}

/** The date range of an overview strip (the home page has it in the filter bar). */
function RangeMenu({
  days,
  onChange,
  disabled,
}: {
  days: Range;
  onChange: (d: Range) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" aria-label={t("dash.range")} disabled={disabled}>
            {t(`dash.range${days}` as "dash.range7")} <ChevronDown />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("dash.range")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={String(days)} onValueChange={(v) => onChange(Number(v) as Range)}>
            {RANGES.map((d) => (
              <DropdownMenuRadioItem key={d} value={String(d)}>
                {t(`dash.range${d}` as "dash.range7")}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WidgetControls({
  slot,
  first,
  last,
  onMove,
  onResize,
  onRemove,
}: {
  slot: Slot;
  first: boolean;
  last: boolean;
  onMove: (by: -1 | 1) => void;
  onResize: (size: Partial<Pick<Slot, "w" | "h">>) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const def = WIDGETS[slot.id];
  const name = t(def.title);
  return (
    <div className="absolute top-1 right-1 z-10 flex items-center gap-0.5 rounded-lg bg-background/95 p-0.5 shadow ring-1 ring-foreground/10">
      <GripVertical className="mx-0.5 size-3.5 text-muted-foreground" aria-hidden />
      <Button
        variant="ghost"
        size="icon-xs"
        disabled={first}
        aria-label={t("dash.moveEarlier", { name })}
        onClick={() => onMove(-1)}
      >
        <ArrowLeft />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        disabled={last}
        aria-label={t("dash.moveLater", { name })}
        onClick={() => onMove(1)}
      >
        <ArrowRight />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="xs" aria-label={t("dash.resize", { name })}>
              {t(WIDTH_NAMES[slot.w])} <ChevronDown />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("dash.width")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={String(slot.w)}
              onValueChange={(v) => onResize({ w: Number(v) as Slot["w"] })}
            >
              {def.spans.map((w) => (
                <DropdownMenuRadioItem key={w} value={String(w)}>
                  {t(WIDTH_NAMES[w])}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          {def.kind !== "kpi" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t("dash.height")}</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={String(slot.h)}
                  onValueChange={(v) => onResize({ h: Number(v) as Slot["h"] })}
                >
                  {HEIGHTS.map((h) => (
                    <DropdownMenuRadioItem key={h} value={String(h)}>
                      {t(`dash.h${h}` as "dash.h1")}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="ghost" size="icon-xs" aria-label={t("dash.remove", { name })} onClick={onRemove}>
        <X />
      </Button>
    </div>
  );
}

function WidgetCatalog({
  open,
  onOpenChange,
  scope,
  layout,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: Scope;
  layout: Layout;
  onAdd: (id: WidgetId) => void;
}) {
  const { t } = useI18n();
  const used = new Set(layout.slots.map((s) => s.id));
  const groups = [
    { kind: "kpi", title: t("dash.group.kpi") },
    { kind: "chart", title: t("dash.group.chart") },
    { kind: "list", title: t("dash.group.list") },
  ] as const;
  const all = widgetsFor(scope);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>{t("dash.addWidget")}</SheetTitle>
          <SheetDescription>{t("dash.catalogHint")}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">
          {all.every((w) => used.has(w.id)) && (
            <p className="text-sm text-muted-foreground">{t("dash.catalogEmpty")}</p>
          )}
          {groups.map((g) => {
            const items = all.filter((w) => w.kind === g.kind && !used.has(w.id));
            if (!items.length) return null;
            return (
              <div key={g.kind} className="space-y-1">
                <h3 className="text-xs font-medium text-muted-foreground">{g.title}</h3>
                <ul className="space-y-1">
                  {items.map((w) => (
                    <li key={w.id}>
                      <button
                        type="button"
                        onClick={() => onAdd(w.id)}
                        className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left ring-1 ring-foreground/10 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        <Plus className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{t(w.title)}</span>
                          <span className="block text-xs text-muted-foreground">{t(w.description)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
