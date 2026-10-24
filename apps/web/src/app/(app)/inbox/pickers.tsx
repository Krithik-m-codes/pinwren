"use client";

import { Loader2, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { StatusIcon } from "@/components/feedback-meta";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserAvatar } from "@/components/user-avatar";
import type { FeedbackRow, ItemLabel } from "@/lib/api";
import {
  errorMessage,
  useCreateLabelMutation,
  useLabelsQuery,
  useListFeedbackInfiniteQuery,
} from "@/lib/store/api";
import { listItems } from "@/lib/store/api/feedback";
import { cn } from "@/lib/utils";
import { useMembers } from "@/lib/viewer";

// Pickers of the triage inbox (detail header, bulk bar): searchable lists in a popover, built from the
// design system's Command (no native selects). Multi-selects stay open while toggling.

/** Colours new labels cycle through (the colour picker's swatches). */
export const LABEL_COLORS = [
  "#e5484d",
  "#f76b15",
  "#ffc53d",
  "#30a46c",
  "#12a594",
  "#0090ff",
  "#3e63dd",
  "#8e4ec6",
  "#d6409f",
  "#71717a",
] as const;

/** A stable colour for a new label's name. */
export function colorFor(name: string): string {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return LABEL_COLORS[h % LABEL_COLORS.length] ?? LABEL_COLORS[0];
}

export function LabelDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full ring-1 ring-foreground/10", className)}
      style={{ background: color }}
    />
  );
}

/** Labels as small chips (list rows, board cards, the detail). */
export function LabelChips({
  labels,
  max = 3,
  className,
}: {
  labels: readonly ItemLabel[];
  max?: number;
  className?: string;
}) {
  if (!labels.length) return null;
  const shown = labels.slice(0, max);
  return (
    <span className={cn("flex min-w-0 items-center gap-1", className)} data-testid="labels">
      {shown.map((l) => (
        <span
          key={l.id}
          className="inline-flex max-w-28 items-center gap-1 rounded-full border px-1.5 py-px text-[11px] leading-4 text-foreground/80"
        >
          <LabelDot color={l.color} className="size-1.5" />
          <span className="truncate">{l.name}</span>
        </span>
      ))}
      {labels.length > max && (
        <span className="text-[11px] text-muted-foreground tabular-nums">+{labels.length - max}</span>
      )}
    </span>
  );
}

type PopoverProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The trigger element (rendered by the popover). */
  trigger: React.ReactElement;
  /** Accessible name of the trigger. */
  label: string;
  align?: "start" | "end";
  side?: "top" | "bottom";
};

/**
 * Pick an item's labels (`l`). Members who may manage labels (Admins, Editors) create one by typing a new
 * name; it takes a colour of its own and is added at once.
 */
export function LabelPicker({
  projectId,
  selected,
  onChange,
  canCreate,
  open,
  onOpenChange,
  trigger,
  label,
  align = "start",
  side = "bottom",
}: PopoverProps & {
  projectId: string;
  selected: readonly ItemLabel[];
  onChange: (labels: ItemLabel[]) => void;
  canCreate: boolean;
}) {
  const labels = useLabelsQuery(projectId, { skip: !open });
  const [createLabel, creating] = useCreateLabelMutation();
  const [search, setSearch] = useState("");
  const chosen = new Set(selected.map((l) => l.id));
  const all = labels.data?.labels ?? [];
  const name = search.trim();
  const exists = all.some((l) => l.name.toLowerCase() === name.toLowerCase());

  const toggle = (l: ItemLabel) =>
    onChange(
      chosen.has(l.id)
        ? selected.filter((x) => x.id !== l.id)
        : [...selected, { id: l.id, name: l.name, color: l.color }],
    );
  const create = () => {
    if (!name || name.length > 40) return;
    createLabel({ projectId, name, color: colorFor(name) })
      .unwrap()
      .then(({ label: l }) => {
        setSearch("");
        onChange([...selected, { id: l.id, name: l.name, color: l.color }]);
      })
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (!o) setSearch("");
        onOpenChange(o);
      }}
    >
      <PopoverTrigger render={trigger} aria-label={label} />
      <PopoverContent align={align} side={side} className="w-60 p-0">
        <Command>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder={canCreate ? "Find or create a label…" : "Find a label…"}
            aria-label="Find a label"
          />
          <CommandList>
            {labels.isLoading && (
              <p className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Loading labels…
              </p>
            )}
            {labels.isError && (
              <p className="px-3 py-2 text-sm text-destructive">
                {errorMessage(labels.error)}{" "}
                <button type="button" className="underline" onClick={() => void labels.refetch()}>
                  Retry
                </button>
              </p>
            )}
            {labels.isSuccess && (
              <CommandEmpty>
                {all.length ? "No label matches." : "This project has no labels yet."}
              </CommandEmpty>
            )}
            {all.length > 0 && (
              <CommandGroup>
                {all.map((l) => (
                  <CommandItem
                    key={l.id}
                    value={l.name}
                    data-checked={chosen.has(l.id)}
                    onSelect={() => toggle(l)}
                  >
                    <LabelDot color={l.color} />
                    <span className="truncate">{l.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {canCreate && labels.isSuccess && name && !exists && (
              <CommandGroup forceMount>
                <CommandItem
                  value={`create ${name}`}
                  forceMount
                  disabled={creating.isLoading}
                  onSelect={create}
                >
                  {creating.isLoading ? <Loader2 className="animate-spin" /> : <Plus />}
                  <span className="truncate">Create “{name.slice(0, 40)}”</span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Pick any number of assignees (`a`); the API takes up to 20. */
export function AssigneesPicker({
  value,
  onChange,
  open,
  onOpenChange,
  trigger,
  label,
  align = "start",
  side = "bottom",
}: PopoverProps & { value: readonly string[]; onChange: (ids: string[]) => void }) {
  const members = useMembers();
  const chosen = new Set(value);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={trigger} aria-label={label} />
      <PopoverContent align={align} side={side} className="w-60 p-0">
        <Command>
          <CommandInput placeholder="Find a member…" aria-label="Find a member" />
          <CommandList>
            <CommandEmpty>No member matches.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="Unassigned" data-checked={value.length === 0} onSelect={() => onChange([])}>
                Unassigned
              </CommandItem>
              {members.map((m) => (
                <CommandItem
                  key={m.id}
                  value={`${m.name} ${m.email}`}
                  data-checked={chosen.has(m.id)}
                  onSelect={() =>
                    onChange(
                      chosen.has(m.id) ? value.filter((x) => x !== m.id) : [...value, m.id].slice(0, 20),
                    )
                  }
                >
                  <UserAvatar name={m.name} image={m.image} className="size-4" />
                  <span className="truncate">{m.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const SEARCH_DEBOUNCE_MS = 250;

/** Find another item of the project by number or words ("Mark duplicate of…"). */
export function ItemSearchPicker({
  projectId,
  excludeId,
  onPick,
  open,
  onOpenChange,
  trigger,
  label,
  align = "end",
  side = "bottom",
}: PopoverProps & {
  projectId: string;
  excludeId: string;
  onPick: (item: FeedbackRow) => void;
}) {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);
  const results = useListFeedbackInfiniteQuery(
    { projectId, status: "all", limit: 20, ...(q ? { q } : {}) },
    { skip: !open },
  );
  const items = listItems(results.data).filter((i) => i.id !== excludeId);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (!o) setSearch("");
        onOpenChange(o);
      }}
    >
      <PopoverTrigger render={trigger} aria-label={label} />
      <PopoverContent align={align} side={side} className="w-80 p-0">
        <Command shouldFilter={false}>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search by #number or words…"
            aria-label="Search items"
          />
          <CommandList>
            {results.isFetching && !items.length && (
              <p className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Searching…
              </p>
            )}
            {results.isError && (
              <p className="px-3 py-2 text-sm text-destructive">{errorMessage(results.error)}</p>
            )}
            {results.isSuccess && !items.length && !results.isFetching && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">No other item matches.</p>
            )}
            {items.length > 0 && (
              <CommandGroup>
                {items.map((i) => (
                  <CommandItem key={i.id} value={i.id} onSelect={() => onPick(i)}>
                    <StatusIcon status={i.status} />
                    <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                      #{i.number}
                    </span>
                    <span className="truncate">{i.title || i.body}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
