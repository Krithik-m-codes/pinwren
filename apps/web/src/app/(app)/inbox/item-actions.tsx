"use client";

import { safeHref, substituteActionUrl } from "@pinwren/core";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { PanelActionIcon } from "@/components/panel-action-icon";
import { issueRef, TRACKER_NAMES, TrackerIcon } from "@/components/tracker-icon";
import { Button, buttonVariants } from "@/components/ui/button";
import type { FeedbackDetail } from "@/lib/api";
import { useT } from "@/lib/i18n/provider";
import { errorMessage, useCreateIssueMutation, useRunPanelActionMutation } from "@/lib/store/api";
import { cn } from "@/lib/utils";

/**
 * The project's panel actions (F-016) and issue-tracker links (F-076/F-077) for one item. Links open
 * the substituted URL in a new tab; webhooks run on the server and answer with a toast.
 */
export function ItemActions({ data }: { data: FeedbackDetail }) {
  const t = useT();
  const f = data.feedback;
  const [runAction, run] = useRunPanelActionMutation();
  const [createIssue, send] = useCreateIssueMutation();
  const runId = run.isLoading ? run.originalArgs?.actionId : undefined;
  const sendingTo = send.isLoading ? send.originalArgs?.integrationId : undefined;

  const runPanelAction = (actionId: string) => {
    const label = data.panelActions.find((a) => a.id === actionId)?.label ?? t("inbox2.actionFallback");
    runAction({ feedbackId: f.id, actionId })
      .unwrap()
      .then((r) => {
        if (r.ok) toast.success(r.message ?? t("inbox2.actionDone", { label }));
        else
          toast.error(t("inbox2.actionFailed", { label }), {
            description: r.message ?? r.error ?? `HTTP ${r.status}`,
          });
      })
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };
  const sendToTracker = (integrationId: string) => {
    createIssue({ feedbackId: f.id, integrationId })
      .unwrap()
      .then(({ issue }) =>
        toast.success(
          t("inbox2.issueCreated", { tracker: TRACKER_NAMES[issue.provider], ref: issueRef(issue) }),
        ),
      )
      .catch((e: unknown) => toast.error(t("inbox2.issueCreateFailed"), { description: errorMessage(e) }));
  };

  const unsent = data.integrations.filter((i) => !data.issues.some((l) => l.integrationId === i.id));
  if (!data.panelActions.length && !data.integrations.length && !data.issues.length) return null;

  return (
    <section
      aria-label={t("inbox2.actions")}
      className="flex flex-wrap items-center gap-1.5"
      data-testid="item-actions"
    >
      {data.issues.map((l) => (
        <a
          key={l.id}
          href={safeHref(l.url) ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
          data-testid="issue-link"
        >
          <TrackerIcon
            provider={l.provider}
            className={l.state === "open" ? "text-emerald-600" : "text-violet-600"}
          />
          {TRACKER_NAMES[l.provider]} {issueRef(l)}
          <span className="text-muted-foreground">· {l.state}</span>
        </a>
      ))}
      {unsent.map((i) => (
        <Button
          key={i.id}
          variant="outline"
          size="sm"
          disabled={!!sendingTo}
          onClick={() => sendToTracker(i.id)}
          title={t("inbox2.openIssueIn", { repo: i.repo })}
        >
          {sendingTo === i.id ? <Loader2 className="animate-spin" /> : <Send />}
          {t("inbox2.sendTo", { tracker: TRACKER_NAMES[i.provider] })}
        </Button>
      ))}
      {data.panelActions.map((a) =>
        a.kind === "link" ? (
          <a
            key={a.id}
            href={
              safeHref(
                substituteActionUrl(a.url, {
                  id: f.id,
                  number: f.number,
                  url: f.pageUrl,
                  projectSlug: f.projectSlug,
                }),
              ) ?? undefined
            }
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <PanelActionIcon action={a} />
            {a.label}
          </a>
        ) : (
          <Button
            key={a.id}
            variant="outline"
            size="sm"
            disabled={runId === a.id}
            onClick={() => runPanelAction(a.id)}
          >
            {runId === a.id ? <Loader2 className="animate-spin" /> : <PanelActionIcon action={a} />}
            {a.label}
          </Button>
        ),
      )}
    </section>
  );
}
