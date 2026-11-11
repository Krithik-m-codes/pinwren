"use client";

import {
  MAX_SLACK_ROUTES,
  SLACK_BOT_TOKEN,
  SLACK_CHANNEL_ID,
  SLACK_ROUTE_EVENTS,
  SLACK_SIGNING_SECRET,
  type SlackRouteEvent,
} from "@pinwren/core";
import { ExternalLink, Hash, Link2, Lock, Pencil, Plus, Send, Trash2, Unlink } from "lucide-react";
import { useState } from "react";
import { Controller } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ButtonLink } from "@/components/button-link";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton, copyText } from "@/components/copy-button";
import { controlProps, Field, FormError, useZodForm } from "@/components/form";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { Key } from "@/lib/i18n/en";
import { useI18n, useT } from "@/lib/i18n/provider";
import { errorMessage, isForbidden, useProjectsQuery } from "@/lib/store/api";
import {
  type SlackMember,
  type SlackRoute,
  type SlackState,
  useConnectSlackMutation,
  useCreateSlackRouteMutation,
  useDeleteSlackRouteMutation,
  useDisconnectSlackMutation,
  useSlackChannelsQuery,
  useSlackStateQuery,
  useSyncSlackMembersMutation,
  useTestSlackMutation,
  useUnlinkSlackUserMutation,
  useUpdateSlackRouteMutation,
} from "@/lib/store/api/slack";
import { cn } from "@/lib/utils";

// Validation messages are the English text: `tm()` finds the translation by that text (slack.err* keys).
const MSG = {
  signingSecret: "The signing secret is 32 letters and digits (Basic Information in your Slack app)",
  botToken: "A bot token starts with xoxb- (OAuth & Permissions in your Slack app)",
  channel: "Pick a channel or paste its id (C0123456789)",
  events: "Pick at least one event",
  signingSecretNeeded: "Enter the signing secret",
  botTokenNeeded: "Enter the bot token",
  nothingToChange: "Enter a new signing secret or bot token",
} as const;

// Settings › Integrations › Slack (F-071): the interactive Slack app. Workspace admins paste the app's
// signing secret and bot token, route events to channels per project, see who is mapped to a Pinwren member
// and test the connection. Credentials are write-only: the screen only ever shows the token's last four.

const EVENT_LABELS: Record<SlackRouteEvent, Key> = {
  "feedback.created": "settings1.eventFeedbackCreated",
  "feedback.status_changed": "settings1.eventStatusChanged",
  "feedback.assigned": "settings1.eventAssigned",
  "feedback.priority_changed": "settings1.eventPriorityChanged",
  "comment.created": "settings1.eventCommentCreated",
};

/** The two secrets, as typed: empty means "keep what is stored" when editing. */
const credentialsForm = z.object({
  signingSecret: z
    .string()
    .trim()
    .refine((v) => v === "" || SLACK_SIGNING_SECRET.test(v), MSG.signingSecret),
  botToken: z
    .string()
    .trim()
    .refine((v) => v === "" || SLACK_BOT_TOKEN.test(v), MSG.botToken),
});

const routeForm = z.object({
  projectId: z.string(),
  channelId: z.string().trim().regex(SLACK_CHANNEL_ID, MSG.channel),
  events: z.array(z.enum(SLACK_ROUTE_EVENTS)).min(1, MSG.events),
});

export function SlackSettings() {
  const t = useT();
  const state = useSlackStateQuery(undefined);
  // The webhooks card below already explains that integrations are for admins.
  if (isForbidden(state.error)) return null;
  const connection = state.data?.connection ?? null;
  return (
    <Card data-testid="slack-settings">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{t("slack.title")}</CardTitle>
          {connection && (
            <Badge variant={connection.active ? "secondary" : "outline"} className="font-normal">
              {connection.active ? connection.teamName : t("slack.paused")}
            </Badge>
          )}
        </div>
        <CardDescription>{t("slack.description")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        {state.isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        )}
        {state.isError && <ErrorState error={state.error} retry={() => void state.refetch()} />}
        {state.data && !connection && <SlackSetup state={state.data} />}
        {state.data && connection && <SlackConnected state={state.data} />}
      </CardContent>
    </Card>
  );
}

// --- Not connected ---------------------------------------------------------------------------------

function SlackSetup({ state }: { state: SlackState }) {
  const t = useT();
  return (
    <div className="grid gap-5">
      <ol className="grid gap-4 text-sm" aria-label={t("slack.setupSteps")}>
        <li className="grid gap-2">
          <p>
            <b>{t("slack.step1Title")}</b> {t("slack.step1Body")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void copyText(state.manifest, t("slack.manifestCopied"), t)}
            >
              {t("slack.copyManifest")}
            </Button>
            <ButtonLink external href="https://api.slack.com/apps?new_app=1" size="sm" variant="ghost">
              {t("slack.openSlackApps")} <ExternalLink />
            </ButtonLink>
          </div>
        </li>
        <li className="grid gap-2">
          <p>
            <b>{t("slack.step2Title")}</b> {t("slack.step2Body")}
          </p>
        </li>
        <li className="grid gap-2">
          <p>
            <b>{t("slack.step3Title")}</b> {t("slack.step3Body")}
          </p>
          <ConnectForm />
        </li>
      </ol>
      <RequestUrls state={state} />
    </div>
  );
}

function ConnectForm() {
  const t = useT();
  const [connect] = useConnectSlackMutation();
  const form = useZodForm(credentialsForm, { defaultValues: { signingSecret: "", botToken: "" } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (v) => {
    if (!v.signingSecret || !v.botToken) {
      if (!v.signingSecret) form.setError("signingSecret", { message: MSG.signingSecretNeeded });
      if (!v.botToken) form.setError("botToken", { message: MSG.botTokenNeeded });
      return;
    }
    try {
      const { connection } = await connect({ signingSecret: v.signingSecret, botToken: v.botToken }).unwrap();
      toast.success(t("slack.connected", { team: connection.teamName }));
      form.reset();
    } catch (e) {
      form.setError("root", { message: errorMessage(e) });
    }
  });
  return (
    <form className="grid gap-3 sm:max-w-lg" noValidate onSubmit={(e) => void submit(e)}>
      <Field
        id="slack-secret"
        label={t("slack.signingSecret")}
        error={errors.signingSecret?.message}
        help={t("slack.signingSecretHelp")}
      >
        <Input
          {...controlProps("slack-secret", errors.signingSecret?.message, true)}
          {...form.register("signingSecret")}
          type="password"
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-xs"
        />
      </Field>
      <Field
        id="slack-token"
        label={t("slack.botToken")}
        error={errors.botToken?.message}
        help={t("slack.botTokenHelp")}
      >
        <Input
          {...controlProps("slack-token", errors.botToken?.message, true)}
          {...form.register("botToken")}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="xoxb-…"
          className="font-mono text-xs"
        />
      </Field>
      <FormError message={errors.root?.message} />
      <div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t("slack.checking") : t("slack.connect")}
        </Button>
      </div>
    </form>
  );
}

function RequestUrls({ state }: { state: SlackState }) {
  const t = useT();
  const rows: { id: string; label: Key; value: string }[] = [
    { id: "interactivity", label: "slack.interactivityUrl", value: state.requestUrls.interactivity },
    { id: "commands", label: "slack.commandUrl", value: state.requestUrls.commands },
  ];
  return (
    <div className="grid gap-2 rounded-lg border p-3" data-testid="slack-urls">
      <p className="text-sm font-medium">{t("slack.requestUrls")}</p>
      <p className="text-xs text-muted-foreground">{t("slack.requestUrlsHelp")}</p>
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-2">
          <span className="w-36 shrink-0 text-xs text-muted-foreground">{t(r.label)}</span>
          <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs">
            {r.value}
          </code>
          <CopyButton value={r.value} label={t("slack.copyUrl")} />
        </div>
      ))}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">{t("slack.scopesSummary")}</summary>
        <ul className="mt-2 grid gap-1">
          {state.scopes.map((s) => (
            <li key={s.scope}>
              <code className="font-mono">{s.scope}</code>: {s.why}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

// --- Connected -------------------------------------------------------------------------------------

function SlackConnected({ state }: { state: SlackState }) {
  const t = useT();
  const connection = state.connection;
  const [test, { isLoading: testing }] = useTestSlackMutation();
  const [connect] = useConnectSlackMutation();
  const [disconnect, { isLoading: disconnecting }] = useDisconnectSlackMutation();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  if (!connection) return null;

  return (
    <div className="grid gap-6">
      {connection.lastError && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          data-testid="slack-error"
        >
          {connection.lastError}
        </p>
      )}

      <section className="grid gap-3" aria-labelledby="slack-connection">
        <h3 id="slack-connection" className="text-sm font-medium">
          {t("slack.connection")}
        </h3>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span>
            {t("slack.team")}: <b>{connection.teamName}</b>
          </span>
          <span className="text-muted-foreground">
            {t("slack.botTokenHint", { hint: connection.tokenHint })}
          </span>
          <label className="flex items-center gap-2">
            <Switch
              checked={connection.active}
              aria-label={t("slack.active")}
              onCheckedChange={(active) =>
                void connect({ active })
                  .unwrap()
                  .catch((e: unknown) => toast.error(errorMessage(e)))
              }
            />
            {t("slack.active")}
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={testing}
            onClick={() =>
              void test({})
                .unwrap()
                .then((r) => (r.ok ? toast.success(r.message) : toast.error(r.message)))
                .catch((e: unknown) => toast.error(errorMessage(e)))
            }
          >
            <Send /> {testing ? t("slack.testing") : t("slack.test")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil /> {t("slack.updateCredentials")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
            <Unlink /> {t("slack.disconnect")}
          </Button>
        </div>
      </section>

      <RoutesSection state={state} />
      <MappingSection members={state.members} />
      <RequestUrls state={state} />

      <CredentialsDialog open={editing} onOpenChange={setEditing} />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("slack.disconnectTitle")}
        description={t("slack.disconnectDescription")}
        confirmLabel={t("slack.disconnect")}
        pending={disconnecting}
        onConfirm={() =>
          void disconnect(undefined)
            .unwrap()
            .then(() => {
              setConfirming(false);
              toast.success(t("slack.disconnected"));
            })
            .catch((e: unknown) => toast.error(errorMessage(e)))
        }
      />
    </div>
  );
}

function CredentialsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const [connect] = useConnectSlackMutation();
  const form = useZodForm(credentialsForm, { defaultValues: { signingSecret: "", botToken: "" } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (v) => {
    if (!v.signingSecret && !v.botToken) {
      form.setError("root", { message: MSG.nothingToChange });
      return;
    }
    try {
      await connect({
        ...(v.signingSecret ? { signingSecret: v.signingSecret } : {}),
        ...(v.botToken ? { botToken: v.botToken } : {}),
      }).unwrap();
      toast.success(t("slack.credentialsUpdated"));
      form.reset();
      onOpenChange(false);
    } catch (e) {
      form.setError("root", { message: errorMessage(e) });
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form className="grid gap-4" noValidate onSubmit={(e) => void submit(e)}>
          <DialogHeader>
            <DialogTitle>{t("slack.updateCredentials")}</DialogTitle>
            <DialogDescription>{t("slack.updateCredentialsDescription")}</DialogDescription>
          </DialogHeader>
          <Field
            id="slack-edit-secret"
            label={t("slack.signingSecret")}
            error={errors.signingSecret?.message}
          >
            <Input
              {...controlProps("slack-edit-secret", errors.signingSecret?.message)}
              {...form.register("signingSecret")}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={t("slack.keepCurrent")}
              className="font-mono text-xs"
            />
          </Field>
          <Field id="slack-edit-token" label={t("slack.botToken")} error={errors.botToken?.message}>
            <Input
              {...controlProps("slack-edit-token", errors.botToken?.message)}
              {...form.register("botToken")}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={t("slack.keepCurrent")}
              className="font-mono text-xs"
            />
          </Field>
          <FormError message={errors.root?.message} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("slack.cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t("slack.checking") : t("slack.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Channel routing -------------------------------------------------------------------------------

function RoutesSection({ state }: { state: SlackState }) {
  const { t, tn } = useI18n();
  const projects = useProjectsQuery(undefined);
  const [remove] = useDeleteSlackRouteMutation();
  const [dialog, setDialog] = useState<{ route: SlackRoute | null } | null>(null);
  const projectName = (id: string | null) =>
    id
      ? (projects.data?.projects.find((p) => p.id === id)?.name ?? t("settings1.oneProject"))
      : t("settings1.allProjects");
  const full = state.routes.length >= MAX_SLACK_ROUTES;

  return (
    <section className="grid gap-3" aria-labelledby="slack-routes">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="slack-routes" className="text-sm font-medium">
            {t("slack.routing")}
          </h3>
          <p className="text-sm text-muted-foreground">{t("slack.routingDescription")}</p>
        </div>
        <Button size="sm" disabled={full} onClick={() => setDialog({ route: null })}>
          <Plus /> {t("slack.addRoute")}
        </Button>
      </div>
      {state.routes.length === 0 ? (
        <EmptyState
          icon={Hash}
          title={t("slack.noRoutes")}
          description={t("slack.noRoutesDescription")}
          className="rounded-lg border py-8"
        />
      ) : (
        <ul className="divide-y rounded-lg border" aria-label={t("slack.routing")}>
          {state.routes.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2.5" data-testid="slack-route">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {projectName(r.projectId)} <span className="text-muted-foreground">→</span> #
                  {r.channelName ?? r.channelId}
                </p>
                <p className="mt-0.5 flex flex-wrap gap-1">
                  {r.events.map((e) => (
                    <Badge key={e} variant="secondary" className="font-normal">
                      {t(EVENT_LABELS[e])}
                    </Badge>
                  ))}
                </p>
              </div>
              <span className="hidden text-xs text-muted-foreground sm:block">
                {tn("settings1.eventCount", r.events.length)}
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t("slack.editRoute")}
                onClick={() => setDialog({ route: r })}
              >
                <Pencil />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t("slack.deleteRoute")}
                onClick={() =>
                  void remove(r.id)
                    .unwrap()
                    .then(() => toast.success(t("slack.routeDeleted")))
                    .catch((e: unknown) => toast.error(errorMessage(e)))
                }
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <RouteDialog
        route={dialog?.route ?? null}
        open={dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        projects={projects.data?.projects ?? []}
      />
    </section>
  );
}

function RouteDialog({
  route,
  open,
  onOpenChange,
  projects,
}: {
  route: SlackRoute | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projects: { id: string; name: string }[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && <RouteForm route={route} projects={projects} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function RouteForm({
  route,
  projects,
  onDone,
}: {
  route: SlackRoute | null;
  projects: { id: string; name: string }[];
  onDone: () => void;
}) {
  const t = useT();
  const channels = useSlackChannelsQuery(undefined);
  const [create] = useCreateSlackRouteMutation();
  const [update] = useUpdateSlackRouteMutation();
  const form = useZodForm(routeForm, {
    defaultValues: {
      projectId: route?.projectId ?? "all",
      channelId: route?.channelId ?? "",
      events: route?.events ?? ["feedback.created"],
    },
  });
  const { errors, isSubmitting } = form.formState;
  const list = channels.data?.channels ?? [];
  const names = new Map(list.map((c) => [c.id, c.name]));
  const submit = form.handleSubmit(async (v) => {
    const body = {
      projectId: v.projectId === "all" ? null : v.projectId,
      channelId: v.channelId,
      channelName: names.get(v.channelId) ?? route?.channelName ?? null,
      events: v.events,
    };
    try {
      if (route) await update({ id: route.id, patch: body }).unwrap();
      else await create(body).unwrap();
      toast.success(t("slack.routeSaved"));
      onDone();
    } catch (e) {
      form.setError("root", { message: errorMessage(e) });
    }
  });
  const projectItems = [
    { value: "all", label: t("settings1.allProjects") },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];
  return (
    <form className="grid gap-4" noValidate onSubmit={(e) => void submit(e)}>
      <DialogHeader>
        <DialogTitle>{route ? t("slack.editRoute") : t("slack.addRoute")}</DialogTitle>
        <DialogDescription>{t("slack.routeDescription")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="slack-route-project">{t("settings1.projects")}</Label>
        <Controller
          control={form.control}
          name="projectId"
          render={({ field }) => (
            <Select items={projectItems} value={field.value} onValueChange={(v) => v && field.onChange(v)}>
              <SelectTrigger id="slack-route-project" className="w-full" aria-label={t("settings1.projects")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {projectItems.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>
      {list.length > 0 ? (
        <div className="grid gap-1.5">
          <Label htmlFor="slack-route-channel">{t("slack.channel")}</Label>
          <Controller
            control={form.control}
            name="channelId"
            render={({ field }) => {
              const items = list.map((c) => ({
                value: c.id,
                label: `${c.isPrivate ? "🔒 " : "#"}${c.name}`,
              }));
              // A saved route to a channel the list no longer shows still appears, by id.
              if (field.value && !names.has(field.value))
                items.unshift({ value: field.value, label: route?.channelName ?? field.value });
              return (
                <Select
                  items={items}
                  value={field.value || null}
                  onValueChange={(v) => v && field.onChange(v)}
                >
                  <SelectTrigger id="slack-route-channel" className="w-full" aria-label={t("slack.channel")}>
                    <SelectValue placeholder={t("slack.pickChannel")} />
                  </SelectTrigger>
                  <SelectContent>
                    {items.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              );
            }}
          />
          <p className="text-xs text-muted-foreground">{t("slack.channelInviteHelp")}</p>
          <FormError message={errors.channelId?.message} />
        </div>
      ) : (
        <Field
          id="slack-route-channel-id"
          label={t("slack.channelId")}
          error={errors.channelId?.message}
          help={
            channels.isLoading
              ? t("slack.loadingChannels")
              : (channels.data?.error ?? t("slack.channelIdHelp"))
          }
        >
          <Input
            {...controlProps("slack-route-channel-id", errors.channelId?.message, true)}
            {...form.register("channelId")}
            spellCheck={false}
            placeholder="C0123456789"
            className="font-mono text-xs"
          />
        </Field>
      )}
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t("settings1.events")}</legend>
        <Controller
          control={form.control}
          name="events"
          render={({ field }) => (
            <>
              {SLACK_ROUTE_EVENTS.map((e) => (
                <div key={e} className="flex items-center gap-2.5 text-sm">
                  <Checkbox
                    id={`slack-event-${e}`}
                    checked={field.value.includes(e)}
                    onCheckedChange={(on) =>
                      field.onChange(on ? [...field.value, e] : field.value.filter((x) => x !== e))
                    }
                  />
                  <label htmlFor={`slack-event-${e}`}>{t(EVENT_LABELS[e])}</label>
                </div>
              ))}
            </>
          )}
        />
        <FormError message={errors.events?.message} />
      </fieldset>
      <FormError message={errors.root?.message} />
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("slack.cancel")}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {t("slack.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}

// --- Member mapping --------------------------------------------------------------------------------

function MappingSection({ members }: { members: SlackMember[] }) {
  const { t, tn } = useI18n();
  const [sync, { isLoading: syncing }] = useSyncSlackMembersMutation();
  const [unlink] = useUnlinkSlackUserMutation();
  const linked = members.filter((m) => m.linked).length;
  return (
    <section className="grid gap-3" aria-labelledby="slack-mapping">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="slack-mapping" className="text-sm font-medium">
            {t("slack.mapping")}
          </h3>
          <p className="text-sm text-muted-foreground">{t("slack.mappingDescription")}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={syncing}
          onClick={() =>
            void sync(undefined)
              .unwrap()
              .then((r) => toast.success(tn("slack.synced", r.linked)))
              .catch((e: unknown) => toast.error(errorMessage(e)))
          }
        >
          <Link2 /> {syncing ? t("slack.syncing") : t("slack.sync")}
        </Button>
      </div>
      <p className="text-sm" data-testid="slack-mapped">
        {t("slack.mappedCount", { linked, total: members.length })}
      </p>
      <ul
        className="max-h-72 divide-y overflow-auto rounded-lg border"
        aria-label={t("slack.mapping")}
        data-testid="slack-members"
      >
        {members.map((m) => (
          <li key={m.userId} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{m.name}</p>
              <p className="truncate text-xs text-muted-foreground">{m.email}</p>
            </div>
            <Badge variant={m.linked ? "secondary" : "outline"} className={cn("font-normal")}>
              {m.linked
                ? m.source === "manual"
                  ? t("slack.linkedManual")
                  : t("slack.linkedEmail")
                : t("slack.notLinked")}
            </Badge>
            {m.linkId && (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t("slack.unlink", { name: m.name })}
                onClick={() =>
                  void unlink(m.linkId ?? "")
                    .unwrap()
                    .then(() => toast.success(t("slack.unlinked")))
                    .catch((e: unknown) => toast.error(errorMessage(e)))
                }
              >
                <Unlink />
              </Button>
            )}
          </li>
        ))}
      </ul>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Lock className="mt-0.5 size-3.5 shrink-0" /> {t("slack.mappingPrivacy")}
      </p>
    </section>
  );
}
