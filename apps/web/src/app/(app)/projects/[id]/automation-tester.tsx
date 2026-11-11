"use client";

import { type AutomationCondition, FEEDBACK_KINDS, PRIORITIES } from "@pinwren/core";
import { Check, Loader2, Play, X } from "lucide-react";
import { useState } from "react";
import { KIND_META, PRIORITY_META } from "@/components/feedback-meta";
import { Field } from "@/components/form";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ProjectDetail } from "@/lib/api";
import { useT } from "@/lib/i18n/provider";
import {
  type AutomationRule,
  type AutomationTestResult,
  errorMessage,
  useTestAutomationRuleMutation,
} from "@/lib/store/api";
import {
  ACTION_LABEL,
  BROWSERS,
  CONDITION_LABEL,
  CUSTOM_FIELD_OP_LABEL,
  EVENT_LABEL,
  useRuleOptions,
} from "./automation-builder";

type Sample = {
  kind: (typeof FEEDBACK_KINDS)[number];
  priority: (typeof PRIORITIES)[number];
  pageUrl: string;
  browser: string;
  reporterEmail: string;
  hasAttachment: boolean;
  hasReplay: boolean;
};

const SAMPLE: Sample = {
  kind: "bug",
  priority: "none",
  pageUrl: "https://example.com/pricing",
  browser: "Chrome",
  reporterEmail: "",
  hasAttachment: false,
  hasReplay: false,
};

/** Dry-run a saved rule against a sample report: which conditions hold, and whether it would fire. */
export function RuleTester({
  project,
  rule,
  open,
  onOpenChange,
}: {
  project: ProjectDetail;
  rule: AutomationRule;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const options = useRuleOptions(project.id);
  const [sample, setSample] = useState<Sample>(SAMPLE);
  const [result, setResult] = useState<AutomationTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [test, { isLoading: testing }] = useTestAutomationRuleMutation();
  const set = (p: Partial<Sample>) => setSample((s) => ({ ...s, ...p }));

  const run = async () => {
    setError(null);
    try {
      setResult(
        await test({
          id: rule.id,
          request: {
            sample: {
              kind: sample.kind,
              priority: sample.priority,
              pageUrl: sample.pageUrl.trim() || null,
              browser: sample.browser || null,
              reporterEmail: sample.reporterEmail.trim() || null,
              labelIds: [],
              hasAttachment: sample.hasAttachment,
              hasReplay: sample.hasReplay,
              customFields: {},
              toStatus: rule.trigger.toStatuses[0] ?? null,
              addedLabelId: rule.trigger.labelId,
            },
          },
        }).unwrap(),
      );
    } catch (e) {
      setResult(null);
      setError(errorMessage(e));
    }
  };

  const describe = (c: AutomationCondition) => {
    switch (c.field) {
      case "kind":
        return c.values.map((k) => t(KIND_META[k].labelKey)).join(", ");
      case "priority":
        return c.values.map((p) => t(PRIORITY_META[p].labelKey)).join(", ");
      case "pageUrl":
        return c.pattern;
      case "browser":
      case "reporterEmailDomain":
        return c.values.join(", ");
      case "label":
        return c.labelIds.map((id) => options.labels.find((l) => l.id === id)?.name ?? "?").join(", ");
      case "hasAttachment":
      case "hasReplay":
        return c.value ? t("automation.yes") : t("automation.no");
      case "customField":
        return `${options.fields.find((f) => f.key === c.key)?.label ?? c.key} ${t(CUSTOM_FIELD_OP_LABEL[c.op])}${c.value ? ` ${c.value}` : ""}`;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" data-testid="rule-tester">
        <DialogHeader>
          <DialogTitle>{t("automation.testTitle", { name: rule.name })}</DialogTitle>
          <DialogDescription>{t("automation.testDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="sample-kind" label={t("automation.fieldKind")}>
            <Select
              items={FEEDBACK_KINDS.map((k) => ({ value: k, label: t(KIND_META[k].labelKey) }))}
              value={sample.kind}
              onValueChange={(v) => v && set({ kind: v })}
            >
              <SelectTrigger id="sample-kind" size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FEEDBACK_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(KIND_META[k].labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="sample-priority" label={t("automation.fieldPriority")}>
            <Select
              items={PRIORITIES.map((p) => ({ value: p, label: t(PRIORITY_META[p].labelKey) }))}
              value={sample.priority}
              onValueChange={(v) => v && set({ priority: v })}
            >
              <SelectTrigger id="sample-priority" size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {t(PRIORITY_META[p].labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="sample-page" label={t("automation.samplePage")} className="sm:col-span-2">
            <Input
              id="sample-page"
              value={sample.pageUrl}
              onChange={(e) => set({ pageUrl: e.target.value })}
            />
          </Field>
          <Field id="sample-browser" label={t("automation.fieldBrowser")}>
            <Select
              items={BROWSERS.map((b) => ({ value: b, label: b }))}
              value={sample.browser}
              onValueChange={(v) => v && set({ browser: v })}
            >
              <SelectTrigger id="sample-browser" size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BROWSERS.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="sample-email" label={t("automation.sampleEmail")}>
            <Input
              id="sample-email"
              value={sample.reporterEmail}
              placeholder="person@acme.com"
              onChange={(e) => set({ reporterEmail: e.target.value })}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={sample.hasAttachment}
              onCheckedChange={(hasAttachment) => set({ hasAttachment })}
            />
            {t("automation.fieldAttachment")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={sample.hasReplay} onCheckedChange={(hasReplay) => set({ hasReplay })} />
            {t("automation.fieldReplay")}
          </label>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {result && (
          <div
            className="grid gap-1.5 rounded-lg border p-3 text-sm"
            data-testid="test-result"
            aria-live="polite"
          >
            <Row
              ok={result.triggered}
              text={`${t("automation.when")}: ${t(EVENT_LABEL[rule.trigger.event])}`}
            />
            {rule.conditions.map((c, i) => (
              <Row
                key={`${c.field}-${i}`}
                ok={result.conditions[i] ?? false}
                text={`${t(CONDITION_LABEL[c.field])}: ${describe(c)}`}
              />
            ))}
            <p className="mt-1 font-medium" data-testid="test-verdict">
              {result.matched
                ? t("automation.wouldRun", {
                    actions: rule.actions.map((a) => t(ACTION_LABEL[a.type])).join(", "),
                  })
                : t("automation.wouldNotRun")}
            </p>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("automation.close")}
          </Button>
          <Button type="button" disabled={testing} onClick={() => void run()} data-testid="run-test">
            {testing ? <Loader2 className="animate-spin" /> : <Play />} {t("automation.runTest")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ ok, text }: { ok: boolean; text: string }) {
  const t = useT();
  return (
    <p className="flex items-start gap-2">
      {ok ? (
        <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label={t("automation.passed")} />
      ) : (
        <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-label={t("automation.failedCheck")} />
      )}
      <span>{text}</span>
    </p>
  );
}
