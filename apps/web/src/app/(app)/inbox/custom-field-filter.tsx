"use client";

import { type CustomFieldDef, formatValue, parseCustomFieldFilter } from "@pinwren/core";
import { useState } from "react";
import { DatePicker } from "@/components/date-picker";
import { Button } from "@/components/ui/button";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dateToDay, dayToDate } from "@/lib/custom-fields";
import { useI18n } from "@/lib/i18n/provider";

type Mode = "is" | "any" | "none";

/** How a `cf` filter reads in a chip: `Plan: Pro`, `Plan: any answer`, `Plan: no answer`. */
export function describeFilter(
  cf: string,
  fields: readonly CustomFieldDef[],
  words: { yes: string; no: string; any: string; none: string },
) {
  const { key, value } = parseCustomFieldFilter(cf);
  const def = fields.find((f) => f.key === key);
  const text =
    value === "*"
      ? words.any
      : value === "!"
        ? words.none
        : def
          ? formatValue(
              def,
              def.type === "number"
                ? Number(value)
                : value === "true"
                  ? true
                  : value === "false"
                    ? false
                    : value,
              words.yes,
              words.no,
            )
          : value;
  return { label: def?.label ?? key, text };
}

/**
 * Filter the inbox by one custom field of the chosen project. The value is picked the way the field is answered
 * (an option, Yes/No, a day or some text); "has an answer" and "has no answer" work for every type.
 */
export function CustomFieldFilterDialog({
  open,
  onOpenChange,
  fields,
  current,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fields: readonly CustomFieldDef[];
  current: string | undefined;
  onApply: (cf: string | null) => void;
}) {
  const { t } = useI18n();
  const start = current ? parseCustomFieldFilter(current) : null;
  const [key, setKey] = useState(
    start && fields.some((f) => f.key === start.key) ? start.key : (fields[0]?.key ?? ""),
  );
  const [mode, setMode] = useState<Mode>(
    start ? (start.value === "*" ? "any" : start.value === "!" ? "none" : "is") : "is",
  );
  const [value, setValue] = useState(start && start.value !== "*" && start.value !== "!" ? start.value : "");
  const def = fields.find((f) => f.key === key);

  const apply = () => {
    if (!def) return;
    if (mode === "is" && !value.trim()) return;
    onApply(`${def.key}:${mode === "any" ? "*" : mode === "none" ? "!" : value.trim()}`);
    onOpenChange(false);
  };

  const choices =
    def?.type === "select" || def?.type === "multiselect"
      ? def.options.map((o) => ({ value: o.value, label: o.label }))
      : def?.type === "checkbox"
        ? [
            { value: "true", label: t("cfields.yes") },
            { value: "false", label: t("cfields.no") },
          ]
        : null;
  const modes = [
    { value: "is", label: t("cfields.filterIs") },
    { value: "any", label: t("cfields.filterAny") },
    { value: "none", label: t("cfields.filterNone") },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              apply();
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("cfields.filterTitle")}</DialogTitle>
              <DialogDescription>{t("cfields.filterDescription")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="cff-field">{t("cfields.filterField")}</Label>
              <Select
                items={fields.map((f) => ({ value: f.key, label: f.label }))}
                value={key}
                onValueChange={(v) => {
                  if (!v) return;
                  setKey(v);
                  setValue("");
                }}
              >
                <SelectTrigger id="cff-field" className="w-full" data-testid="cf-filter-field">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {fields.map((f) => (
                    <SelectItem key={f.key} value={f.key}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cff-mode">{t("cfields.filterMatch")}</Label>
              <Select items={modes} value={mode} onValueChange={(v) => v && setMode(v)}>
                <SelectTrigger id="cff-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {modes.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {mode === "is" && def && (
              <div className="grid gap-1.5">
                <Label htmlFor="cff-value">{t("cfields.filterValue")}</Label>
                {choices ? (
                  <Select
                    items={choices}
                    value={choices.some((c) => c.value === value) ? value : null}
                    onValueChange={(v) => v && setValue(v)}
                  >
                    <SelectTrigger id="cff-value" className="w-full" data-testid="cf-filter-value">
                      <SelectValue placeholder={t("cfields.pickValue")} />
                    </SelectTrigger>
                    <SelectContent>
                      {choices.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : def.type === "date" ? (
                  <DatePicker
                    id="cff-value"
                    value={dayToDate(value)}
                    onChange={(d) => setValue(d ? dateToDay(d) : "")}
                  />
                ) : (
                  <Input
                    id="cff-value"
                    value={value}
                    maxLength={200}
                    inputMode={def.type === "number" ? "decimal" : "text"}
                    autoComplete="off"
                    data-testid="cf-filter-value"
                    onChange={(e) => setValue(e.target.value)}
                  />
                )}
                {def.type !== "number" && def.type !== "date" && !choices && (
                  <p className="text-xs text-muted-foreground">{t("cfields.filterContainsHelp")}</p>
                )}
              </div>
            )}
            <DialogFooter>
              {current && (
                <Button
                  type="button"
                  variant="ghost"
                  className="sm:mr-auto"
                  onClick={() => {
                    onApply(null);
                    onOpenChange(false);
                  }}
                >
                  {t("cfields.filterClear")}
                </Button>
              )}
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("cfields.cancel")}
              </Button>
              <Button type="submit" disabled={mode === "is" && !value.trim()} data-testid="cf-filter-apply">
                {t("cfields.filterApply")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
