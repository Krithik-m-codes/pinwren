"use client";

import { type CustomFieldBase, type CustomFieldDef, formatValue, safeHref } from "@pinwren/core";
import { FormInput, Lock, Pencil, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { FieldControl } from "@/components/custom-fields/field-control";
import { issueOf } from "@/components/custom-fields/form-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { FeedbackDetail } from "@/lib/api";
import { answerFor, ISSUE_KEY, isEmptyAnswer } from "@/lib/custom-fields";
import { useI18n } from "@/lib/i18n/provider";
import { errorMessage, useCustomFieldsQuery, useUpdateFeedbackMutation } from "@/lib/store/api";

type Def = CustomFieldDef;

/** One stored answer as people read it: option labels, Yes/No, joined lists. */
export function answerText(def: Def, value: unknown, yes: string, no: string): string {
  return formatValue(def, value, yes, no);
}

/**
 * The item's answers to the project's custom fields (ADR 0032): the reporter's (asked in the widget) and the
 * team's own (internal), for fields that belong to the item's type. Team members edit them here; viewers read.
 * Values are always rendered as text; a link only when it is an http(s) address.
 */
export function CustomFieldsCard({
  feedback: f,
  canWrite,
}: {
  feedback: FeedbackDetail["feedback"];
  canWrite: boolean;
}) {
  const { t } = useI18n();
  const query = useCustomFieldsQuery(f.projectId);
  const [editing, setEditing] = useState(false);
  if (query.isLoading) return <Skeleton className="h-16 w-full" />;
  const fields = (query.data?.fields ?? []).filter((d) => d.kinds.includes(f.kind));
  if (!fields.length) return null;

  return (
    <section aria-label={t("cfields.detailTitle")} className="space-y-2" data-testid="custom-fields-card">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <FormInput className="size-4" /> {t("cfields.detailTitle")}
        </h3>
        {canWrite && !editing && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setEditing(true)}
            data-testid="edit-custom-fields"
          >
            <Pencil /> {t("cfields.edit")}
          </Button>
        )}
      </div>
      {editing ? (
        <AnswerEditor feedback={f} fields={fields} onDone={() => setEditing(false)} />
      ) : (
        <dl className="grid gap-x-4 gap-y-2 rounded-lg border p-3 sm:grid-cols-2">
          {fields.map((d) => {
            const v = answerFor(d.type, f.customFields[d.key]);
            return (
              <div key={d.key} className="min-w-0" data-testid={`answer-${d.key}`}>
                <dt className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {d.label}
                  {d.audience === "internal" && (
                    <Badge variant="outline" className="h-4 gap-1 px-1 text-[10px]">
                      <Lock className="size-2.5" /> {t("cfields.badgeInternal")}
                    </Badge>
                  )}
                  {d.pii && <ShieldAlert className="size-3" aria-label={t("cfields.badgePii")} />}
                </dt>
                <dd className="text-sm break-words whitespace-pre-wrap">
                  {isEmptyAnswer(v) ? (
                    <span className="text-muted-foreground">{t("cfields.notAnswered")}</span>
                  ) : (
                    <AnswerValue def={d} value={v} />
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </section>
  );
}

function AnswerValue({ def, value }: { def: Def; value: unknown }) {
  const { t } = useI18n();
  const text = answerText(def, value, t("cfields.yes"), t("cfields.no"));
  const href = def.type === "url" ? safeHref(text) : null;
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2"
    >
      {text}
    </a>
  ) : (
    <>{text}</>
  );
}

function AnswerEditor({
  feedback: f,
  fields,
  onDone,
}: {
  feedback: FeedbackDetail["feedback"];
  fields: Def[];
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [update, state] = useUpdateFeedbackMutation();
  const [draft, setDraft] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(fields.map((d) => [d.key, answerFor(d.type, f.customFields[d.key])])),
  );
  const [showErrors, setShowErrors] = useState(false);
  const base = (d: Def): CustomFieldBase => d;
  const issues = new Map(fields.map((d) => [d.key, issueOf(base(d), draft[d.key])] as const));
  const changed = fields.filter(
    (d) => JSON.stringify(draft[d.key] ?? null) !== JSON.stringify(answerFor(d.type, f.customFields[d.key])),
  );

  const save = () => {
    // Only fields that changed are sent, so a required field added after the item was filed doesn't block this edit.
    const bad = changed.filter((d) => issues.get(d.key));
    if (bad.length) {
      setShowErrors(true);
      return;
    }
    if (!changed.length) {
      onDone();
      return;
    }
    update({
      ids: [f.id],
      patch: {
        customFields: Object.fromEntries(
          changed.map((d) => [d.key, isEmptyAnswer(draft[d.key]) ? null : draft[d.key]]),
        ),
      },
    })
      .unwrap()
      .then(() => {
        toast.success(t("cfields.answersSaved"));
        onDone();
      })
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };

  return (
    <form
      className="grid gap-3 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {fields.map((d, i) => {
        const issue = showErrors && changed.includes(d) ? issues.get(d.key) : null;
        const id = `ans-${i}`;
        return (
          <div key={d.key} className="grid gap-1.5">
            {d.type !== "checkbox" && (
              <label
                htmlFor={d.type === "multiselect" ? undefined : id}
                className="flex items-center gap-1.5 text-sm font-medium"
              >
                {d.label}
                {d.required && (
                  <span aria-hidden="true" className="text-destructive">
                    *
                  </span>
                )}
                {d.audience === "internal" && (
                  <Badge variant="outline" className="h-4 gap-1 px-1 text-[10px]">
                    <Lock className="size-2.5" /> {t("cfields.badgeInternal")}
                  </Badge>
                )}
              </label>
            )}
            <FieldControl
              id={id}
              field={d}
              value={draft[d.key]}
              checkboxLabel={d.label}
              invalid={!!issue}
              describedBy={issue ? `${id}-e` : d.helpText ? `${id}-h` : undefined}
              onChange={(v) => setDraft((cur) => ({ ...cur, [d.key]: v }))}
            />
            {d.helpText && (
              <p id={`${id}-h`} className="text-xs text-muted-foreground">
                {d.helpText}
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
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={state.isLoading} data-testid="save-custom-fields">
          {state.isLoading ? t("cfields.saving") : t("cfields.save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {t("cfields.cancel")}
        </Button>
      </div>
    </form>
  );
}
