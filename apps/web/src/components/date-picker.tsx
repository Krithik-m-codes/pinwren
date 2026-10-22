"use client";

import "react-day-picker/style.css";
import { CalendarDays, X } from "lucide-react";
import { useState } from "react";
import { DayPicker } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const format = (d: Date) => d.toLocaleDateString(undefined, { dateStyle: "medium" });

/**
 * A date field on the design system (no browser-native date input): a button showing the date, a
 * calendar in a popover, and a clear button.
 */
export function DatePicker({
  id,
  value,
  onChange,
  placeholder = "Pick a date",
  disabled,
  className,
  "aria-invalid": invalid,
  "aria-describedby": describedBy,
}: {
  id?: string;
  value: Date | null;
  onChange: (date: Date | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "aria-invalid"?: boolean | undefined;
  "aria-describedby"?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id={id}
              type="button"
              variant="outline"
              disabled={disabled}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              className={cn("w-48 justify-start font-normal", !value && "text-muted-foreground")}
            />
          }
        >
          <CalendarDays />
          {value ? format(value) : placeholder}
        </PopoverTrigger>
        <PopoverContent align="start" className="pinwren-calendar w-auto p-2">
          <DayPicker
            mode="single"
            {...(value ? { selected: value, defaultMonth: value } : {})}
            onSelect={(d) => {
              onChange(d ?? null);
              setOpen(false);
            }}
            showOutsideDays
          />
        </PopoverContent>
      </Popover>
      {value && !disabled && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Clear date"
          onClick={() => onChange(null)}
        >
          <X />
        </Button>
      )}
    </div>
  );
}
