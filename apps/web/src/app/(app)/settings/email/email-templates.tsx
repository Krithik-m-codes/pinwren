"use client";

import type { EmailTemplateKey } from "@pinwren/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleX, RotateCcw, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  ApiRequestError,
  api,
  type EmailTemplate,
  type EmailTestResult,
  qk,
  type RenderedEmail,
} from "@/lib/api";

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
 * Email templates (F-020): subject + Markdown body per notification, with `{{variables}}`. The
 * preview is rendered by the server exactly as it will be sent (variables escaped, Markdown
 * sanitised), inside a sandboxed frame.
 */
export function EmailTemplates() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: qk.emailTemplates,
    queryFn: () => api<{ templates: EmailTemplate[] }>("/email-templates"),
  });
  const [key, setKey] = useState<EmailTemplateKey>("feedback_created");
  const current = list.data?.templates.find((t) => t.key === key);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [testResult, setTestResult] = useState<EmailTestResult | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const body = useRef<HTMLTextAreaElement>(null);

  // A new template (or a save/reset) replaces the draft.
  const savedKey = current ? `${current.key}:${current.subject}:${current.body}` : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-sync only when the saved template changes
  useEffect(() => {
    if (current) setDraft({ subject: current.subject, body: current.body });
    setTestResult(null);
  }, [savedKey]);

  const debounced = useDebounced(draft, 350);
  const preview = useQuery({
    queryKey: ["email-template-preview", key, debounced],
    queryFn: () =>
      api<{ preview: RenderedEmail }>(`/email-templates/${key}/preview`, {
        method: "POST",
        json: debounced ?? {},
      }),
    enabled: !!debounced,
    placeholderData: (prev) => prev,
    retry: false,
  });

  const replace = (t: EmailTemplate) =>
    qc.setQueryData<{ templates: EmailTemplate[] }>(qk.emailTemplates, (old) =>
      old ? { templates: old.templates.map((x) => (x.key === t.key ? t : x)) } : old,
    );
  const save = useMutation({
    mutationFn: (d: Draft) =>
      api<{ template: EmailTemplate }>(`/email-templates/${key}`, { method: "PUT", json: d }),
    onSuccess: ({ template }) => {
      replace(template);
      toast.success(`“${template.name}” saved`);
    },
    onError: (e) => toast.error("Not saved", { description: e.message }),
  });
  const reset = useMutation({
    mutationFn: () => api<{ template: EmailTemplate }>(`/email-templates/${key}`, { method: "DELETE" }),
    onSuccess: ({ template }) => {
      replace(template);
      setConfirmReset(false);
      toast.success("Back to the default wording");
    },
    onError: (e) => toast.error(e.message),
  });
  const test = useMutation({
    mutationFn: (d: Draft) =>
      api<EmailTestResult>(`/email-templates/${key}/test`, { method: "POST", json: d }),
    onSuccess: setTestResult,
    onError: (e) => setTestResult({ sent: false, skipped: false, reason: e.message }),
  });

  const items = useMemo(
    () => (list.data?.templates ?? []).map((t) => ({ value: t.key, label: t.name })),
    [list.data],
  );

  if (list.isPending) return <Skeleton className="h-[32rem] rounded-xl" />;
  if (list.isError) return <ErrorState error={list.error} retry={() => list.refetch()} />;
  if (!current || !draft) return null;

  const dirty = draft.subject !== current.subject || draft.body !== current.body;
  const previewError =
    preview.error instanceof ApiRequestError
      ? preview.error.message
      : preview.error
        ? "Preview failed"
        : null;
  const invalid = !draft.subject.trim() || !draft.body.trim() || !!previewError;

  function insert(name: string) {
    const el = body.current;
    const token = `{{${name}}}`;
    if (!el || !draft) return;
    const start = el.selectionStart ?? draft.body.length;
    const end = el.selectionEnd ?? start;
    const next = draft.body.slice(0, start) + token + draft.body.slice(end);
    setDraft({ ...draft, body: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email templates</CardTitle>
        <CardDescription>
          Change the wording of each notification. Markdown works (**bold**, *italic*, [links](https://…),
          &gt; quotes, - lists); HTML is shown as text. Values in {"{{double braces}}"} are filled in — and
          escaped — when the email is sent.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select items={items} value={key} onValueChange={(v) => v && setKey(v as EmailTemplateKey)}>
            <SelectTrigger className="w-64" aria-label="Template">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {list.data.templates.map((t) => (
                <SelectItem key={t.key} value={t.key}>
                  {t.name}
                  {t.customized && <span className="ml-auto text-xs text-muted-foreground">edited</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {current.customized ? (
            <Badge variant="secondary" className="font-normal">
              Customised
            </Badge>
          ) : (
            <Badge variant="outline" className="font-normal text-muted-foreground">
              Default
            </Badge>
          )}
          <p className="w-full text-sm text-muted-foreground">{current.description}</p>
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="template-subject" className="text-sm font-medium">
            Subject
          </label>
          <Input
            id="template-subject"
            value={draft.subject}
            maxLength={200}
            onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="template-body" className="text-sm font-medium">
            Body
          </label>
          <Textarea
            id="template-body"
            ref={body}
            rows={8}
            maxLength={10_000}
            className="font-mono text-[13px] leading-relaxed"
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          />
          {previewError && (
            <p className="text-xs text-destructive" role="alert">
              {previewError}
            </p>
          )}
        </div>

        <div className="grid gap-1.5">
          <p className="text-sm font-medium">Variables</p>
          <ul className="flex flex-wrap gap-1.5" aria-label="Variables">
            {current.variables.map((v) => (
              <li key={v.name}>
                <button
                  type="button"
                  title={`${v.description} — e.g. ${v.sample}`}
                  onClick={() => insert(v.name)}
                  className="rounded-md border bg-muted/50 px-1.5 py-0.5 font-mono text-xs transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {`{{${v.name}}}`}
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Click one to insert it at the cursor. Hover for what it holds.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button disabled={!dirty || invalid || save.isPending} onClick={() => save.mutate(draft)}>
            {save.isPending ? "Saving…" : "Save template"}
          </Button>
          {dirty && (
            <Button
              variant="ghost"
              onClick={() => setDraft({ subject: current.subject, body: current.body })}
            >
              Discard changes
            </Button>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            {current.customized && (
              <Button variant="outline" onClick={() => setConfirmReset(true)}>
                <RotateCcw /> Reset to default
              </Button>
            )}
            <Button variant="outline" disabled={invalid || test.isPending} onClick={() => test.mutate(draft)}>
              <Send /> {test.isPending ? "Sending…" : "Send me this email"}
            </Button>
          </div>
        </div>
        {testResult && (
          <p
            role="status"
            className={
              testResult.sent
                ? "flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-400"
                : "flex items-start gap-2 text-sm text-destructive"
            }
          >
            {testResult.sent ? (
              <CircleCheck className="mt-0.5 size-4 shrink-0" />
            ) : (
              <CircleX className="mt-0.5 size-4 shrink-0" />
            )}
            {testResult.sent
              ? `Test sent to ${testResult.to} with sample values.`
              : testResult.skipped
                ? `Not sent: ${testResult.reason}`
                : `The SMTP server refused it: ${testResult.reason}`}
          </p>
        )}

        <section aria-label="Preview" className="grid gap-2">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">Preview</p>
            <span className="text-xs text-muted-foreground">with sample values</span>
            {preview.isFetching && <span className="ml-auto text-xs text-muted-foreground">Updating…</span>}
          </div>
          <div className="overflow-hidden rounded-lg border">
            <p className="truncate border-b bg-muted/40 px-3 py-2 text-sm" data-testid="preview-subject">
              <span className="text-muted-foreground">Subject: </span>
              {preview.data?.preview.subject ?? "…"}
            </p>
            {preview.data ? (
              <iframe
                title="Email preview"
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
        title={`Reset “${current.name}”?`}
        description="Your wording is replaced by the built-in template. This can't be undone."
        confirmLabel="Reset"
        pending={reset.isPending}
        onConfirm={() => reset.mutate()}
      />
    </Card>
  );
}
