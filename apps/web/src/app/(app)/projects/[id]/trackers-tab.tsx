"use client";

import type { ISSUE_AUTO_CREATE, IssueProvider } from "@pinwren/core";
import { CircleAlert, CircleCheck, Eye, PlugZap, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton } from "@/components/copy-button";
import { Segmented } from "@/components/segmented";
import { SettingGroup, SettingRow } from "@/components/setting-row";
import { EmptyState, ErrorState } from "@/components/states";
import { TrackerIcon } from "@/components/tracker-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { issueIntegrationUpdate } from "@pinwren/core";
import { Controller, useWatch } from "react-hook-form";
import { z } from "zod";
import { controlProps, Field, FormError, useZodForm } from "@/components/form";
import type { IssueIntegration, ProjectDetail } from "@/lib/api";
import { trackerForm } from "@/lib/form-schemas";
import {
  errorMessage,
  isForbidden,
  useCreateTrackerMutation,
  useDeleteTrackerMutation,
  useLazyTrackerWebhookSecretQuery,
  useTestTrackerMutation,
  useTrackersQuery,
  useUpdateTrackerMutation,
} from "@/lib/store/api";

type AutoCreate = (typeof ISSUE_AUTO_CREATE)[number];

const META: Record<
  IssueProvider,
  {
    name: string;
    repoLabel: string;
    repoPlaceholder: string;
    urlLabel: string;
    urlPlaceholder: string;
    tokenHelp: string;
    hookHelp: React.ReactNode;
  }
> = {
  github: {
    name: "GitHub",
    repoLabel: "Repository",
    repoPlaceholder: "owner/name",
    urlLabel: "GitHub Enterprise API URL",
    urlPlaceholder: "https://github.example.com/api/v3",
    tokenHelp: "A fine-grained personal access token with Issues: read & write on the repository.",
    hookHelp: (
      <>
        In the repository: <b>Settings › Webhooks › Add webhook</b>. Content type{" "}
        <code>application/json</code>, the secret below, events: <b>Issues</b>.
      </>
    ),
  },
  gitlab: {
    name: "GitLab",
    repoLabel: "Project path",
    repoPlaceholder: "group/subgroup/project",
    urlLabel: "Self-managed GitLab URL",
    urlPlaceholder: "https://gitlab.example.com",
    tokenHelp: "A project or personal access token with the api scope.",
    hookHelp: (
      <>
        In the project: <b>Settings › Webhooks › Add new webhook</b>. Put the secret below in{" "}
        <b>Secret token</b>, and tick <b>Issues events</b>.
      </>
    ),
  },
};

const AUTO_OPTIONS: { value: AutoCreate; label: string }[] = [
  { value: "manual", label: "Manually" },
  { value: "bugs", label: "Bugs" },
  { value: "all", label: "Everything" },
];

const parseLabels = (s: string) =>
  [
    ...new Set(
      s
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean),
    ),
  ].slice(0, 10);

/**
 * GitHub / GitLab issue sync (F-076/F-077), token-based so a self-hosted instance needs no OAuth or
 * GitHub App (ADR 0015). Closing or reopening on either side updates the other.
 */
export function TrackersTab({ project }: { project: ProjectDetail }) {
  const query = useTrackersQuery(project.id);
  if (query.isLoading) return <Skeleton className="h-80 max-w-3xl rounded-xl" />;
  if (isForbidden(query.error)) {
    return (
      <Card className="max-w-3xl">
        <CardContent>
          <EmptyState
            icon={PlugZap}
            title="Workspace admins only"
            description="Ask an owner or admin to connect GitHub or GitLab. You can still send items to a connected tracker from the inbox."
          />
        </CardContent>
      </Card>
    );
  }
  const data = query.data;
  if (!data) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  return (
    <div className="grid max-w-3xl gap-4">
      {(["github", "gitlab"] as const).map((provider) => {
        const i = data.integrations.find((x) => x.provider === provider);
        return i ? (
          <ConnectedCard key={provider} project={project} integration={i} />
        ) : (
          <ConnectCard key={provider} project={project} provider={provider} />
        );
      })}
    </div>
  );
}

function ConnectCard({ project, provider }: { project: ProjectDetail; provider: IssueProvider }) {
  const m = META[provider];
  const [open, setOpen] = useState(false);
  const [create] = useCreateTrackerMutation();
  const form = useZodForm(trackerForm, {
    defaultValues: { token: "", repo: "", apiUrl: "", labels: "feedback", autoCreate: "bugs" },
  });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (v) => {
    try {
      await create({
        projectId: project.id,
        body: {
          provider,
          token: v.token,
          repo: v.repo,
          apiUrl: v.apiUrl || null,
          labels: parseLabels(v.labels),
          autoCreate: v.autoCreate,
        },
      }).unwrap();
      toast.success(`${m.name} connected`);
    } catch (err) {
      form.setError("root", { message: errorMessage(err) });
    }
  });
  const id = (k: string) => `${provider}-${k}`;

  return (
    <Card data-testid={`tracker-${provider}`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrackerIcon provider={provider} className="size-4" /> {m.name}
          {!open && (
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => setOpen(true)}>
              Connect {m.name}
            </Button>
          )}
        </CardTitle>
        <CardDescription>
          Open an issue for each item (automatically or with “Send to {m.name}”). Closing the issue resolves
          the item; resolving the item closes the issue.
        </CardDescription>
      </CardHeader>
      {open && (
        <CardContent>
          <form noValidate className="grid gap-4" onSubmit={(e) => void submit(e)}>
            <Field id={id("token")} label="Access token" help={m.tokenHelp} error={errors.token?.message}>
              <Input
                {...controlProps(id("token"), errors.token?.message, true)}
                type="password"
                autoComplete="off"
                {...form.register("token")}
              />
            </Field>
            <Field id={id("repo")} label={m.repoLabel} error={errors.repo?.message}>
              <Input
                {...controlProps(id("repo"), errors.repo?.message)}
                spellCheck={false}
                placeholder={m.repoPlaceholder}
                className="font-mono text-[13px]"
                {...form.register("repo")}
              />
            </Field>
            <Field
              id={id("url")}
              label={m.urlLabel}
              help="Optional. Leave empty for the public service."
              error={errors.apiUrl?.message}
            >
              <Input
                {...controlProps(id("url"), errors.apiUrl?.message, true)}
                inputMode="url"
                spellCheck={false}
                placeholder={m.urlPlaceholder}
                className="font-mono text-[13px]"
                {...form.register("apiUrl")}
              />
            </Field>
            <Field
              id={id("labels")}
              label="Labels"
              help="Comma-separated, added to every issue."
              error={errors.labels?.message}
            >
              <Input
                {...controlProps(id("labels"), errors.labels?.message, true)}
                {...form.register("labels")}
              />
            </Field>
            <div className="grid gap-1.5">
              <p className="text-sm font-medium">Open issues for</p>
              <Controller
                control={form.control}
                name="autoCreate"
                render={({ field }) => (
                  <Segmented
                    label={`Open ${m.name} issues for`}
                    value={field.value}
                    onChange={field.onChange}
                    options={AUTO_OPTIONS}
                  />
                )}
              />
            </div>
            <FormError message={errors.root?.message} />
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Connecting…" : `Connect ${m.name}`}
              </Button>
            </div>
          </form>
        </CardContent>
      )}
    </Card>
  );
}

function ConnectedCard({
  project,
  integration: i,
}: {
  project: ProjectDetail;
  integration: IssueIntegration;
}) {
  const m = META[i.provider];
  const [labels, setLabels] = useState(i.labels.join(", "));
  const [hook, setHook] = useState<{ secret: string; url: string } | null>(null);
  const [testResult, setTestResult] = useState<
    { ok: true; name: string } | { ok: false; message: string } | null
  >(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [updateTracker] = useUpdateTrackerMutation();
  const [testTracker, test] = useTestTrackerMutation();
  const [revealSecret, reveal] = useLazyTrackerWebhookSecretQuery();
  const [deleteTracker, remove] = useDeleteTrackerMutation();
  const update = {
    mutate: ({ patch, message }: { patch: Record<string, unknown>; message: string }) => {
      updateTracker({ id: i.id, projectId: project.id, patch })
        .unwrap()
        .then(() => toast.success(message))
        .catch((e: unknown) => toast.error("Not saved", { description: errorMessage(e) }));
    },
  };
  const runTest = () => {
    testTracker({ id: i.id, projectId: project.id })
      .unwrap()
      .then(setTestResult)
      .catch((e: unknown) => setTestResult({ ok: false, message: errorMessage(e) }));
  };
  const showSecret = () => {
    revealSecret(i.id)
      .unwrap()
      .then(setHook)
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };
  const disconnect = () => {
    deleteTracker({ id: i.id, projectId: project.id })
      .unwrap()
      .then(() => {
        toast.success(`${m.name} disconnected`);
        setConfirmRemove(false);
      })
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };

  return (
    <Card data-testid={`tracker-${i.provider}`}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <TrackerIcon provider={i.provider} className="size-4" /> {m.name}
          <code className="font-mono text-sm font-normal text-muted-foreground">{i.repo}</code>
          <Badge variant={i.active ? "secondary" : "outline"} className="ml-auto gap-1.5 font-normal">
            <span
              className={`size-1.5 rounded-full ${i.active ? "bg-emerald-500" : "bg-muted-foreground"}`}
            />
            {i.active ? "Connected" : "Paused"}
          </Badge>
        </CardTitle>
        {i.lastError && (
          <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
            <CircleAlert className="mt-0.5 size-4 shrink-0" /> Last error: {i.lastError}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <SettingGroup>
          <SettingRow
            label="Open issues for"
            description="New items that get an issue without anyone pressing a button."
          >
            <Segmented
              label={`Open ${m.name} issues for`}
              value={i.autoCreate}
              onChange={(autoCreate) =>
                update.mutate({
                  patch: { autoCreate },
                  message:
                    autoCreate === "manual"
                      ? "Issues are opened by hand"
                      : `Issues open for ${autoCreate === "all" ? "every item" : "bugs"}`,
                })
              }
              options={AUTO_OPTIONS}
            />
          </SettingRow>
          <SettingRow label="Labels" htmlFor={`${i.provider}-labels-edit`} description="Comma-separated.">
            <Input
              id={`${i.provider}-labels-edit`}
              className="w-full sm:w-64"
              value={labels}
              onChange={(e) => setLabels(e.target.value)}
              onBlur={() => {
                const next = parseLabels(labels);
                if (next.join(",") !== i.labels.join(","))
                  update.mutate({ patch: { labels: next }, message: "Labels saved" });
              }}
            />
          </SettingRow>
          <SettingRow
            label="Access token"
            htmlFor={`${i.provider}-token-edit`}
            description={`Saved (ends ${i.tokenHint.replace("…", "")}). Paste a new one to replace it.`}
          >
            <ReplaceToken
              id={`${i.provider}-token-edit`}
              onReplace={(token) => update.mutate({ patch: { token }, message: "Token replaced" })}
            />
          </SettingRow>
          <SettingRow
            label="Sync"
            htmlFor={`${i.provider}-active`}
            description="Pause to stop creating and updating issues."
          >
            <Switch
              id={`${i.provider}-active`}
              checked={i.active}
              onCheckedChange={(active) =>
                update.mutate({ patch: { active }, message: active ? "Sync resumed" : "Sync paused" })
              }
            />
          </SettingRow>
          <SettingRow label="Two-way status" description={m.hookHelp} stack>
            <div className="grid gap-2">
              <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-2 pl-3">
                <span className="w-14 shrink-0 text-xs text-muted-foreground">URL</span>
                <code className="min-w-0 flex-1 font-mono text-xs break-all">{i.webhookUrl}</code>
                <CopyButton value={i.webhookUrl} label="Copy URL" />
              </div>
              {hook ? (
                <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-2 pl-3">
                  <span className="w-14 shrink-0 text-xs text-muted-foreground">Secret</span>
                  <code
                    className="min-w-0 flex-1 font-mono text-xs break-all select-all"
                    data-testid="tracker-secret"
                  >
                    {hook.secret}
                  </code>
                  <CopyButton value={hook.secret} label="Copy secret" />
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-self-start"
                  disabled={reveal.isFetching}
                  onClick={showSecret}
                >
                  <Eye /> Reveal webhook secret
                </Button>
              )}
            </div>
          </SettingRow>
        </SettingGroup>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
          <Button variant="outline" size="sm" disabled={test.isLoading} onClick={runTest}>
            <PlugZap /> {test.isLoading ? "Testing…" : "Test connection"}
          </Button>
          {testResult && (
            <span
              role="status"
              className={`flex items-center gap-1.5 text-sm ${testResult.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}
            >
              {testResult.ok ? <CircleCheck className="size-4" /> : <CircleAlert className="size-4" />}
              {testResult.ok ? `Can reach ${testResult.name}` : testResult.message}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-destructive hover:text-destructive"
            onClick={() => setConfirmRemove(true)}
          >
            <Trash2 /> Disconnect
          </Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Disconnect ${m.name}?`}
        description="Existing issues stay where they are, but stop syncing. The links on items are removed."
        confirmLabel="Disconnect"
        pending={remove.isLoading}
        onConfirm={disconnect}
      />
    </Card>
  );
}

/** Replace a tracker's access token (core's issueIntegrationUpdate.token rule). */
const replaceTokenForm = z.object({
  token: z.string().trim().min(8, "Paste the new token").pipe(issueIntegrationUpdate.shape.token.unwrap()),
});

function ReplaceToken({ id, onReplace }: { id: string; onReplace: (token: string) => void }) {
  const form = useZodForm(replaceTokenForm, { defaultValues: { token: "" } });
  const token = useWatch({ control: form.control, name: "token" });
  const submit = form.handleSubmit((v) => {
    onReplace(v.token);
    form.reset({ token: "" });
  });
  return (
    <form className="flex gap-2" noValidate onSubmit={(e) => void submit(e)}>
      <Input
        id={id}
        type="password"
        autoComplete="off"
        className="w-full sm:w-48"
        placeholder="New token"
        aria-invalid={form.formState.errors.token ? true : undefined}
        {...form.register("token")}
      />
      <Button type="submit" variant="outline" size="default" disabled={token.trim().length < 8}>
        Replace
      </Button>
    </form>
  );
}
