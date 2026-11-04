"use client";

import { MAX_RULES_PER_PROJECT } from "@pinwren/core";
import { FlaskConical, Pencil, Plus, ScrollText, Trash2, Workflow } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RelativeTime } from "@/components/feedback-meta";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ProjectDetail } from "@/lib/api";
import type { Key } from "@/lib/i18n/en";
import { useI18n, useT } from "@/lib/i18n/provider";
import {
  type AutomationRule,
  type AutomationRun,
  errorMessage,
  useAutomationRulesQuery,
  useAutomationRunsQuery,
  useDeleteAutomationRuleMutation,
  useUpdateAutomationRuleMutation,
} from "@/lib/store/api";
import { useViewer } from "@/lib/viewer";
import { ACTION_LABEL, EVENT_LABEL, RuleBuilder } from "./automation-builder";
import { RuleTester } from "./automation-tester";

/**
 * Project › Automation (WP-28): "when [event] and [conditions] then [actions]" rules, the dry-run tester and
 * the run log. Admins write (`projects.manage`); everyone else reads.
 */
export function AutomationTab({ project }: { project: ProjectDetail }) {
  const t = useT();
  const { isAdmin } = useViewer();
  const rules = useAutomationRulesQuery(project.id);
  const list = rules.data?.rules ?? [];
  const [editing, setEditing] = useState<AutomationRule | "new" | null>(null);
  const [testing, setTesting] = useState<AutomationRule | null>(null);
  const [deleting, setDeleting] = useState<AutomationRule | null>(null);

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Workflow className="size-4" /> {t("automation.title")}
          </CardTitle>
          <CardDescription>{t("automation.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isAdmin && (
            <Button
              type="button"
              disabled={list.length >= MAX_RULES_PER_PROJECT}
              onClick={() => setEditing("new")}
              data-testid="new-rule"
            >
              <Plus /> {t("automation.newRule")}
            </Button>
          )}
          {rules.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : rules.isError ? (
            <ErrorState error={rules.error} retry={() => void rules.refetch()} />
          ) : list.length === 0 ? (
            <EmptyState
              icon={Workflow}
              title={t("automation.emptyTitle")}
              description={isAdmin ? t("automation.emptyAdmin") : t("automation.emptyViewer")}
              className="py-8"
            />
          ) : (
            <ul className="divide-y rounded-lg border" aria-label={t("automation.title")} data-testid="rules">
              {list.map((r) => (
                <RuleRow
                  key={r.id}
                  rule={r}
                  canWrite={isAdmin}
                  onEdit={() => setEditing(r)}
                  onTest={() => setTesting(r)}
                  onDelete={() => setDeleting(r)}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <RunLog project={project} rules={list} />

      {editing && (
        <RuleBuilder
          key={editing === "new" ? "new" : editing.id}
          project={project}
          rule={editing === "new" ? null : editing}
          open
          onOpenChange={(open) => !open && setEditing(null)}
        />
      )}
      {testing && (
        <RuleTester
          project={project}
          rule={testing}
          open
          onOpenChange={(open) => !open && setTesting(null)}
        />
      )}
      <DeleteRule rule={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

function RuleRow({
  rule: r,
  canWrite,
  onEdit,
  onTest,
  onDelete,
}: {
  rule: AutomationRule;
  canWrite: boolean;
  onEdit: () => void;
  onTest: () => void;
  onDelete: () => void;
}) {
  const { t, tn } = useI18n();
  const [update, { isLoading: updating }] = useUpdateAutomationRuleMutation();
  const toggle = (enabled: boolean) =>
    update({ id: r.id, patch: { enabled } })
      .unwrap()
      .then(() => toast.success(t(enabled ? "automation.ruleOn" : "automation.ruleOff", { name: r.name })))
      .catch((e: unknown) => toast.error(errorMessage(e)));
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5" data-rule={r.name}>
      <Switch
        checked={r.enabled}
        disabled={!canWrite || updating}
        aria-label={t("automation.enableRule", { name: r.name })}
        onCheckedChange={(v) => void toggle(v)}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{r.name}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant="secondary">{t(EVENT_LABEL[r.trigger.event])}</Badge>
          <span>{tn("automation.conditionCount", r.conditions.length)}</span>
          <span aria-hidden>→</span>
          {r.actions.map((a, i) => (
            <Badge key={`${a.type}-${i}`} variant="outline">
              {t(ACTION_LABEL[a.type])}
            </Badge>
          ))}
        </p>
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">
        {r.lastRunAt ? (
          <>
            {tn("automation.runCount", r.runCount)} · <RelativeTime iso={r.lastRunAt} />
          </>
        ) : (
          t("automation.neverRan")
        )}
      </span>
      <div className="flex gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("automation.testRule", { name: r.name })}
          onClick={onTest}
          disabled={!canWrite}
        >
          <FlaskConical />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("automation.editRuleName", { name: r.name })}
          onClick={onEdit}
          disabled={!canWrite}
        >
          <Pencil />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("automation.deleteRuleName", { name: r.name })}
          onClick={onDelete}
          disabled={!canWrite}
        >
          <Trash2 />
        </Button>
      </div>
    </li>
  );
}

function DeleteRule({ rule, onClose }: { rule: AutomationRule | null; onClose: () => void }) {
  const t = useT();
  const [remove, { isLoading: removing }] = useDeleteAutomationRuleMutation();
  return (
    <ConfirmDialog
      open={!!rule}
      onOpenChange={(open) => !open && onClose()}
      title={t("automation.deleteTitle", { name: rule?.name ?? "" })}
      description={t("automation.deleteDescription")}
      confirmLabel={t("automation.deleteConfirm")}
      pending={removing}
      onConfirm={() => {
        if (!rule) return;
        remove(rule.id)
          .unwrap()
          .then(() => {
            toast.success(t("automation.ruleDeleted", { name: rule.name }));
            onClose();
          })
          .catch((e: unknown) => toast.error(errorMessage(e)));
      }}
    />
  );
}

/** A run result names its action by type; an unknown one (a newer server) still renders. */
const actionKey = (type: string): Key =>
  type in ACTION_LABEL ? ACTION_LABEL[type as keyof typeof ACTION_LABEL] : "automation.actionUnknown";

const STATUS_VARIANT = {
  success: "secondary",
  partial: "outline",
  failed: "destructive",
  skipped: "outline",
} as const satisfies Record<AutomationRun["status"], string>;

function RunLog({ project, rules }: { project: ProjectDetail; rules: AutomationRule[] }) {
  const { t } = useI18n();
  const runs = useAutomationRunsQuery({ projectId: project.id });
  const list = runs.data?.runs ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScrollText className="size-4" /> {t("automation.runLog")}
        </CardTitle>
        <CardDescription>{t("automation.runLogDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        {runs.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : runs.isError ? (
          <ErrorState error={runs.error} retry={() => void runs.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title={t("automation.noRuns")}
            description={rules.length ? t("automation.noRunsHint") : t("automation.noRunsNoRules")}
            className="py-8"
          />
        ) : (
          <Table data-testid="run-log">
            <TableHeader>
              <TableRow>
                <TableHead>{t("automation.colWhen")}</TableHead>
                <TableHead>{t("automation.colRule")}</TableHead>
                <TableHead>{t("automation.colItem")}</TableHead>
                <TableHead>{t("automation.colResult")}</TableHead>
                <TableHead>{t("automation.colDetails")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="text-xs text-muted-foreground">
                    <RelativeTime iso={run.createdAt} />
                  </TableCell>
                  <TableCell className="font-medium">{run.ruleName}</TableCell>
                  <TableCell>
                    {run.feedbackId && run.feedbackNumber !== null ? (
                      <Link
                        href={`/inbox?project=${project.id}&status=all&item=${run.feedbackId}`}
                        className="underline-offset-4 hover:underline"
                      >
                        #{run.feedbackNumber}
                      </Link>
                    ) : (
                      "–"
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[run.status]}>{t(`automation.status_${run.status}`)}</Badge>
                  </TableCell>
                  <TableCell className="max-w-80 text-xs text-muted-foreground">
                    {run.status === "skipped" ? (
                      t("automation.skippedLoop")
                    ) : (
                      <ul>
                        {run.results.map((r, i) => (
                          <li key={i} className={r.ok ? undefined : "text-destructive"}>
                            {t(actionKey(r.type))}:{r.detail}
                          </li>
                        ))}
                      </ul>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
