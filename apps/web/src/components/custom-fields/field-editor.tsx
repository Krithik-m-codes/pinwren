"use client";

import {
  CUSTOM_FIELD_KEY,
  CUSTOM_FIELD_TYPES,
  type CustomFieldBase,
  type CustomFieldType,
  customFieldInput,
  FEEDBACK_KINDS,
  MAX_FIELD_OPTIONS,
  TEXT_LIMITS,
} from "@pinwren/core";
import { ChevronDown, ChevronUp, Languages, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { DatePicker } from "@/components/date-picker";
import { FieldError } from "@/components/form";
import { NumberInput } from "@/components/number-input";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Switch } from "@/components/ui/switch";
import { KIND_META } from "@/components/feedback-meta";
import { dateToDay, dayToDate, FIELD_TYPE_META, keyFromLabel, optionValue } from "@/lib/custom-fields";
import type { Key } from "@/lib/i18n/en";
import { useI18n } from "@/lib/i18n/provider";
import { LOCALE_NAMES, LOCALES } from "@/lib/i18n/translate";
import { FieldControl } from "./field-control";

type Strings = CustomFieldBase["strings"];
type Locale = (typeof LOCALES)[number];
type Problems = Partial<
  Record<
    "label" | "key" | "kinds" | "options" | "range" | "default" | "form",
    { key: Key; vars?: Record<string, string | number> } | string
  >
>;

const TRANSLATABLE = LOCALES.filter((l): l is Exclude<Locale, "en"> => l !== "en");
const hasOptions = (type: CustomFieldType) => type === "select" || type === "multiselect";

/** What is wrong with a draft, worded for the dialog. The API runs the same rules again when the form is saved. */
export function problemsOf(f: CustomFieldBase, otherKeys: ReadonlySet<string>): Problems {
  const p: Problems = {};
  if (!f.label.trim()) p.label = { key: "cfields.errLabel" };
  if (!CUSTOM_FIELD_KEY.test(f.key)) p.key = { key: "cfields.errKeyFormat" };
  else if (otherKeys.has(f.key)) p.key = { key: "cfields.errKeyTaken" };
  if (!f.kinds.length) p.kinds = { key: "cfields.errKinds" };
  if (hasOptions(f.type)) {
    if (!f.options.length) p.options = { key: "cfields.errNoOptions" };
    else if (f.options.some((o) => !o.label.trim() || !o.value.trim()))
      p.options = { key: "cfields.errOptionBlank" };
    else if (new Set(f.options.map((o) => o.value)).size !== f.options.length)
      p.options = { key: "cfields.errOptionDuplicate" };
  }
  const v = f.validation;
  const pairs: [number | string | undefined, number | string | undefined][] = [
    [v.minLength, v.maxLength],
    [v.min, v.max],
    [v.minDate, v.maxDate],
    [v.minSelected, v.maxSelected],
  ];
  if (pairs.some(([a, b]) => a !== undefined && b !== undefined && a > b))
    p.range = { key: "cfields.errRange" };
  if (f.audience === "internal" && f.required) p.form = { key: "cfields.errInternalRequired" };
  return p;
}

/** Add or change one field of the form. Changes stay in the builder until the form is saved. */
export function FieldEditor({
  open,
  onOpenChange,
  initial,
  locked,
  takenKeys,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: CustomFieldBase;
  /** The field exists on the server: its key (the identity of its answers) can't change. */
  locked: boolean;
  takenKeys: ReadonlySet<string>;
  onSave: (field: CustomFieldBase) => void;
}) {
  const { t, tm } = useI18n();
  const [f, setF] = useState<CustomFieldBase>(initial);
  const [keyTouched, setKeyTouched] = useState(locked);
  const [problems, setProblems] = useState<Problems>({});
  const [showStrings, setShowStrings] = useState(Object.keys(initial.strings).length > 0);
  const [locale, setLocale] = useState<Exclude<Locale, "en">>(TRANSLATABLE[0] ?? "es");
  const set = (patch: Partial<CustomFieldBase>) => setF((cur) => ({ ...cur, ...patch }));
  const setRule = (patch: Partial<CustomFieldBase["validation"]>) =>
    setF((cur) => {
      // A cleared rule (undefined) leaves the object, so the saved field carries only the limits that are set.
      const next = Object.fromEntries(
        Object.entries({ ...cur.validation, ...patch }).filter(([, v]) => v !== undefined),
      );
      return { ...cur, validation: next };
    });
  const msg = (p: Problems[keyof Problems]) => {
    const m = p;
    return m ? (typeof m === "string" ? tm(m) : t(m.key, m.vars)) : undefined;
  };

  const typeItems = CUSTOM_FIELD_TYPES.map((x) => ({ value: x, label: t(FIELD_TYPE_META[x].labelKey) }));
  const type = f.type;
  const saved = locked ? initial.type : null;

  const changeType = (next: CustomFieldType) => {
    setF((cur) => ({
      ...cur,
      type: next,
      options: hasOptions(next)
        ? cur.options.length
          ? cur.options
          : [{ value: "option-1", label: "" }]
        : [],
      // A default of the old type means nothing to the new one.
      defaultValue: null,
      validation: {},
      pii: next === "email" ? true : cur.pii,
    }));
  };

  const save = () => {
    const found = problemsOf(f, takenKeys);
    if (Object.keys(found).length) {
      setProblems(found);
      return;
    }
    const parsed = customFieldInput.safeParse(f);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setProblems({ form: issue ? issue.message : t("cfields.errGeneric") });
      return;
    }
    // Keep the editor's own shape (all defaults present) but with the server's cleaning applied.
    onSave({ ...f, ...parsed.data, helpText: parsed.data.helpText, placeholder: parsed.data.placeholder });
    onOpenChange(false);
  };

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= f.options.length) return;
    const next = [...f.options];
    const a = next[i];
    const b = next[j];
    if (!a || !b) return;
    next[i] = b;
    next[j] = a;
    set({ options: next });
  };
  const setStrings = (loc: Exclude<Locale, "en">, patch: Partial<NonNullable<Strings[typeof loc]>>) =>
    set({ strings: { ...f.strings, [loc]: { ...f.strings[loc], ...patch } } });
  const localized = f.strings[locale] ?? {};
  const translatedCount = Object.keys(f.strings).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] gap-0 overflow-y-auto p-0 sm:max-w-2xl"
        data-testid="field-editor"
      >
        <form
          className="grid gap-4 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <DialogHeader>
            <DialogTitle>{locked ? t("cfields.editFieldTitle") : t("cfields.newFieldTitle")}</DialogTitle>
            <DialogDescription>{t("cfields.editorDescription")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="cf-label">{t("cfields.label")}</Label>
              <Input
                id="cf-label"
                value={f.label}
                maxLength={80}
                aria-invalid={problems.label ? true : undefined}
                aria-describedby={problems.label ? "cf-label-error" : undefined}
                placeholder={t("cfields.labelPlaceholder")}
                onChange={(e) => {
                  const label = e.target.value;
                  set({ label, ...(keyTouched ? {} : { key: keyFromLabel(label, takenKeys) }) });
                }}
              />
              <FieldError id="cf-label" message={msg(problems.label)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cf-type">{t("cfields.type")}</Label>
              <Select items={typeItems} value={type} onValueChange={(v) => v && changeType(v)}>
                <SelectTrigger id="cf-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {typeItems.map((i) => (
                    <SelectItem key={i.value} value={i.value}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {locked && saved && type !== saved && (
                <p className="text-xs text-amber-700 dark:text-amber-400">{t("cfields.typeChangeWarning")}</p>
              )}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="cf-key">{t("cfields.key")}</Label>
            <Input
              id="cf-key"
              value={f.key}
              maxLength={40}
              disabled={locked}
              className="font-mono"
              aria-invalid={problems.key ? true : undefined}
              aria-describedby={problems.key ? "cf-key-error cf-key-help" : "cf-key-help"}
              onChange={(e) => {
                setKeyTouched(true);
                set({ key: e.target.value.toLowerCase() });
              }}
            />
            <p id="cf-key-help" className="text-xs text-muted-foreground">
              {locked ? t("cfields.keyLocked") : t("cfields.keyHelp")}
            </p>
            <FieldError id="cf-key" message={msg(problems.key)} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="cf-help">{t("cfields.helpText")}</Label>
              <Input
                id="cf-help"
                value={f.helpText}
                maxLength={300}
                placeholder={t("cfields.helpTextPlaceholder")}
                onChange={(e) => set({ helpText: e.target.value })}
              />
            </div>
            {type !== "checkbox" && type !== "multiselect" && (
              <div className="grid gap-1.5">
                <Label htmlFor="cf-placeholder">{t("cfields.placeholder")}</Label>
                <Input
                  id="cf-placeholder"
                  value={f.placeholder}
                  maxLength={120}
                  onChange={(e) => set({ placeholder: e.target.value })}
                />
              </div>
            )}
          </div>

          {hasOptions(type) && (
            <fieldset
              className="grid gap-2"
              aria-describedby={problems.options ? "cf-options-error" : undefined}
            >
              <legend className="mb-1 text-sm font-medium">{t("cfields.options")}</legend>
              <ul className="grid gap-2">
                {f.options.map((o, i) => (
                  <li
                    key={`${i}-${f.options.length}`}
                    className="grid grid-cols-[1fr_1fr_auto] items-center gap-2"
                  >
                    <Input
                      aria-label={t("cfields.optionLabel", { n: i + 1 })}
                      value={o.label}
                      maxLength={80}
                      placeholder={t("cfields.optionLabelPlaceholder")}
                      onChange={(e) => {
                        const label = e.target.value;
                        const others = new Set(f.options.filter((_, j) => j !== i).map((x) => x.value));
                        const auto =
                          o.value === "" ||
                          o.value === optionValue(o.label, others) ||
                          /^option-\d+$/.test(o.value);
                        const next = [...f.options];
                        next[i] = { label, value: auto ? optionValue(label, others) : o.value };
                        set({ options: next });
                      }}
                    />
                    <Input
                      aria-label={t("cfields.optionValue", { n: i + 1 })}
                      value={o.value}
                      maxLength={TEXT_LIMITS.option}
                      className="font-mono"
                      onChange={(e) => {
                        const next = [...f.options];
                        next[i] = { label: o.label, value: e.target.value };
                        set({ options: next });
                      }}
                    />
                    <div className="flex items-center">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t("cfields.moveOptionUp", { n: i + 1 })}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ChevronUp />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t("cfields.moveOptionDown", { n: i + 1 })}
                        disabled={i === f.options.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ChevronDown />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t("cfields.removeOption", { n: i + 1 })}
                        disabled={f.options.length === 1}
                        onClick={() => set({ options: f.options.filter((_, j) => j !== i) })}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={f.options.length >= MAX_FIELD_OPTIONS}
                  onClick={() => {
                    const taken = new Set(f.options.map((x) => x.value));
                    set({ options: [...f.options, { label: "", value: optionValue("", taken) }] });
                  }}
                >
                  <Plus /> {t("cfields.addOption")}
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {f.options.length} / {MAX_FIELD_OPTIONS}
                </span>
              </div>
              <FieldError id="cf-options" message={msg(problems.options)} />
            </fieldset>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <span className="text-sm font-medium" id="cf-audience-label">
                {t("cfields.audience")}
              </span>
              <Segmented
                label={t("cfields.audience")}
                value={f.audience}
                onChange={(audience) =>
                  set({ audience, ...(audience === "internal" ? { required: false } : {}) })
                }
                options={[
                  { value: "reporter", label: t("cfields.audienceReporter") },
                  { value: "internal", label: t("cfields.audienceInternal") },
                ]}
              />
              <p className="text-xs text-muted-foreground">
                {f.audience === "reporter"
                  ? t("cfields.audienceReporterHelp")
                  : t("cfields.audienceInternalHelp")}
              </p>
            </div>
            <fieldset
              className="grid gap-1.5"
              aria-describedby={problems.kinds ? "cf-kinds-error" : undefined}
            >
              <legend className="mb-1 text-sm font-medium">{t("cfields.appliesTo")}</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {FEEDBACK_KINDS.map((k) => (
                  <label key={k} htmlFor={`cf-kind-${k}`} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      id={`cf-kind-${k}`}
                      checked={f.kinds.includes(k)}
                      onCheckedChange={(c) =>
                        set({
                          kinds: c
                            ? FEEDBACK_KINDS.filter((x) => x === k || f.kinds.includes(x))
                            : f.kinds.filter((x) => x !== k),
                        })
                      }
                    />
                    {t(KIND_META[k].labelKey)}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{t("cfields.appliesToHelp")}</p>
              <FieldError id="cf-kinds" message={msg(problems.kinds)} />
            </fieldset>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label htmlFor="cf-required" className="flex items-start gap-3 text-sm">
              <Switch
                id="cf-required"
                checked={f.required}
                disabled={f.audience === "internal"}
                onCheckedChange={(required) => set({ required })}
              />
              <span>
                <span className="font-medium">{t("cfields.required")}</span>
                <span className="block text-xs text-muted-foreground">
                  {f.audience === "internal" ? t("cfields.requiredInternalHelp") : t("cfields.requiredHelp")}
                </span>
              </span>
            </label>
            <label htmlFor="cf-pii" className="flex items-start gap-3 text-sm">
              <Switch id="cf-pii" checked={f.pii} onCheckedChange={(pii) => set({ pii })} />
              <span>
                <span className="font-medium">{t("cfields.pii")}</span>
                <span className="block text-xs text-muted-foreground">{t("cfields.piiHelp")}</span>
              </span>
            </label>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="cf-default">{t("cfields.defaultValue")}</Label>
            <FieldControl
              key={`${type}-${f.options.map((o) => o.value).join("|")}`}
              id="cf-default"
              field={{ ...f, label: t("cfields.defaultValue") }}
              value={f.defaultValue}
              checkboxLabel={t("cfields.tickedByDefault")}
              onChange={(v) => set({ defaultValue: v })}
            />
            <FieldError id="cf-default" message={msg(problems.default)} />
          </div>

          <Rules f={f} setRule={setRule} />
          {problems.range && <FieldError id="cf-range" message={msg(problems.range)} />}

          <div className="grid gap-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <Languages className="size-4" /> {t("cfields.translations")}
                  {translatedCount > 0 && (
                    <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">
                      {translatedCount}
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">{t("cfields.translationsHelp")}</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-expanded={showStrings}
                onClick={() => setShowStrings((s) => !s)}
              >
                {showStrings ? t("cfields.hide") : t("cfields.show")}
              </Button>
            </div>
            {showStrings && (
              <div className="grid gap-3">
                <div className="grid gap-1.5 sm:max-w-xs">
                  <Label htmlFor="cf-locale">{t("cfields.language")}</Label>
                  <Select
                    items={TRANSLATABLE.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))}
                    value={locale}
                    onValueChange={(v) => v && setLocale(v)}
                  >
                    <SelectTrigger id="cf-locale" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TRANSLATABLE.map((l) => (
                        <SelectItem key={l} value={l}>
                          {LOCALE_NAMES[l]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-3 sm:grid-cols-2" key={locale}>
                  <div className="grid gap-1.5">
                    <Label htmlFor="cf-s-label">{t("cfields.label")}</Label>
                    <Input
                      id="cf-s-label"
                      value={localized.label ?? ""}
                      maxLength={80}
                      placeholder={f.label}
                      onChange={(e) => setStrings(locale, { label: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="cf-s-help">{t("cfields.helpText")}</Label>
                    <Input
                      id="cf-s-help"
                      value={localized.helpText ?? ""}
                      maxLength={300}
                      placeholder={f.helpText}
                      onChange={(e) => setStrings(locale, { helpText: e.target.value })}
                    />
                  </div>
                  {type !== "checkbox" && type !== "multiselect" && (
                    <div className="grid gap-1.5">
                      <Label htmlFor="cf-s-ph">{t("cfields.placeholder")}</Label>
                      <Input
                        id="cf-s-ph"
                        value={localized.placeholder ?? ""}
                        maxLength={120}
                        placeholder={f.placeholder}
                        onChange={(e) => setStrings(locale, { placeholder: e.target.value })}
                      />
                    </div>
                  )}
                  {hasOptions(type) &&
                    f.options.map((o, i) => (
                      <div className="grid gap-1.5" key={`${o.value}-${i}`}>
                        <Label htmlFor={`cf-s-o${i}`}>{t("cfields.optionLabel", { n: i + 1 })}</Label>
                        <Input
                          id={`cf-s-o${i}`}
                          value={localized.options?.[o.value] ?? ""}
                          maxLength={80}
                          placeholder={o.label}
                          onChange={(e) =>
                            setStrings(locale, {
                              options: { ...localized.options, [o.value]: e.target.value },
                            })
                          }
                        />
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>

          {problems.form && (
            <p role="alert" className="text-sm text-destructive">
              {msg(problems.form)}
            </p>
          )}

          <DialogFooter className="-mx-4 -mb-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("cfields.cancel")}
            </Button>
            <Button type="submit" data-testid="save-field">
              {locked ? t("cfields.applyChanges") : t("cfields.addField")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The limits a type understands (the API drops the others). */
function Rules({
  f,
  setRule,
}: {
  f: CustomFieldBase;
  setRule: (patch: Partial<CustomFieldBase["validation"]>) => void;
}) {
  const { t } = useI18n();
  const v = f.validation;
  const cap = f.type === "textarea" ? TEXT_LIMITS.textarea : TEXT_LIMITS.text;
  if (f.type === "text" || f.type === "textarea")
    return (
      <RuleGrid title={t("cfields.rules")}>
        <div className="grid gap-1.5">
          <Label htmlFor="cf-minlen">{t("cfields.minLength")}</Label>
          <NumberInput
            id="cf-minlen"
            value={v.minLength ?? null}
            min={0}
            max={cap}
            allowEmpty
            onCommit={(n) => setRule({ minLength: n ?? undefined })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cf-maxlen">{t("cfields.maxLength")}</Label>
          <NumberInput
            id="cf-maxlen"
            value={v.maxLength ?? null}
            min={1}
            max={cap}
            allowEmpty
            onCommit={(n) => setRule({ maxLength: n ?? undefined })}
          />
        </div>
      </RuleGrid>
    );
  if (f.type === "number")
    return (
      <RuleGrid title={t("cfields.rules")}>
        <div className="grid gap-1.5">
          <Label htmlFor="cf-min">{t("cfields.minValue")}</Label>
          <DecimalInput id="cf-min" value={v.min} onChange={(n) => setRule({ min: n })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cf-max">{t("cfields.maxValue")}</Label>
          <DecimalInput id="cf-max" value={v.max} onChange={(n) => setRule({ max: n })} />
        </div>
        <label htmlFor="cf-int" className="flex items-center gap-2 text-sm sm:col-span-2">
          <Switch
            id="cf-int"
            checked={v.integer === true}
            onCheckedChange={(c) => setRule({ integer: c || undefined })}
          />
          {t("cfields.integerOnly")}
        </label>
      </RuleGrid>
    );
  if (f.type === "date")
    return (
      <RuleGrid title={t("cfields.rules")}>
        <div className="grid gap-1.5">
          <Label htmlFor="cf-mind">{t("cfields.minDate")}</Label>
          <DatePicker
            id="cf-mind"
            value={dayToDate(v.minDate)}
            onChange={(d) => setRule({ minDate: d ? dateToDay(d) : undefined })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cf-maxd">{t("cfields.maxDate")}</Label>
          <DatePicker
            id="cf-maxd"
            value={dayToDate(v.maxDate)}
            onChange={(d) => setRule({ maxDate: d ? dateToDay(d) : undefined })}
          />
        </div>
      </RuleGrid>
    );
  if (f.type === "multiselect")
    return (
      <RuleGrid title={t("cfields.rules")}>
        <div className="grid gap-1.5">
          <Label htmlFor="cf-mins">{t("cfields.minSelected")}</Label>
          <NumberInput
            id="cf-mins"
            value={v.minSelected ?? null}
            min={0}
            max={Math.max(1, f.options.length)}
            allowEmpty
            onCommit={(n) => setRule({ minSelected: n ?? undefined })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cf-maxs">{t("cfields.maxSelected")}</Label>
          <NumberInput
            id="cf-maxs"
            value={v.maxSelected ?? null}
            min={1}
            max={Math.max(1, f.options.length)}
            allowEmpty
            onCommit={(n) => setRule({ maxSelected: n ?? undefined })}
          />
        </div>
      </RuleGrid>
    );
  return null;
}

function RuleGrid({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-3 sm:grid-cols-2">
      <legend className="mb-2 text-sm font-medium">{title}</legend>
      {children}
    </fieldset>
  );
}

/** A decimal number typed freely; empty clears the limit. */
function DecimalInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: number | undefined;
  onChange: (n: number | undefined) => void;
}) {
  const [textValue, setTextValue] = useState(value === undefined ? "" : String(value));
  return (
    <Input
      id={id}
      inputMode="decimal"
      autoComplete="off"
      value={textValue}
      aria-invalid={textValue.trim() !== "" && !Number.isFinite(Number(textValue)) ? true : undefined}
      onChange={(e) => {
        setTextValue(e.target.value);
        const s = e.target.value.trim();
        if (!s) onChange(undefined);
        else if (Number.isFinite(Number(s))) onChange(Number(s));
      }}
    />
  );
}
