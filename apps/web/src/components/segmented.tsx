"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

/**
 * Single-choice segmented control on Base UI ToggleGroup (arrow keys move, Space/Enter picks). Never
 * empty: clicking the active option keeps it.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  disabled,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: React.ReactNode; title?: string }[];
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      disabled={disabled}
      onValueChange={(v) => {
        const next = v[0] as T | undefined;
        if (next && next !== value) onChange(next);
      }}
      spacing={0}
      className={cn("rounded-lg bg-muted p-0.5", className)}
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          size="sm"
          aria-label={o.title}
          title={o.title}
          className="rounded-md! border-0 px-2.5 text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs dark:aria-pressed:bg-input/50"
        >
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
