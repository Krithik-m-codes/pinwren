"use client";

import { Bot, Copy, Download, ExternalLink, Loader2, Send, Sparkles, Terminal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { copyText } from "@/components/copy-button";
import { ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { FeedbackDetail } from "@/lib/api";
import { useT } from "@/lib/i18n/provider";
import {
  errorMessage,
  useAgentBriefQuery,
  useReproTestQuery,
  useRunPanelActionMutation,
} from "@/lib/store/api";

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/typescript" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * "Fix with agent": the agent-ready brief (copy it, copy the `claude` command, open Cursor, copy the VS Code
 * command, send it to the project's agent webhooks) and the draft Playwright test. Everything shown is built on
 * the server from masked diagnostics; the replay and screenshot are linked, never included.
 */
export function AgentHandoff({ data }: { data: FeedbackDetail }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const id = data.feedback.id;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" data-testid="fix-with-agent">
            <Bot /> <span className="hidden sm:inline">{t("handoff.fixWithAgent")}</span>
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] gap-3 overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("handoff.title", { number: data.feedback.number })}</DialogTitle>
          <DialogDescription>{t("handoff.description")}</DialogDescription>
        </DialogHeader>
        {open && <HandoffBody id={id} data={data} />}
      </DialogContent>
    </Dialog>
  );
}

function HandoffBody({ id, data }: { id: string; data: FeedbackDetail }) {
  const t = useT();
  const brief = useAgentBriefQuery(id);
  const [runAction, run] = useRunPanelActionMutation();
  const agents = data.panelActions.filter((a) => a.kind === "webhook" && a.agent);
  const runId = run.isLoading ? run.originalArgs?.actionId : undefined;

  const send = (actionId: string, label: string) => {
    runAction({ feedbackId: id, actionId })
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
  const openCursor = (url: string) => {
    // The cursor:// link opens the desktop app with the prompt filled in; nothing is sent until the person presses enter there.
    window.location.assign(url);
  };

  return (
    <Tabs defaultValue="brief">
      <TabsList className="h-8">
        <TabsTrigger value="brief" className="px-2.5">
          <Bot /> {t("handoff.tabBrief")}
        </TabsTrigger>
        <TabsTrigger value="test" className="px-2.5">
          <Terminal /> {t("handoff.tabTest")}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="brief" className="grid gap-3 pt-2">
        {brief.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : brief.isError || !brief.data ? (
          <ErrorState error={brief.error} retry={() => void brief.refetch()} className="py-6" />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5" data-testid="handoff-actions">
              <Button
                size="sm"
                onClick={() => void copyText(brief.data.markdown, t("handoff.briefCopied"), t)}
                data-testid="copy-brief"
              >
                <Copy /> {t("handoff.copyBrief")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void copyText(brief.data.commands.claude, t("handoff.claudeCopied"), t)}
                data-testid="copy-claude"
              >
                <Terminal /> {t("handoff.copyClaude")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openCursor(brief.data.links.cursor)}
                data-testid="open-cursor"
              >
                <ExternalLink /> {t("handoff.openCursor")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void copyText(brief.data.commands.vscode, t("handoff.vsCodeCopied"), t)}
              >
                <Copy /> {t("handoff.copyVsCode")}
              </Button>
              {agents.map((a) => (
                <Button
                  key={a.id}
                  size="sm"
                  variant="outline"
                  disabled={runId === a.id}
                  onClick={() => send(a.id, a.label)}
                  data-testid="send-to-agent"
                >
                  {runId === a.id ? <Loader2 className="animate-spin" /> : <Send />}
                  {t("handoff.sendTo", { label: a.label })}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t("handoff.privacy")}</p>
            <pre
              className="max-h-80 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs break-words whitespace-pre-wrap"
              aria-label={t("handoff.tabBrief")}
              data-testid="brief-preview"
            >
              {brief.data.markdown}
            </pre>
            <div className="grid gap-1">
              <p className="text-xs font-medium">{t("handoff.commands")}</p>
              <code className="rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-all">
                {brief.data.commands.claude}
              </code>
            </div>
          </>
        )}
      </TabsContent>

      <TabsContent value="test" className="grid gap-3 pt-2">
        <ReproTestPanel id={id} />
      </TabsContent>
    </Tabs>
  );
}

function ReproTestPanel({ id }: { id: string }) {
  const t = useT();
  const [polish, setPolish] = useState(false);
  // The plain draft always loads; the polished one only when asked for (it calls the org's AI provider).
  const draft = useReproTestQuery({ id });
  const polished = useReproTestQuery({ id, polish: true }, { skip: !polish });
  const shown = polish && polished.data ? polished.data : draft.data;

  if (draft.isLoading) return <Skeleton className="h-64 w-full" />;
  if (draft.isError || !shown) {
    return <ErrorState error={draft.error} retry={() => void draft.refetch()} className="py-6" />;
  }
  return (
    <>
      <div role="note" className="rounded-lg border bg-muted/40 p-3 text-sm" data-testid="repro-caveats">
        <p className="font-medium">{t("handoff.caveatTitle")}</p>
        <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
          {shown.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          onClick={() => void copyText(shown.code, t("handoff.testCopied"), t)}
          data-testid="copy-test"
        >
          <Copy /> {t("handoff.copyTest")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => download(shown.filename, shown.code)}>
          <Download /> {t("handoff.downloadTest")}
        </Button>
        {polish ? (
          <Button size="sm" variant="ghost" onClick={() => setPolish(false)}>
            {t("handoff.showOriginal")}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setPolish(true)} title={t("handoff.polishHint")}>
            <Sparkles /> {t("handoff.polish")}
          </Button>
        )}
        {shown.polished && <Badge variant="secondary">{t("handoff.polished")}</Badge>}
        <span className="ml-auto font-mono text-xs text-muted-foreground">{shown.filename}</span>
      </div>
      {polish && polished.isLoading && <Skeleton className="h-4 w-48" />}
      {polish && polished.isError && (
        <p role="alert" className="text-xs text-destructive">
          {errorMessage(polished.error, t("handoff.testLoadFailed"))}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {t("handoff.testStats", { scripted: shown.stats.scripted, skipped: shown.stats.skipped })} ·{" "}
        {shown.stats.expectations.length
          ? t("handoff.asserts", { list: shown.stats.expectations.join(", ") })
          : t("handoff.assertsNothing")}
      </p>
      <pre
        className="max-h-96 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs"
        aria-label={t("handoff.tabTest")}
        data-testid="repro-code"
      >
        {shown.code}
      </pre>
    </>
  );
}
