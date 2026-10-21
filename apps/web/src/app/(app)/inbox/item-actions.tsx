"use client";

import { substituteActionUrl } from "@pinwren/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { PanelActionIcon } from "@/components/panel-action-icon";
import { TRACKER_NAMES, TrackerIcon } from "@/components/tracker-icon";
import { Button, buttonVariants } from "@/components/ui/button";
import { type ActionResult, api, type FeedbackDetail, type IssueLink, qk } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The project's panel actions (F-016) and issue-tracker links (F-076/F-077) for one item. Links open
 * the substituted URL in a new tab; webhooks run on the server and answer with a toast.
 */
export function ItemActions({ data }: { data: FeedbackDetail }) {
  const qc = useQueryClient();
  const f = data.feedback;
  const refresh = () => qc.invalidateQueries({ queryKey: qk.feedback(f.id) });

  const run = useMutation({
    mutationFn: (actionId: string) =>
      api<ActionResult>(`/feedback/${f.id}/actions/${encodeURIComponent(actionId)}`, { method: "POST" }),
    onSuccess: (r, actionId) => {
      const label = data.panelActions.find((a) => a.id === actionId)?.label ?? "Action";
      if (r.ok) toast.success(r.message ?? `${label}: done`);
      else toast.error(`${label} failed`, { description: r.message ?? r.error ?? `HTTP ${r.status}` });
      void refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const send = useMutation({
    mutationFn: (integrationId: string) =>
      api<{ issue: IssueLink }>(`/feedback/${f.id}/issues`, { method: "POST", json: { integrationId } }),
    onSuccess: ({ issue }) => {
      toast.success(`${TRACKER_NAMES[issue.provider]} issue #${issue.number} created`);
      void refresh();
    },
    onError: (e) => toast.error("Couldn't create the issue", { description: e.message }),
  });

  const unsent = data.integrations.filter((i) => !data.issues.some((l) => l.integrationId === i.id));
  if (!data.panelActions.length && !data.integrations.length && !data.issues.length) return null;

  return (
    <section aria-label="Actions" className="flex flex-wrap items-center gap-1.5" data-testid="item-actions">
      {data.issues.map((l) => (
        <a
          key={l.id}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
          data-testid="issue-link"
        >
          <TrackerIcon
            provider={l.provider}
            className={l.state === "open" ? "text-emerald-600" : "text-violet-600"}
          />
          {TRACKER_NAMES[l.provider]} #{l.number}
          <span className="text-muted-foreground">· {l.state}</span>
        </a>
      ))}
      {unsent.map((i) => (
        <Button
          key={i.id}
          variant="outline"
          size="sm"
          disabled={send.isPending}
          onClick={() => send.mutate(i.id)}
          title={`Open an issue in ${i.repo}`}
        >
          {send.isPending && send.variables === i.id ? <Loader2 className="animate-spin" /> : <Send />}
          Send to {TRACKER_NAMES[i.provider]}
        </Button>
      ))}
      {data.panelActions.map((a) =>
        a.kind === "link" ? (
          <a
            key={a.id}
            href={substituteActionUrl(a.url, {
              id: f.id,
              number: f.number,
              url: f.pageUrl,
              projectSlug: f.projectSlug,
            })}
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
            disabled={run.isPending && run.variables === a.id}
            onClick={() => run.mutate(a.id)}
          >
            {run.isPending && run.variables === a.id ? (
              <Loader2 className="animate-spin" />
            ) : (
              <PanelActionIcon action={a} />
            )}
            {a.label}
          </Button>
        ),
      )}
    </section>
  );
}
