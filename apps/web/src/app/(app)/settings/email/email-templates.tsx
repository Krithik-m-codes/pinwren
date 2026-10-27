"use client";

import type { EmailTemplateKey } from "@pinwren/core";
import { CircleCheck, CircleX, RotateCcw, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { useWatch } from "react-hook-form";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { controlProps, FieldError, useZodForm } from "@/components/form";
import { ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { EmailTemplate, EmailTestResult } from "@/lib/api";
import { emailTemplateForm } from "@/lib/form-schemas";
import { useI18n } from "@/lib/i18n/provider";
import {
  errorMessage,
  isApiError,
  useEmailTemplatesQuery,
  usePreviewEmailTemplateQuery,
  useResetEmailTemplateMutation,
  useSaveEmailTemplateMutation,
  useTestEmailTemplateMutation,
} from "@/lib/store/api";

type Draft = { subject: string; body: string };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Email templates (F-020): subject + Markdown body per notification, with `{{variables}}`. The preview is
 * rendered by the server exactly as it will be sent (variables escaped, Markdown sanitised), inside a
 * sandboxed frame.
 */
export function EmailTemplates() {
  const list = useEmailTemplatesQuery(undefined);
  const [key, setKey] = useState<EmailTemplateKey>("feedback_created");
  const current = list.data?.templates.find((t) => t.key === key);

  if (list.isLoading) return <Skeleton className="h-[32rem] rounded-xl" />;
  if (!list.data) return <ErrorState error={list.error} retry={() => void list.refetch()} />;
  if (!current) return null;
  return (
    <TemplateEditor
      // A new template (or a save / reset) starts a fresh form and clears the last test result.
      key={`${current.key}:${current.subject}:${current.body}`}
      templates={list.data.templates}
      current={current}
      onKey={setKey}
    />
  );
}

function TemplateEditor({
  templates,
  current,
  onKey,
}: {
  templates: EmailTemplate[];
  current: EmailTemplate;
  onKey: (k: EmailTemplateKey) => void;
}) {
  const { t, tm } = useI18n();
  const key = current.key;
  const form = useZodForm(emailTemplateForm, {
    defaultValues: { subject: current.subject, body: current.body },
  });
  const { errors, isDirty } = form.formState;
  const subject = useWatch({ control: form.control, name: "subject" });
  const body = useWatch({ control: form.control, name: "body" });
  const draft: Draft = { subject, body };
  // Debounced as one string, so an unchanged draft is the same value (no new request, no re-render loop).
  const settled = JSON.parse(useDebounced(JSON.stringify(draft), 350)) as Draft;
  const preview = usePreviewEmailTemplateQuery({ key, draft: settled });
  const [saveTemplate, saving] = useSaveEmailTemplateMutation();
  const [resetTemplate, resetting] = useResetEmailTemplateMutation();
  const [testTemplate, testing] = useTestEmailTemplateMutation();
  const [testResult, setTestResult] = useState<EmailTestResult | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const bodyField = form.register("body");

  const items = templates.map((t) => ({ value: t.key, label: t.name }));
  const previewError = preview.error
    ? isApiError(preview.error)
      ? tm(preview.error.message)
      : t("settings2.previewFailed")
    : null;
  const invalid = !subject.trim() || !body.trim() || !!previewError;

  const save = form.handleSubmit(async (d) => {
    try {
      const { template } = await saveTemplate({ key, draft: d }).unwrap();
      toast.success(t("settings2.templateSaved", { name: template.name }));
    } catch (e) {
      toast.error(t("settings2.notSaved"), { description: errorMessage(e) });
    }
  });

  function insert(name: string) {
    const el = document.getElementById("template-body") as HTMLTextAreaElement | null;
    const token = `{{${name}}}`;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    form.setValue("body", body.slice(0, start) + token + body.slice(end), {
      shouldDirty: true,
      shouldValidate: true,
    });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings2.emailTemplates")}</CardTitle>
        <CardDescription>{t("settings2.templateDesc", { braces: "{{double braces}}" })}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" noValidate onSubmit={(e) => void save(e)}>
          <div className="flex flex-wrap items-center gap-2">
            <Select items={items} value={key} onValueChange={(v) => v && onKey(v)}>
              <SelectTrigger className="w-64" aria-label={t("settings2.template")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {templates.map((tpl) => (
                  <SelectItem key={tpl.key} value={tpl.key}>
                    {tpl.name}
                    {tpl.customized && (
                      <span className="ml-auto text-xs text-muted-foreground">{t("settings2.edited")}</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {current.customized ? (
              <Badge variant="secondary" className="font-normal">
                {t("settings2.customised")}
              </Badge>
            ) : (
              <Badge variant="outline" className="font-normal text-muted-foreground">
                {t("settings2.default")}
              </Badge>
            )}
            <p className="w-full text-sm text-muted-foreground">{current.description}</p>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="template-subject" className="text-sm font-medium">
              {t("settings2.subject")}
            </label>
            <Input
              {...controlProps("template-subject", errors.subject?.message)}
              {...form.register("subject")}
              maxLength={200}
            />
            <FieldError id="template-subject" message={errors.subject?.message} />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="template-body" className="text-sm font-medium">
              {t("settings2.body")}
            </label>
            <Textarea
              {...controlProps("template-body", errors.body?.message ?? previewError ?? undefined)}
              {...bodyField}
              rows={8}
              maxLength={10_000}
              className="font-mono text-[13px] leading-relaxed"
            />
            <FieldError id="template-body" message={errors.body?.message} />
            {previewError && (
              <p className="text-xs text-destructive" role="alert">
                {previewError}
              </p>
            )}
          </div>

          <div className="grid gap-1.5">
            <p className="text-sm font-medium">{t("settings2.variables")}</p>
            <ul className="flex flex-wrap gap-1.5" aria-label={t("settings2.variables")}>
              {current.variables.map((v) => (
                <li key={v.name}>
                  <button
                    type="button"
                    title={t("settings2.variableTitle", { description: v.description, sample: v.sample })}
                    onClick={() => insert(v.name)}
                    className="rounded-md border bg-muted/50 px-1.5 py-0.5 font-mono text-xs transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {`{{${v.name}}}`}
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">{t("settings2.clickToInsert")}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            <Button type="submit" disabled={!isDirty || invalid || saving.isLoading}>
              {saving.isLoading ? t("settings2.saving") : t("settings2.saveTemplate")}
            </Button>
            {isDirty && (
              <Button type="button" variant="ghost" onClick={() => form.reset()}>
                {t("settings2.discardChanges")}
              </Button>
            )}
            <div className="ml-auto flex flex-wrap gap-2">
              {current.customized && (
                <Button type="button" variant="outline" onClick={() => setConfirmReset(true)}>
                  <RotateCcw /> {t("settings2.resetToDefault")}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={invalid || testing.isLoading}
                onClick={() => {
                  testTemplate({ key, draft })
                    .unwrap()
                    .then(setTestResult)
                    .catch((e: unknown) =>
                      setTestResult({ sent: false, skipped: false, reason: errorMessage(e) }),
                    );
                }}
              >
                <Send /> {testing.isLoading ? t("settings2.sending") : t("settings2.sendMeThisEmail")}
              </Button>
            </div>
          </div>
        </form>
        {testResult && (
          <p
            role="status"
            className={
              testResult.sent
                ? "mt-4 flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-400"
                : "mt-4 flex items-start gap-2 text-sm text-destructive"
            }
          >
            {testResult.sent ? (
              <CircleCheck className="mt-0.5 size-4 shrink-0" />
            ) : (
              <CircleX className="mt-0.5 size-4 shrink-0" />
            )}
            {testResult.sent
              ? t("settings2.testSentTo", { to: testResult.to })
              : testResult.skipped
                ? t("settings2.notSentReason", { reason: testResult.reason })
                : t("settings2.smtpRefused", { reason: testResult.reason })}
          </p>
        )}

        <section aria-label={t("settings2.preview")} className="mt-4 grid gap-2">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{t("settings2.preview")}</p>
            <span className="text-xs text-muted-foreground">{t("settings2.withSampleValues")}</span>
            {preview.isFetching && (
              <span className="ml-auto text-xs text-muted-foreground">{t("settings2.updating")}</span>
            )}
          </div>
          <div className="overflow-hidden rounded-lg border">
            <p className="truncate border-b bg-muted/40 px-3 py-2 text-sm" data-testid="preview-subject">
              <span className="text-muted-foreground">{t("settings2.subjectLabel")} </span>
              {preview.currentData?.preview.subject ?? preview.data?.preview.subject ?? "…"}
            </p>
            {preview.data ? (
              <iframe
                title={t("settings2.emailPreview")}
                sandbox=""
                srcDoc={preview.data.preview.html}
                className="block h-[26rem] w-full bg-[#f6f6f9]"
                data-testid="preview-frame"
              />
            ) : (
              <Skeleton className="h-[26rem] rounded-none" />
            )}
          </div>
        </section>
      </CardContent>
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={t("settings2.resetNamedQ", { name: current.name })}
        description={t("settings2.resetDesc")}
        confirmLabel={t("settings2.reset")}
        pending={resetting.isLoading}
        onConfirm={() => {
          resetTemplate(key)
            .unwrap()
            .then(() => {
              setConfirmReset(false);
              toast.success(t("settings2.backToDefault"));
            })
            .catch((e: unknown) => toast.error(errorMessage(e)));
        }}
      />
    </Card>
  );
}
