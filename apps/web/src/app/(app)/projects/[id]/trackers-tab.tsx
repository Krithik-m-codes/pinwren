"use client";

import {
  cleanTrackerSettings,
  ISSUE_PROVIDERS,
  type ISSUE_AUTO_CREATE,
  type IssueProvider,
  TRACKER_SETTING_KEYS,
} from "@pinwren/core";
import {
  CircleAlert,
  CircleCheck,
  Eye,
  KeyRound,
  PlugZap,
  RefreshCw,
  Sparkles,
  Trash2,
  Webhook,
} from "lucide-react";
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
import { en, type Key } from "@/lib/i18n/en";
import type { TFn } from "@/lib/i18n/english";
import { useI18n, useT } from "@/lib/i18n/provider";
import {
  errorMessage,
  isForbidden,
  useCreateTrackerMutation,
  useDeleteTrackerMutation,
  useEntitlementsQuery,
  useLazyTrackerWebhookSecretQuery,
  useRegisterTrackerWebhookMutation,
  useRestartTrackerHandshakeMutation,
  useTestTrackerMutation,
  useTrackersQuery,
  useUpdateTrackerMutation,
} from "@/lib/store/api";

type AutoCreate = (typeof ISSUE_AUTO_CREATE)[number];

type Meta = {
  name: string;
  repoLabel: Key;
  repoPlaceholder: string;
  /** null: the provider has no base URL (Linear). */
  url: { label: Key; placeholder: string; required: boolean } | null;
  tokenLabel: Key;
  tokenHelp: Key;
  /** What closes the item on the tracker's side. */
  closes: Key;
  hookHelp: (t: TFn) => React.ReactNode;
  /** Linear generates the signing secret itself, so it is pasted here instead of revealed. */
  pasteSecret: boolean;
  /** Needs the Enterprise `jira` licence feature (blueprint 07). */
  enterprise: boolean;
  /** Board trackers (ADR 0029): what a card, task or page is mapped from, and how its webhook is set up. */
  board?: {
    repoHelp: Key;
    mappingHelp: Key;
    /** The mapping fields, in order (core's `TRACKER_SETTING_KEYS`). */
    fields: readonly string[];
    /** `register`: Pinwren registers it through the API. `handshake`: the admin adds the URL in the tracker. */
    hook: "register" | "handshake";
    /** Trello needs the API key besides the token. */
    apiKey?: boolean;
    /** The mapping field that must be filled in. */
    required?: string;
  };
};

/** Placeholders for the mapping fields: example values, not words, so they are not translated. */
const FIELD_PLACEHOLDER: Record<string, string> = {
  listId: "64f1…",
  doneListId: "64f2…",
  sectionGid: "1200…",
  priorityField: "1200…",
  teamId: "9001…",
  openStatus: "to do",
  closedStatus: "complete",
  statusProperty: "Status",
  openValue: "Not started",
  closedValue: "Done",
  priorityProperty: "Priority",
};
const PRIORITY_PLACEHOLDER: Partial<Record<IssueProvider, Record<string, string>>> = {
  trello: { priorityLow: "Low", priorityMedium: "Medium", priorityHigh: "High", priorityUrgent: "Urgent" },
  asana: {
    priorityLow: "1200…",
    priorityMedium: "1200…",
    priorityHigh: "1200…",
    priorityUrgent: "1200…",
  },
  clickup: { priorityLow: "4", priorityMedium: "3", priorityHigh: "2", priorityUrgent: "1" },
  notion: { priorityLow: "Low", priorityMedium: "Medium", priorityHigh: "High", priorityUrgent: "Urgent" },
};

const META: Record<IssueProvider, Meta> = {
  github: {
    name: "GitHub",
    repoLabel: "projects2.repository",
    repoPlaceholder: "owner/name",
    url: {
      label: "projects2.githubEnterpriseApiUrl",
      placeholder: "https://github.example.com/api/v3",
      required: false,
    },
    tokenLabel: "projects2.accessToken",
    tokenHelp: "projects2.githubTokenHelp",
    closes: "projects2.closesGithubGitlab",
    hookHelp: (t) => (
      <>
        {t("projects2.hookGithubIntro")} <b>{t("projects2.hookGithubPath")}</b>.{" "}
        {t("projects2.hookContentType")} <code>application/json</code>, {t("projects2.hookSecretBelowEvents")}{" "}
        <b>{t("projects2.issues")}</b>.
      </>
    ),
    pasteSecret: false,
    enterprise: false,
  },
  gitlab: {
    name: "GitLab",
    repoLabel: "projects2.projectPath",
    repoPlaceholder: "group/subgroup/project",
    url: {
      label: "projects2.selfManagedGitlabUrl",
      placeholder: "https://gitlab.example.com",
      required: false,
    },
    tokenLabel: "projects2.accessToken",
    tokenHelp: "projects2.gitlabTokenHelp",
    closes: "projects2.closesGithubGitlab",
    hookHelp: (t) => (
      <>
        {t("projects2.hookGitlabIntro")} <b>{t("projects2.hookGitlabPath")}</b>.{" "}
        {t("projects2.hookPutSecretIn")} <b>{t("projects2.hookSecretToken")}</b>, {t("projects2.hookAndTick")}{" "}
        <b>{t("projects2.hookIssuesEvents")}</b>.
      </>
    ),
    pasteSecret: false,
    enterprise: false,
  },
  linear: {
    name: "Linear",
    repoLabel: "projects2.teamKey",
    repoPlaceholder: "ENG",
    url: null,
    tokenLabel: "projects2.apiKey",
    tokenHelp: "projects2.linearTokenHelp",
    closes: "projects2.closesLinear",
    hookHelp: (t) => (
      <>
        {t("projects2.hookLinearIntro")} <b>{t("projects2.hookLinearPath")}</b>.{" "}
        {t("projects2.hookPasteUrlPickTeamTick")} <b>{t("projects2.issues")}</b>,{" "}
        {t("projects2.hookSaveThenPaste")} <b>{t("projects2.hookSigningSecret")}</b> {t("projects2.hookHere")}
      </>
    ),
    pasteSecret: true,
    enterprise: false,
  },
  jira: {
    name: "Jira",
    repoLabel: "projects2.projectKey",
    repoPlaceholder: "WEB",
    url: { label: "projects2.jiraSiteUrl", placeholder: "https://acme.atlassian.net", required: true },
    tokenLabel: "projects2.apiToken",
    tokenHelp: "projects2.jiraTokenHelp",
    closes: "projects2.closesJira",
    hookHelp: (t) => (
      <>
        {t("projects2.hookJiraIntro")} <b>{t("projects2.hookJiraPath")}</b>.{" "}
        {t("projects2.hookPasteUrlSecretLimit")} <code>project = KEY</code>, {t("projects2.hookAndTick")}{" "}
        <b>{t("projects2.hookIssueUpdated")}</b>.
      </>
    ),
    pasteSecret: false,
    enterprise: true,
  },
  trello: {
    name: "Trello",
    repoLabel: "trackers.repoTrello",
    repoPlaceholder: "5f1a2b3c4d5e6f7a8b9c0d1e",
    url: null,
    tokenLabel: "trackers.tokenTrello",
    tokenHelp: "trackers.tokenHelpTrello",
    closes: "trackers.descTrello",
    hookHelp: (t) => <>{t("trackers.hookTrello")}</>,
    pasteSecret: true,
    enterprise: false,
    board: {
      repoHelp: "trackers.repoHelpTrello",
      mappingHelp: "trackers.mappingHelpTrello",
      fields: TRACKER_SETTING_KEYS.trello,
      hook: "register",
      apiKey: true,
      required: "listId",
    },
  },
  asana: {
    name: "Asana",
    repoLabel: "trackers.repoAsana",
    repoPlaceholder: "1200000000000000",
    url: null,
    tokenLabel: "trackers.tokenAsana",
    tokenHelp: "trackers.tokenHelpAsana",
    closes: "trackers.descAsana",
    hookHelp: (t) => <>{t("trackers.hookAsana")}</>,
    pasteSecret: false,
    enterprise: false,
    board: {
      repoHelp: "trackers.repoHelpAsana",
      mappingHelp: "trackers.mappingHelpAsana",
      fields: TRACKER_SETTING_KEYS.asana,
      hook: "register",
    },
  },
  clickup: {
    name: "ClickUp",
    repoLabel: "trackers.repoClickup",
    repoPlaceholder: "901234567",
    url: null,
    tokenLabel: "trackers.tokenClickup",
    tokenHelp: "trackers.tokenHelpClickup",
    closes: "trackers.descClickup",
    hookHelp: (t) => <>{t("trackers.hookClickup")}</>,
    pasteSecret: false,
    enterprise: false,
    board: {
      repoHelp: "trackers.repoHelpClickup",
      mappingHelp: "trackers.mappingHelpClickup",
      fields: TRACKER_SETTING_KEYS.clickup,
      hook: "register",
    },
  },
  notion: {
    name: "Notion",
    repoLabel: "trackers.repoNotion",
    repoPlaceholder: "0f0f0f0f0f0f4f0f8f0f0f0f0f0f0f0f",
    url: null,
    tokenLabel: "trackers.tokenNotion",
    tokenHelp: "trackers.tokenHelpNotion",
    closes: "trackers.descNotion",
    hookHelp: (t) => <>{t("trackers.hookNotion")}</>,
    pasteSecret: false,
    enterprise: false,
    board: {
      repoHelp: "trackers.repoHelpNotion",
      mappingHelp: "trackers.mappingHelpNotion",
      fields: TRACKER_SETTING_KEYS.notion,
      hook: "handshake",
    },
  },
};

const fieldLabel = (key: string): Key => `trackers.field.${key}` as Key;

const AUTO_OPTIONS: { value: AutoCreate; label: Key }[] = [
  { value: "manual", label: "projects2.manually" },
  { value: "bugs", label: "projects2.bugs" },
  { value: "all", label: "projects2.everything" },
];

const autoOptions = (t: TFn) => AUTO_OPTIONS.map((o) => ({ value: o.value, label: t(o.label) }));

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
  const t = useT();
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
            title={t("projects2.workspaceAdminsOnly")}
            description={t("projects2.workspaceAdminsOnlyDescription")}
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

/** The message of a settings-level error (a refused combination), wherever react-hook-form put it. */
function settingsFormError(e: unknown): string | undefined {
  const x = e as { message?: unknown; root?: { message?: unknown } } | undefined;
  const m = x?.message ?? x?.root?.message;
  return typeof m === "string" ? m : undefined;
}

function EnterpriseNote({ connected }: { connected?: boolean }) {
  const t = useT();
  return (
    <p
      className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400"
      data-testid="jira-licence"
    >
      <Sparkles className="mt-0.5 size-4 shrink-0" />
      <span>
        {t("projects2.jiraEnterpriseFeature")}{" "}
        {connected ? t("projects2.jiraConnectionPaused") : t("projects2.jiraInstallLicence")} (
        <Link href="/settings/license" className="underline underline-offset-2">
          {t("projects2.settingsLicence")}
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
  const t = useT();
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
      apiKey: "",
      labels: "feedback",
      autoCreate: "bugs",
      webhookSecret: "",
      settings: {},
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
          ...(m.board?.apiKey ? { apiKey: v.apiKey } : {}),
          ...(m.board ? { settings: cleanTrackerSettings(v.settings) } : {}),
          ...(m.pasteSecret && v.webhookSecret ? { webhookSecret: v.webhookSecret } : {}),
        },
      }).unwrap();
      toast.success(t("projects2.nameConnected", { name: m.name }));
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
              {t("projects2.enterprise")}
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
              {t("projects2.connectName", { name: m.name })}
            </Button>
          )}
        </CardTitle>
        <CardDescription>
          {m.board ? t(m.closes) : `${t("projects2.openIssueForEachItem", { name: m.name })} ${t(m.closes)}`}
        </CardDescription>
        {locked && <EnterpriseNote />}
      </CardHeader>
      {open && !locked && (
        <CardContent>
          <form noValidate className="grid gap-4" onSubmit={(e) => void submit(e)}>
            {m.url?.required && (
              <Field id={id("url")} label={t(m.url.label)} error={errors.apiUrl?.message}>
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
                label={t("projects2.accountEmail")}
                help={t("projects2.accountEmailHelp")}
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
            {m.board?.apiKey && (
              <Field
                id={id("apikey")}
                label={t("trackers.apiKey")}
                help={t("trackers.apiKeyHelp")}
                error={errors.apiKey?.message}
              >
                <Input
                  {...controlProps(id("apikey"), errors.apiKey?.message, true)}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-[13px]"
                  {...form.register("apiKey")}
                />
              </Field>
            )}
            <Field
              id={id("token")}
              label={t(m.tokenLabel)}
              help={t(m.tokenHelp)}
              error={errors.token?.message}
            >
              <Input
                {...controlProps(id("token"), errors.token?.message, true)}
                type="password"
                autoComplete="off"
                {...form.register("token")}
              />
            </Field>
            <Field
              id={id("repo")}
              label={t(m.repoLabel)}
              help={m.board ? t(m.board.repoHelp) : undefined}
              error={errors.repo?.message}
            >
              <Input
                {...controlProps(id("repo"), errors.repo?.message)}
                spellCheck={false}
                placeholder={m.repoPlaceholder}
                className="font-mono text-[13px]"
                {...form.register("repo")}
              />
            </Field>
            {m.board && (
              <fieldset className="grid gap-3 rounded-lg border p-3">
                <legend className="px-1 text-sm font-medium">{t("trackers.mappingTitle")}</legend>
                <p className="text-xs text-muted-foreground">{t(m.board.mappingHelp)}</p>
                {m.board.fields.map((key) => (
                  <Field key={key} id={id(`s-${key}`)} label={t(fieldLabel(key))}>
                    <Input
                      {...controlProps(id(`s-${key}`), undefined, m.board?.required !== key)}
                      spellCheck={false}
                      autoComplete="off"
                      placeholder={PRIORITY_PLACEHOLDER[provider]?.[key] ?? FIELD_PLACEHOLDER[key] ?? ""}
                      className="font-mono text-[13px]"
                      {...form.register(`settings.${key}`)}
                    />
                  </Field>
                ))}
                <FormError message={settingsFormError(errors.settings)} />
              </fieldset>
            )}
            {m.url && !m.url.required && (
              <Field
                id={id("url")}
                label={t(m.url.label)}
                help={t("projects2.optionalLeaveEmpty")}
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
              label={t("projects2.labels")}
              help={provider === "linear" ? t("projects2.linearLabelsHelp") : t("projects2.labelsHelp")}
              error={errors.labels?.message}
            >
              <Input
                {...controlProps(id("labels"), errors.labels?.message, true)}
                {...form.register("labels")}
              />
            </Field>
            <div className="grid gap-1.5">
              <p className="text-sm font-medium">{t("projects2.openIssuesFor")}</p>
              <Controller
                control={form.control}
                name="autoCreate"
                render={({ field }) => (
                  <Segmented
                    label={t("projects2.openNameIssuesFor", { name: m.name })}
                    value={field.value}
                    onChange={field.onChange}
                    options={autoOptions(t)}
                  />
                )}
              />
            </div>
            <FormError message={errors.root?.message} />
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t("projects2.cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? t("projects2.connecting") : t("projects2.connectName", { name: m.name })}
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
  const { t, tm } = useI18n();
  const m = META[i.provider];
  const [labels, setLabels] = useState(i.labels.join(", "));
  const [hook, setHook] = useState<{ secret: string | null; url: string } | null>(null);
  const [testResult, setTestResult] = useState<
    { ok: true; name: string } | { ok: false; message: string } | null
  >(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [updateTracker] = useUpdateTrackerMutation();
  const [testTracker, test] = useTestTrackerMutation();
  const [revealSecret, reveal] = useLazyTrackerWebhookSecretQuery();
  const [registerHook, registering] = useRegisterTrackerWebhookMutation();
  const [restartHandshake, restarting] = useRestartTrackerHandshakeMutation();
  const [deleteTracker, remove] = useDeleteTrackerMutation();
  const update = {
    mutate: ({ patch, message }: { patch: Record<string, unknown>; message: string }) => {
      updateTracker({ id: i.id, projectId: project.id, patch })
        .unwrap()
        .then(() => toast.success(message))
        .catch((e: unknown) => toast.error(t("projects2.notSaved"), { description: errorMessage(e) }));
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
        toast.success(t("projects2.nameDisconnected", { name: m.name }));
        setConfirmRemove(false);
      })
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };
  const p = i.provider;
  const register = () => {
    registerHook({ id: i.id, projectId: project.id })
      .unwrap()
      .then(() => toast.success(t("trackers.registered", { name: m.name })))
      .catch((e: unknown) => toast.error(t("projects2.notSaved"), { description: errorMessage(e) }));
  };
  const restart = () => {
    restartHandshake({ id: i.id, projectId: project.id })
      .unwrap()
      .then(() => toast.success(t("trackers.handshakeRestarted")))
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };

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
            {i.active && !unlicensed ? t("projects2.connected") : t("projects2.paused")}
          </Badge>
        </CardTitle>
        {unlicensed && <EnterpriseNote connected />}
        {i.lastError && (
          <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
            <CircleAlert className="mt-0.5 size-4 shrink-0" /> {t("projects2.lastError")} {i.lastError}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <SettingGroup>
          <SettingRow
            label={t("projects2.openIssuesFor")}
            description={t("projects2.openIssuesForDescription")}
          >
            <Segmented
              label={t("projects2.openNameIssuesFor", { name: m.name })}
              value={i.autoCreate}
              disabled={unlicensed}
              onChange={(autoCreate) =>
                update.mutate({
                  patch: { autoCreate },
                  message:
                    autoCreate === "manual"
                      ? t("projects2.issuesOpenedByHand")
                      : autoCreate === "all"
                        ? t("projects2.issuesOpenForEveryItem")
                        : t("projects2.issuesOpenForBugs"),
                })
              }
              options={autoOptions(t)}
            />
          </SettingRow>
          <SettingRow
            label={t("projects2.labels")}
            htmlFor={`${p}-labels-edit`}
            description={t("projects2.commaSeparated")}
          >
            <Input
              id={`${p}-labels-edit`}
              className="w-full sm:w-64"
              value={labels}
              disabled={unlicensed}
              onChange={(e) => setLabels(e.target.value)}
              onBlur={() => {
                const next = parseLabels(labels);
                if (next.join(",") !== i.labels.join(","))
                  update.mutate({ patch: { labels: next }, message: t("projects2.labelsSaved") });
              }}
            />
          </SettingRow>
          {p === "jira" && (
            <SettingRow
              label={t("projects2.site")}
              description={i.email ? t("projects2.signedInAs", { email: i.email }) : undefined}
            >
              <code className="font-mono text-xs break-all">{i.apiUrl}</code>
            </SettingRow>
          )}
          {m.board?.apiKey && i.apiKey && (
            <SettingRow label={t("trackers.apiKey")}>
              <code className="font-mono text-xs break-all">{i.apiKey}</code>
            </SettingRow>
          )}
          <SettingRow
            label={t(m.tokenLabel)}
            htmlFor={`${p}-token-edit`}
            description={t("projects2.tokenSavedDescription", { hint: i.tokenHint.replace("…", "") })}
          >
            <ReplaceToken
              id={`${p}-token-edit`}
              disabled={unlicensed}
              onReplace={(token) =>
                update.mutate({
                  patch: { token },
                  message: t("projects2.tokenReplaced", { label: t(m.tokenLabel) }),
                })
              }
            />
          </SettingRow>
          {m.board && (
            <MappingRows
              provider={p}
              fields={m.board.fields}
              required={m.board.required}
              settings={i.settings}
              help={t(m.board.mappingHelp)}
              disabled={unlicensed}
              onSave={(settings) =>
                update.mutate({ patch: { settings }, message: t("trackers.mappingSaved") })
              }
            />
          )}
          <SettingRow
            label={t("projects2.sync")}
            htmlFor={`${p}-active`}
            description={t("projects2.syncDescription")}
          >
            <Switch
              id={`${p}-active`}
              checked={i.active}
              disabled={unlicensed && !i.active}
              onCheckedChange={(active) =>
                update.mutate({
                  patch: { active },
                  message: active ? t("projects2.syncResumed") : t("projects2.syncPaused"),
                })
              }
            />
          </SettingRow>
          <SettingRow label={t("projects2.twoWayStatus")} description={m.hookHelp(t)} stack>
            <div className="grid gap-2">
              <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-2 pl-3">
                <span className="w-14 shrink-0 text-xs text-muted-foreground">{t("projects2.url")}</span>
                <code className="min-w-0 flex-1 font-mono text-xs break-all">{i.webhookUrl}</code>
                <CopyButton value={i.webhookUrl} label={t("projects2.copyUrl")} />
              </div>
              {m.pasteSecret ? (
                <PasteSecret
                  id={`${p}-secret-edit`}
                  disabled={unlicensed}
                  label={t(p === "trello" ? "trackers.appSecret" : "projects2.signingSecretFromLinear")}
                  placeholder={p === "trello" ? "" : "lin_wh_…"}
                  onSave={(webhookSecret) =>
                    update.mutate({ patch: { webhookSecret }, message: t("projects2.signingSecretSaved") })
                  }
                />
              ) : m.board && p !== "notion" ? null : hook?.secret ? (
                <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-2 pl-3">
                  <span className="w-14 shrink-0 text-xs text-muted-foreground">{t("projects2.secret")}</span>
                  <code
                    className="min-w-0 flex-1 font-mono text-xs break-all select-all"
                    data-testid="tracker-secret"
                  >
                    {hook.secret}
                  </code>
                  <CopyButton value={hook.secret} label={t("projects2.copySecret")} />
                </div>
              ) : m.board && (p !== "notion" || i.webhookPending) ? null : (
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-self-start"
                  disabled={reveal.isFetching}
                  onClick={showSecret}
                >
                  <Eye /> {t("projects2.revealWebhookSecret")}
                </Button>
              )}
              {m.board && (
                <div className="flex flex-wrap items-center gap-2">
                  {m.board.hook === "register" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={unlicensed || registering.isLoading || (p === "trello" && i.webhookPending)}
                      onClick={register}
                    >
                      {i.webhookRegistered ? <RefreshCw /> : <Webhook />}{" "}
                      {i.webhookRegistered ? t("trackers.registerAgain") : t("trackers.registerWebhook")}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={unlicensed || restarting.isLoading || i.webhookPending}
                      onClick={restart}
                    >
                      <RefreshCw /> {t("trackers.restartHandshake")}
                    </Button>
                  )}
                  <span
                    role="status"
                    data-testid="tracker-hook-status"
                    className={`flex items-center gap-1.5 text-sm ${i.webhookPending ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}`}
                  >
                    {i.webhookPending ? (
                      <CircleAlert className="size-4" />
                    ) : (
                      <CircleCheck className="size-4" />
                    )}
                    {i.webhookPending
                      ? t(p === "notion" ? "trackers.waitingToken" : "trackers.waitingSecret")
                      : m.board.hook === "register"
                        ? i.webhookRegistered
                          ? t("trackers.webhookRegistered")
                          : ""
                        : t("trackers.verified")}
                  </span>
                </div>
              )}
              {p === "trello" && i.webhookPending && (
                <p className="text-xs text-muted-foreground">{t("trackers.pasteSecretFirst")}</p>
              )}
            </div>
          </SettingRow>
        </SettingGroup>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
          <Button variant="outline" size="sm" disabled={test.isLoading || unlicensed} onClick={runTest}>
            <PlugZap /> {test.isLoading ? t("projects2.testing") : t("projects2.testConnection")}
          </Button>
          {testResult && (
            <span
              role="status"
              className={`flex items-center gap-1.5 text-sm ${testResult.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}
            >
              {testResult.ok ? <CircleCheck className="size-4" /> : <CircleAlert className="size-4" />}
              {testResult.ok ? t("projects2.canReach", { name: testResult.name }) : tm(testResult.message)}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-destructive hover:text-destructive"
            onClick={() => setConfirmRemove(true)}
          >
            <Trash2 /> {t("projects2.disconnect")}
          </Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={t("projects2.disconnectNameQuestion", { name: m.name })}
        description={t("projects2.disconnectDescription")}
        confirmLabel={t("projects2.disconnect")}
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
  const t = useT();
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
        placeholder={t("projects2.newToken")}
        disabled={disabled}
        aria-invalid={form.formState.errors.token ? true : undefined}
        {...form.register("token")}
      />
      <Button type="submit" variant="outline" size="default" disabled={!!disabled || token.trim().length < 8}>
        {t("projects2.replace")}
      </Button>
    </form>
  );
}

/** Linear's signing secret, pasted after creating the webhook there (core's issueIntegrationUpdate rule). */
const pasteSecretForm = z.object({
  secret: z
    .string()
    .trim()
    .min(16, "projects2.pasteWholeSigningSecret")
    .pipe(issueIntegrationUpdate.shape.webhookSecret.unwrap()),
});

function PasteSecret({
  id,
  onSave,
  disabled,
  label,
  placeholder,
}: {
  id: string;
  onSave: (secret: string) => void;
  disabled?: boolean;
  label: string;
  placeholder: string;
}) {
  const t = useT();
  const form = useZodForm(pasteSecretForm, { defaultValues: { secret: "" } });
  const secret = useWatch({ control: form.control, name: "secret" });
  const rawError = form.formState.errors.secret?.message;
  // The schema carries a catalogue key for its own message; the core rules' messages show as they are.
  const error = rawError && rawError in en ? t(rawError as Key) : rawError;
  const submit = form.handleSubmit((v) => {
    onSave(v.secret);
    form.reset({ secret: "" });
  });
  return (
    <form className="grid gap-1" noValidate onSubmit={(e) => void submit(e)}>
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      <div className="flex gap-2">
        <Input
          {...controlProps(id, error)}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          className="w-full font-mono text-xs sm:w-72"
          disabled={disabled}
          {...form.register("secret")}
        />
        <Button type="submit" variant="outline" disabled={!!disabled || !secret.trim()}>
          <KeyRound /> {t("projects2.save")}
        </Button>
      </div>
      <FormError message={error} />
    </form>
  );
}

/** The mapping of a board tracker (list, statuses, priorities): each field saves on blur, as one full settings object. */
function MappingRows({
  provider,
  fields,
  required,
  settings,
  help,
  disabled,
  onSave,
}: {
  provider: IssueProvider;
  fields: readonly string[];
  required?: string | undefined;
  settings: Record<string, string>;
  help: string;
  disabled?: boolean;
  onSave: (settings: Record<string, string>) => void;
}) {
  const t = useT();
  const [values, setValues] = useState<Record<string, string>>(settings);
  return (
    <SettingRow label={t("trackers.mappingTitle")} description={help} stack>
      <div className="grid gap-2 sm:grid-cols-2">
        {fields.map((key) => (
          <label
            key={key}
            className="grid gap-1 text-xs text-muted-foreground"
            htmlFor={`${provider}-s-${key}`}
          >
            {t(fieldLabel(key))}
            <Input
              id={`${provider}-s-${key}`}
              value={values[key] ?? ""}
              disabled={disabled}
              spellCheck={false}
              autoComplete="off"
              aria-required={required === key ? true : undefined}
              placeholder={PRIORITY_PLACEHOLDER[provider]?.[key] ?? FIELD_PLACEHOLDER[key] ?? ""}
              className="font-mono text-[13px] text-foreground"
              onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
              onBlur={() => {
                const next = cleanTrackerSettings(values);
                if (JSON.stringify(sorted(next)) !== JSON.stringify(sorted(settings))) onSave(next);
              }}
            />
          </label>
        ))}
      </div>
    </SettingRow>
  );
}

const sorted = (o: Record<string, string>) => Object.entries(o).sort(([a], [b]) => a.localeCompare(b));
