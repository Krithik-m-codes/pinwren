"use client";

import type { CustomFieldBase, CustomFieldValue } from "@pinwren/core";
import { useState } from "react";
import { DatePicker } from "@/components/date-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n/provider";
import { answerFor, dateToDay, dayToDate } from "@/lib/custom-fields";

/** What a control needs to know about a field (a saved definition or a draft in the builder). */
export type ControlField = Pick<
  CustomFieldBase,
  "key" | "type" | "label" | "placeholder" | "options" | "validation"
>;

const NONE = "__none__";

/**
 * One input for one custom field, on the design system (no browser-native pickers). Controlled: `value` is
 * the stored answer (or null) and `onChange` gets the new one (null clears it). Used by the item's field card,
 * the builder's live preview and default-value editor.
 */
export function FieldControl({
  field,
  value,
  onChange,
  id,
  invalid,
  describedBy,
  disabled,
  checkboxLabel,
  optionLabel,
}: {
  field: ControlField;
  value: unknown;
  onChange: (value: CustomFieldValue | null) => void;
  id: string;
  invalid?: boolean | undefined;
  describedBy?: string | undefined;
  disabled?: boolean | undefined;
  /** Shown next to a checkbox (the field's label, or "Yes"). */
  checkboxLabel?: string | undefined;
  /** An option's label in the viewer's language (the preview translates). */
  optionLabel?: ((o: { value: string; label: string }) => string) | undefined;
}) {
  const t = useT();
  const answer = answerFor(field.type, value);
  const aria = {
    id,
    "aria-invalid": invalid ? true : undefined,
    "aria-describedby": describedBy,
    disabled,
  } as const;
  const labelOf = (o: { value: string; label: string }) => optionLabel?.(o) ?? o.label;

  switch (field.type) {
    case "textarea":
      return (
        <Textarea
          {...aria}
          rows={3}
          maxLength={field.validation.maxLength ?? 2000}
          placeholder={field.placeholder}
          value={typeof answer === "string" ? answer : ""}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case "number":
      return (
        <NumberField
          {...aria}
          field={field}
          value={typeof answer === "number" ? answer : null}
          onChange={onChange}
        />
      );
    case "date":
      return (
        <DatePicker
          id={id}
          value={dayToDate(answer)}
          onChange={(d) => onChange(d ? dateToDay(d) : null)}
          disabled={disabled ?? false}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
        />
      );
    case "select": {
      const items = [
        { value: NONE, label: field.placeholder || t("cfields.noAnswer") },
        ...field.options.map((o) => ({ value: o.value, label: labelOf(o) || o.value })),
      ];
      return (
        <Select
          items={items}
          value={typeof answer === "string" && field.options.some((o) => o.value === answer) ? answer : NONE}
          onValueChange={(v) => onChange(v && v !== NONE ? v : null)}
          disabled={disabled}
        >
          <SelectTrigger
            id={id}
            className="w-full"
            aria-invalid={invalid ? true : undefined}
            aria-describedby={describedBy}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((i) => (
              <SelectItem key={i.value} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    case "multiselect": {
      const on = Array.isArray(answer) ? answer : [];
      return (
        <div role="group" id={id} aria-describedby={describedBy} className="grid gap-1.5">
          {field.options.map((o, i) => (
            <label key={o.value} className="flex items-center gap-2 text-sm" htmlFor={`${id}-${i}`}>
              <Checkbox
                id={`${id}-${i}`}
                checked={on.includes(o.value)}
                disabled={disabled}
                onCheckedChange={(c) => {
                  const next = c ? [...on, o.value] : on.filter((x) => x !== o.value);
                  onChange(
                    next.length ? field.options.map((p) => p.value).filter((x) => next.includes(x)) : null,
                  );
                }}
              />
              {labelOf(o) || o.value}
            </label>
          ))}
        </div>
      );
    }
    case "checkbox":
      return (
        <label className="flex items-center gap-2 text-sm" htmlFor={id}>
          <Checkbox
            id={id}
            checked={answer === true}
            disabled={disabled}
            aria-invalid={invalid ? true : undefined}
            aria-describedby={describedBy}
            onCheckedChange={(c) => onChange(c)}
          />
          {checkboxLabel ?? t("cfields.yes")}
        </label>
      );
    default:
      // text, url and email are plain text fields: the server decides what is valid, so the browser's own
      // validation bubbles never appear.
      return (
        <Input
          {...aria}
          type="text"
          inputMode={field.type === "email" ? "email" : field.type === "url" ? "url" : "text"}
          autoComplete="off"
          maxLength={
            field.validation.maxLength ?? (field.type === "email" ? 254 : field.type === "url" ? 2000 : 500)
          }
          placeholder={field.placeholder}
          value={typeof answer === "string" ? answer : ""}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
  }
}

/** A number typed freely (decimals, minus sign) and reported as a number once it parses. */
function NumberField({
  field,
  value,
  onChange,
  ...aria
}: {
  field: ControlField;
  value: number | null;
  onChange: (v: CustomFieldValue | null) => void;
  id: string;
  "aria-invalid": boolean | undefined;
  "aria-describedby": string | undefined;
  disabled: boolean | undefined;
}) {
  // Starts from the stored value; callers remount (`key`) to load another one, so typing is never overwritten.
  const [text, setText] = useState(value === null ? "" : String(value));
  return (
    <Input
      {...aria}
      type="text"
      inputMode={field.validation.integer ? "numeric" : "decimal"}
      autoComplete="off"
      placeholder={field.placeholder}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const s = raw.trim();
        if (!s) {
          onChange(null);
          return;
        }
        const n = Number(s);
        // Not a number yet ("-", "1e"): report the text so the check says "enter a number" instead of dropping it.
        onChange(Number.isFinite(n) ? n : s);
      }}
    />
  );
}
