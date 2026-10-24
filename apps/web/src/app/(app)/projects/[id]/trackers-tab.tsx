"use client";

import { ISSUE_PROVIDERS, type ISSUE_AUTO_CREATE, type IssueProvider } from "@pinwren/core";
import { CircleAlert, CircleCheck, Eye, KeyRound, PlugZap, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
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
  useEntitlementsQuery,
  useLazyTrackerWebhookSecretQuery,
  useTestTrackerMutation,
  useTrackersQuery,
  useUpdateTrackerMutation,
} from "@/lib/store/api";

type AutoCreate = (typeof ISSUE_AUTO_CREATE)[number];

type Meta = {
  name: string;
  repoLabel: string;
  repoPlaceholder: string;
  /** null: the provider has no base URL (Linear). */
  url: { label: string; placeholder: string; required: boolean } | null;
  tokenLabel: string;
  tokenHelp: string;
  /** What closes the item on the tracker's side. */
  closes: string;
  hookHelp: React.ReactNode;
  /** Linear generates the signing secret itself, so it is pasted here instead of revealed. */
  pasteSecret: boolean;
  /** Needs the Enterprise `jira` licence feature (blueprint 07). */
  enterprise: boolean;
};

const META: Record<IssueProvider, Meta> = {
  github: {
    name: "GitHub",
    repoLabel: "Repository",
    repoPlaceholder: "owner/name",
    url: {
      label: "GitHub Enterprise API URL",
      placeholder: "https://github.example.com/api/v3",
      required: false,
    },
    tokenLabel: "Access token",
    tokenHelp: "A fine-grained personal access token with Issues: read & write on the repository.",
    closes: "Closing the issue resolves the item; resolving the item closes the issue.",
    hookHelp: (
      <>
        In the repository: <b>Settings › Webhooks › Add webhook</b>. Content type{" "}
        <code>application/json</code>, the secret below, events: <b>Issues</b>.
      </>
    ),
    pasteSecret: false,
    enterprise: false,
  },
  gitlab: {
    name: "GitLab",
    repoLabel: "Project path",
    repoPlaceholder: "group/subgroup/project",
    url: { label: "Self-managed GitLab URL", placeholder: "https://gitlab.example.com", required: false },
    tokenLabel: "Access token",
    tokenHelp: "A project or personal access token with the api scope.",
    closes: "Closing the issue resolves the item; resolving the item closes the issue.",
    hookHelp: (
      <>
        In the project: <b>Settings › Webhooks › Add new webhook</b>. Put the secret below in{" "}
        <b>Secret token</b>, and tick <b>Issues events</b>.
      </>
    ),
    pasteSecret: false,
    enterprise: false,
  },
  linear: {
    name: "Linear",
    repoLabel: "Team key",
    repoPlaceholder: "ENG",
    url: null,
    tokenLabel: "API key",
    tokenHelp: "A personal API key from Linear: Settings › Account › Security & access › Personal API keys.",
    closes:
      "Moving the issue to a completed or canceled state resolves the item; resolving the item completes the issue.",
    hookHelp: (
      <>
        In Linear: <b>Settings › API › Webhooks › New webhook</b>. Paste the URL below, pick the team, tick{" "}
        <b>Issues</b>, save, then paste Linear&apos;s <b>signing secret</b> here.
      </>
    ),
    pasteSecret: true,
    enterprise: false,
  },
  jira: {
    name: "Jira",
    repoLabel: "Project key",
    repoPlaceholder: "WEB",
    url: { label: "Jira site URL", placeholder: "https://acme.atlassian.net", required: true },
    tokenLabel: "API token",
    tokenHelp:
      "An API token from id.atlassian.com › Security › API tokens, for an account that can create issues.",
    closes: "Moving the issue to a Done status resolves the item; resolving the item moves it to Done.",
    hookHelp: (
      <>
        In Jira: <b>Settings › System › WebHooks › Create a WebHook</b>. Paste the URL and the secret below,
        limit it with JQL <code>project = KEY</code>, and tick <b>Issue › updated</b>.
      </>
    ),
    pasteSecret: false,
    enterprise: true,
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
 * Issue sync with GitHub, GitLab, Linear and Jira Cloud (F-076–F-079), token-based so a self-hosted instance
 * needs no OAuth app (ADR 0015). Closing or reopening on either side updates the other. Jira needs the
 * Enterprise licence.
 */
export function TrackersTab({ project }: { project: ProjectDetail }) {
  const query = useTrackersQuery(project.id);
  const entitlements = useEntitlementsQuery(undefined);
  const jiraLicensed = !!entitlements.data?.features.includes("jira");
  if (query.isLoading) return <Skeleton className="h-80 max-w-3xl rounded-xl" />;
  if (isForbidden(query.error)) {
    return (
      <Card className="max-w-3xl">
        <CardContent>
          <EmptyState
            icon={PlugZap}
            title="Workspace Admins only"
            description="Ask a workspace Admin to connect GitHub, GitLab, Linear or Jira. You can still send items to a connected tracker from the inbox."
          />
        </CardContent>
      </Card>
    );
  }
  const data = query.data;
  if (!data) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  return (
    <div className="grid max-w-3xl gap-4">
      {ISSUE_PROVIDERS.map((provider) => {
        const i = data.integrations.find((x) => x.provider === provider);
        const locked = META[provider].enterprise && !jiraLicensed && !entitlements.isLoading;
        return i ? (
          <ConnectedCard key={provider} project={project} integration={i} unlicensed={locked} />
        ) : (
          <ConnectCard key={provider} project={project} provider={provider} locked={locked} />
        );
      })}
    </div>
  );
}

function EnterpriseNote({ connected }: { connected?: boolean }) {
  return (
    <p
      className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400"
      data-testid="jira-licence"
    >
      <Sparkles className="mt-0.5 size-4 shrink-0" />
      <span>
        Jira is an Enterprise feature.{" "}
        {connected
          ? "This connection is paused until a licence with Jira is installed"
          : "Install a licence with Jira to connect it"}{" "}
        (
        <Link href="/settings/license" className="underline underline-offset-2">
          Settings › Licence
        </Link>
        ).
      </span>
    </p>
  );
}

function ConnectCard({
  project,
  provider,
  locked,
}: {
  project: ProjectDetail;
  provider: IssueProvider;
  locked: boolean;
}) {
  const m = META[provider];
  const [open, setOpen] = useState(false);
  const [create] = useCreateTrackerMutation();
  const form = useZodForm(trackerForm, {
    defaultValues: {
      provider,
      token: "",
      repo: "",
      apiUrl: "",
      email: "",
      labels: "feedback",
      autoCreate: "bugs",
      webhookSecret: "",
    },
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
          apiUrl: m.url ? v.apiUrl || null : null,
          labels: parseLabels(v.labels),
          autoCreate: v.autoCreate,
          ...(provider === "jira" ? { email: v.email } : {}),
          ...(m.pasteSecret && v.webhookSecret ? { webhookSecret: v.webhookSecret } : {}),
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
          {m.enterprise && (
            <Badge variant="outline" className="font-normal">
              Enterprise
            </Badge>
          )}
          {!open && (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              disabled={locked}
              onClick={() => setOpen(true)}
            >
              Connect {m.name}
            </Button>
          )}
        </CardTitle>
        <CardDescription>
          Open an issue for each item (automatically or with “Send to {m.name}”). {m.closes}
        </CardDescription>
        {locked && <EnterpriseNote />}
      </CardHeader>
      {open && !locked && (
        <CardContent>
          <form noValidate className="grid gap-4" onSubmit={(e) => void submit(e)}>
            {m.url?.required && (
              <Field id={id("url")} label={m.url.label} error={errors.apiUrl?.message}>
                <Input
                  {...controlProps(id("url"), errors.apiUrl?.message)}
                  inputMode="url"
                  spellCheck={false}
                  placeholder={m.url.placeholder}
                  className="font-mono text-[13px]"
                  {...form.register("apiUrl")}
                />
              </Field>
            )}
            {provider === "jira" && (
              <Field
                id={id("email")}
                label="Account email"
                help="The Atlassian account the API token belongs to."
                error={errors.email?.message}
              >
                <Input
                  {...controlProps(id("email"), errors.email?.message, true)}
                  type="email"
                  autoComplete="off"
                  spellCheck={false}
                  {...form.register("email")}
                />
              </Field>
            )}
            <Field id={id("token")} label={m.tokenLabel} help={m.tokenHelp} error={errors.token?.message}>
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
            {m.url && !m.url.required && (
              <Field
                id={id("url")}
                label={m.url.label}
                help="Optional. Leave empty for the public service."
                error={errors.apiUrl?.message}
              >
                <Input
                  {...controlProps(id("url"), errors.apiUrl?.message, true)}
                  inputMode="url"
                  spellCheck={false}
                  placeholder={m.url.placeholder}
                  className="font-mono text-[13px]"
                  {...form.register("apiUrl")}
                />
              </Field>
            )}
            <Field
              id={id("labels")}
              label="Labels"
              help={
                provider === "linear"
                  ? "Comma-separated names of existing Linear labels, added to every issue."
                  : "Comma-separated, added to every issue."
              }
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
  unlicensed,
}: {
  project: ProjectDetail;
  integration: IssueIntegration;
  unlicensed: boolean;
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
  const p = i.provider;

  return (
    <Card data-testid={`tracker-${p}`}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <TrackerIcon provider={p} className="size-4" /> {m.name}
          <code className="font-mono text-sm font-normal text-muted-foreground">{i.repo}</code>
          <Badge
            variant={i.active && !unlicensed ? "secondary" : "outline"}
            className="ml-auto gap-1.5 font-normal"
          >
            <span
              className={`size-1.5 rounded-full ${i.active && !unlicensed ? "bg-emerald-500" : "bg-muted-foreground"}`}
            />
            {i.active && !unlicensed ? "Connected" : "Paused"}
          </Badge>
        </CardTitle>
        {unlicensed && <EnterpriseNote connected />}
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
              disabled={unlicensed}
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
          <SettingRow label="Labels" htmlFor={`${p}-labels-edit`} description="Comma-separated.">
            <Input
              id={`${p}-labels-edit`}
              className="w-full sm:w-64"
              value={labels}
              disabled={unlicensed}
              onChange={(e) => setLabels(e.target.value)}
              onBlur={() => {
                const next = parseLabels(labels);
                if (next.join(",") !== i.labels.join(","))
                  update.mutate({ patch: { labels: next }, message: "Labels saved" });
              }}
            />
          </SettingRow>
          {p === "jira" && (
            <SettingRow label="Site" description={i.email ? `Signed in as ${i.email}.` : undefined}>
              <code className="font-mono text-xs break-all">{i.apiUrl}</code>
            </SettingRow>
          )}
          <SettingRow
            label={m.tokenLabel}
            htmlFor={`${p}-token-edit`}
            description={`Saved (ends ${i.tokenHint.replace("…", "")}). Paste a new one to replace it.`}
          >
            <ReplaceToken
              id={`${p}-token-edit`}
              disabled={unlicensed}
              onReplace={(token) => update.mutate({ patch: { token }, message: `${m.tokenLabel} replaced` })}
            />
          </SettingRow>
          <SettingRow
            label="Sync"
            htmlFor={`${p}-active`}
            description="Pause to stop creating and updating issues."
          >
            <Switch
              id={`${p}-active`}
              checked={i.active}
              disabled={unlicensed && !i.active}
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
              {m.pasteSecret ? (
                <PasteSecret
                  id={`${p}-secret-edit`}
                  disabled={unlicensed}
                  onSave={(webhookSecret) =>
                    update.mutate({ patch: { webhookSecret }, message: "Signing secret saved" })
                  }
                />
              ) : hook ? (
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
          <Button variant="outline" size="sm" disabled={test.isLoading || unlicensed} onClick={runTest}>
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

function ReplaceToken({
  id,
  onReplace,
  disabled,
}: {
  id: string;
  onReplace: (token: string) => void;
  disabled?: boolean;
}) {
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
        disabled={disabled}
        aria-invalid={form.formState.errors.token ? true : undefined}
        {...form.register("token")}
      />
      <Button type="submit" variant="outline" size="default" disabled={!!disabled || token.trim().length < 8}>
        Replace
      </Button>
    </form>
  );
}

/** Linear's signing secret, pasted after creating the webhook there (core's issueIntegrationUpdate rule). */
const pasteSecretForm = z.object({
  secret: z
    .string()
    .trim()
    .min(16, "Paste the whole signing secret")
    .pipe(issueIntegrationUpdate.shape.webhookSecret.unwrap()),
});

function PasteSecret({
  id,
  onSave,
  disabled,
}: {
  id: string;
  onSave: (secret: string) => void;
  disabled?: boolean;
}) {
  const form = useZodForm(pasteSecretForm, { defaultValues: { secret: "" } });
  const secret = useWatch({ control: form.control, name: "secret" });
  const error = form.formState.errors.secret?.message;
  const submit = form.handleSubmit((v) => {
    onSave(v.secret);
    form.reset({ secret: "" });
  });
  return (
    <form className="grid gap-1" noValidate onSubmit={(e) => void submit(e)}>
      <label htmlFor={id} className="text-xs text-muted-foreground">
        Signing secret from Linear
      </label>
      <div className="flex gap-2">
        <Input
          {...controlProps(id, error)}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="lin_wh_…"
          className="w-full font-mono text-xs sm:w-72"
          disabled={disabled}
          {...form.register("secret")}
        />
        <Button type="submit" variant="outline" disabled={!!disabled || !secret.trim()}>
          <KeyRound /> Save
        </Button>
      </div>
      <FormError message={error} />
    </form>
  );
}
