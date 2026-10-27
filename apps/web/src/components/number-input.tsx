"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { useSyncedState } from "@/lib/use-synced-state";

/**
 * Whole-number field without the browser's native spinner: free typing, validated on blur / Enter,
 * reverting to the last good value when out of range. `null` = empty (when `allowEmpty`).
 */
export function NumberInput({
  id,
  value,
  onCommit,
  onChange,
  min,
  max,
  allowEmpty = false,
  placeholder,
  suffix,
  className,
  disabled,
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: number | null;
  /** Every valid value on blur / Enter — callers skip no-ops. */
  onCommit: (value: number | null) => void;
  /** Live, valid values while typing (previews). */
  onChange?: (value: number) => void;
  min: number;
  max: number;
  allowEmpty?: boolean;
  placeholder?: string;
  suffix?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const t = useT();
  const [text, setText] = useSyncedState(value === null ? "" : String(value), value);
  const [error, setError] = useState<string | null>(null);

  const parse = (raw: string): { ok: true; n: number | null } | { ok: false; msg: string } => {
    const s = raw.trim();
    if (!s) return allowEmpty ? { ok: true, n: null } : { ok: false, msg: t("components2.numberRequired") };
    if (!/^\d+$/.test(s)) return { ok: false, msg: t("components2.numberWholeOnly") };
    const n = Number(s);
    if (n < min || n > max) return { ok: false, msg: t("components2.numberBetween", { min, max }) };
    return { ok: true, n };
  };

  const commit = () => {
    const r = parse(text);
    if (!r.ok) {
      setError(r.msg);
      return;
    }
    setError(null);
    onCommit(r.n);
  };

  return (
    <div className={cn("grid gap-1", className)}>
      <div className="relative">
        <Input
          id={id}
          inputMode="numeric"
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-invalid={!!error || undefined}
          className={cn("tabular-nums", suffix && "pr-12")}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
            const r = parse(e.target.value);
            if (r.ok && r.n !== null) onChange?.(r.n);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              const cur = Number(text) || 0;
              const next = Math.min(max, Math.max(min, cur + (e.key === "ArrowUp" ? 1 : -1)));
              setText(String(next));
              onChange?.(next);
            }
          }}
        />
        {suffix && (
          <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
