"use client";

import {
  type CustomFieldBase,
  type CustomFieldValue,
  type FeedbackKind,
  normalizeValue,
  type FieldIssue,
} from "@pinwren/core";
import { Bug, CircleCheck, Eye, Lock } from "lucide-react";
import { useState } from "react";
import { KIND_META } from "@/components/feedback-meta";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ISSUE_KEY } from "@/lib/custom-fields";
import { useI18n } from "@/lib/i18n/provider";
import { LOCALE_NAMES } from "@/lib/i18n/translate";
import { FieldControl } from "./field-control";

const KINDS: FeedbackKind[] = ["bug", "idea", "question", "comment"];

/** The answer's first problem, by the same rules the server applies (`normalizeValue` + required). */
export function issueOf(f: CustomFieldBase, v: unknown): FieldIssue | null {
  const r = normalizeValue(f, v);
  if (!r.ok) return r.issue;
  if (f.required && (r.value === undefined || (f.type === "checkbox" && r.value !== true)))
    return { code: "required" };
  return null;
}

/**
 * A live preview of the report form as the widget shows it: the fields that apply to the chosen type, in order,
 * in the chosen language, with the same checks. It is interactive (so required fields, limits and options can be
 * tried) but nothing is sent.
 */
export function FormPreview({ fields }: { fields: CustomFieldBase[] }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [lang, setLang] = useState("en");
  const [answers, setAnswers] = useState<Record<string, CustomFieldValue | null>>({});
  const [checked, setChecked] = useState(false);

  const visible = fields.filter((f) => f.kinds.includes(kind));
  const asked = visible.filter((f) => f.audience === "reporter");
  const internal = visible.filter((f) => f.audience === "internal");
  const languages = [
    "en",
    ...[...new Set(fields.flatMap((f) => Object.keys(f.strings)))].filter(
      (l) => l in LOCALE_NAMES && l !== "en",
    ),
  ];
  const langItems = languages.map((l) => ({ value: l, label: LOCALE_NAMES[l as keyof typeof LOCALE_NAMES] }));

  const text = (f: CustomFieldBase) => {
    const s = lang === "en" ? undefined : f.strings[lang as keyof typeof f.strings];
    return {
      label: s?.label || f.label,
      help: s?.helpText || f.helpText,
      placeholder: s?.placeholder || f.placeholder,
      optionLabel: (o: { value: string; label: string }) => s?.options?.[o.value] || o.label,
    };
  };
  const issues = new Map(asked.map((f) => [f.key, issueOf(f, answers[f.key])] as const));
  const failing = asked.filter((f) => issues.get(f.key));

  return (
    <section aria-label={t("cfields.previewTitle")} className="grid gap-3 rounded-xl border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Eye className="size-4" /> {t("cfields.previewTitle")}
        </h3>
        {languages.length > 1 && (
          <Select items={langItems} value={lang} onValueChange={(v) => v && setLang(v)}>
            <SelectTrigger size="sm" aria-label={t("cfields.previewLanguage")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {langItems.map((l) => (
                <SelectItem key={l.value} value={l.value}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <Segmented
        label={t("cfields.previewKind")}
        value={kind}
        onChange={(k) => {
          setKind(k);
          setChecked(false);
        }}
        options={KINDS.map((k) => ({ value: k, label: t(KIND_META[k].labelKey) }))}
        className="w-full"
      />

      <div className="grid gap-3 rounded-lg border bg-background p-3" data-testid="form-preview">
        <p className="flex items-center gap-2 text-sm font-medium">
          <span className="grid size-6 place-items-center rounded-md bg-red-500/10 text-red-600 dark:text-red-400">
            <Bug className="size-3.5" />
          </span>
          {t("cfields.previewReport")}
        </p>
        <Textarea
          disabled
          rows={2}
          placeholder={t("cfields.previewBody")}
          aria-label={t("cfields.previewBody")}
        />
        {asked.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
            {fields.length === 0 ? t("cfields.previewEmpty") : t("cfields.previewNoneForKind")}
          </p>
        ) : (
          <div className="grid gap-3">
            {asked.map((f, i) => {
              const x = text(f);
              const issue = checked ? issues.get(f.key) : null;
              const id = `pv-${i}`;
              return (
                <div key={f.key} className="grid gap-1.5">
                  {f.type !== "checkbox" && (
                    <label
                      htmlFor={f.type === "multiselect" ? undefined : id}
                      className="text-sm font-medium"
                    >
                      {x.label}
                      {f.required && (
                        <span aria-hidden="true" className="ml-0.5 text-destructive">
                          *
                        </span>
                      )}
                    </label>
                  )}
                  <FieldControl
                    key={`${f.key}-${f.type}`}
                    id={id}
                    field={{ ...f, label: x.label, placeholder: x.placeholder }}
                    value={answers[f.key] ?? f.defaultValue}
                    optionLabel={x.optionLabel}
                    checkboxLabel={x.label}
                    invalid={!!issue}
                    describedBy={issue ? `${id}-e` : x.help ? `${id}-h` : undefined}
                    onChange={(v) => setAnswers((cur) => ({ ...cur, [f.key]: v }))}
                  />
                  {x.help && (
                    <p id={`${id}-h`} className="text-xs text-muted-foreground">
                      {x.help}
                    </p>
                  )}
                  {issue && (
                    <p id={`${id}-e`} role="alert" className="text-xs text-destructive">
                      {t(ISSUE_KEY[issue.code], { n: issue.limit ?? "" })}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {kind !== "bug" && asked.length > 0 && (
          <p className="text-xs text-muted-foreground">{t("cfields.previewWidgetNote")}</p>
        )}
        {asked.length > 0 && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="preview-check"
              onClick={() => setChecked(true)}
            >
              {t("cfields.previewCheck")}
            </Button>
            {checked && failing.length === 0 && (
              <span
                className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400"
                role="status"
              >
                <CircleCheck className="size-3.5" /> {t("cfields.previewPass")}
              </span>
            )}
          </div>
        )}
      </div>

      {internal.length > 0 && (
        <div className="grid gap-1.5 rounded-lg border border-dashed p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Lock className="size-3.5" /> {t("cfields.previewInternal")}
          </p>
          <ul className="grid gap-0.5 text-sm">
            {internal.map((f) => (
              <li key={f.key} className="truncate">
                {f.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
