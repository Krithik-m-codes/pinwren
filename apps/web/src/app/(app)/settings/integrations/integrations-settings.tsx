"use client";

import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, WEBHOOK_EVENTS, WEBHOOK_KINDS } from "@pinwren/core";
import {
  ChevronRight,
  KeyRound,
  Lock,
  Plus,
  RotateCw,
  Send,
  Trash2,
  TriangleAlert,
  Webhook as WebhookIcon,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useTimeAgo } from "@/components/feedback-meta";
import { SecretDialog } from "@/components/secret-dialog";
import { SettingGroup, SettingRow } from "@/components/setting-row";
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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Controller, useWatch } from "react-hook-form";
import { z } from "zod";
import { controlProps, Field, FormError, useZodForm } from "@/components/form";
import type { Project, Webhook, WebhookDelivery, WebhookEvent, WebhookKind } from "@/lib/api";
import { webhookForm } from "@/lib/form-schemas";
import type { Key } from "@/lib/i18n/en";
import type { TFn } from "@/lib/i18n/english";
import { useI18n, useT } from "@/lib/i18n/provider";
import {
  errorMessage,
  isForbidden,
  useCreateWebhookMutation,
  useDeleteWebhookMutation,
  useDeliveriesQuery,
  useProjectsQuery,
  useRedeliverMutation,
  useRotateWebhookSecretMutation,
  useTestWebhookMutation,
  useUpdateWebhookMutation,
  useWebhookQuery,
  useWebhooksQuery,
} from "@/lib/store/api";
import type { WebhookPatch } from "@/lib/store/api/admin";
import { cn } from "@/lib/utils";
import { here } from "@/lib/routes";

const EVENT_LABELS: Record<WebhookEvent, Key> = {
  "feedback.created": "settings1.eventFeedbackCreated",
  "feedback.updated": "settings1.eventFeedbackUpdated",
  "feedback.status_changed": "settings1.eventStatusChanged",
  "feedback.assigned": "settings1.eventAssigned",
  "feedback.priority_changed": "settings1.eventPriorityChanged",
  "feedback.labels_changed": "settings1.eventLabelsChanged",
  "feedback.deleted": "settings1.eventFeedbackDeleted",
  "comment.created": "settings1.eventCommentCreated",
  "comment.updated": "settings1.eventCommentUpdated",
  "comment.deleted": "settings1.eventCommentDeleted",
};
const KIND_LABELS: Record<WebhookKind, Key> = {
  generic: "settings1.kindWebhook",
  slack: "settings1.kindSlack",
  discord: "settings1.kindDiscord",
  teams: "settings1.kindTeams",
  telegram: "settings1.kindTelegram",
  ntfy: "settings1.kindNtfy",
};
const KIND_OPTIONS: Record<WebhookKind, Key> = { ...KIND_LABELS, generic: "settings1.kindWebhookSigned" };
const URL_HINT: Record<Exclude<WebhookKind, "telegram">, string> = {
  generic: "https://example.com/hooks/pinwren",
  slack: "https://hooks.slack.com/services/…",
  discord: "https://discord.com/api/webhooks/…",
  teams: "https://….logic.azure.com/workflows/…",
  ntfy: "https://ntfy.sh/my-team-bugs",
};
/** Where to find the URL (or the credentials) for each kind. */
function kindHelp(kind: WebhookKind, t: TFn): React.ReactNode {
  switch (kind) {
    case "generic":
      return t("settings1.helpGeneric");
    case "slack":
      return (
        <>
          {t("settings1.helpSlackBefore")}
          <b>{t("settings1.helpSlackPath")}</b>
          {t("settings1.helpSlackAfter")}
        </>
      );
    case "discord":
      return (
        <>
          {t("settings1.helpDiscordBefore")}
          <b>{t("settings1.helpDiscordPath")}</b>
          {t("settings1.helpDiscordMiddle")}
          <b>{t("settings1.helpDiscordCopy")}</b>
          {t("settings1.helpDiscordAfter")}
        </>
      );
    case "teams":
      return (
        <>
          {t("settings1.helpTeamsBefore")}
          <b>{t("settings1.helpTeamsWorkflows")}</b>
          {t("settings1.helpTeamsMiddle")}
          <b>{t("settings1.helpTeamsPost")}</b>
          {t("settings1.helpTeamsAfter")}
        </>
      );
    case "telegram":
      return (
        <>
          {t("settings1.helpTelegramBefore")}
          <b>{t("settings1.helpTelegramBot")}</b>
          {t("settings1.helpTelegramAfter")}
        </>
      );
    case "ntfy":
      return t("settings1.helpNtfy");
  }
}
const usesUrl = (kind: WebhookKind) => kind !== "telegram";

const SECRET_HELP: Key = "settings1.secretHelp";

export function IntegrationsSettings() {
  const { t, tn } = useI18n();
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [creating, setCreating] = useState(false);
  // A new endpoint's secret is shown first; its detail sheet opens once the secret is dismissed.
  const [created, setCreated] = useState<{ id: string; secret: string } | null>(null);
  const hooks = useWebhooksQuery(undefined);
  const projects = useProjectsQuery(undefined);
  const openId = search.get("webhook");
  const open = (id: string | null) =>
    router.replace(here(pathname, id ? `webhook=${id}` : undefined), { scroll: false });
  const projectName = (id: string | null) =>
    id
      ? (projects.data?.projects.find((p) => p.id === id)?.name ?? t("settings1.oneProject"))
      : t("settings1.allProjects");

  if (isForbidden(hooks.error)) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={Lock}
            title={t("settings1.integrationsManagedByAdmins")}
            description={t("settings1.integrationsManagedByAdminsDescription")}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings1.webhooks")}</CardTitle>
        <CardDescription>{t("settings1.webhooksDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex justify-end">
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> {t("settings1.addWebhook")}
          </Button>
        </div>
        {hooks.isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        )}
        {hooks.isError && <ErrorState error={hooks.error} retry={() => void hooks.refetch()} />}
        {hooks.data?.webhooks.length === 0 && (
          <EmptyState
            icon={WebhookIcon}
            title={t("settings1.noWebhooksYet")}
            description={t("settings1.noWebhooksYetDescription")}
            action={
              <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
                <Plus /> {t("settings1.addWebhook")}
              </Button>
            }
          />
        )}
        {hooks.data && hooks.data.webhooks.length > 0 && (
          <ul className="divide-y rounded-lg border" aria-label={t("settings1.webhooks")}>
            {hooks.data.webhooks.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => open(w.id)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none"
                >
                  <span
                    title={
                      !w.active
                        ? t("settings1.disabled")
                        : w.failingSince
                          ? t("settings1.failing")
                          : t("settings1.active")
                    }
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      !w.active ? "bg-muted-foreground/40" : w.failingSince ? "bg-red-500" : "bg-emerald-500",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{w.name || t(KIND_LABELS[w.kind])}</span>
                      <Badge variant="secondary" className="font-normal">
                        {t(KIND_LABELS[w.kind])}
                      </Badge>
                      {!w.active && <Badge variant="outline">{t("settings1.disabled")}</Badge>}
                      {w.active && w.failingSince && (
                        <Badge variant="destructive">{t("settings1.failing")}</Badge>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">
                      {w.url}
                      {w.chatId && ` → ${w.chatId}`}
                    </span>
                  </span>
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                    {tn("settings1.eventCount", w.events.length)} · {projectName(w.projectId)}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <CreateWebhookDialog
        open={creating}
        onOpenChange={setCreating}
        projects={projects.data?.projects ?? []}
        onCreated={(w, s) => {
          setCreating(false);
          if (s) setCreated({ id: w.id, secret: s });
          else open(w.id);
        }}
      />
      <Sheet open={!!openId} onOpenChange={(o) => !o && open(null)}>
        <SheetContent
          side="right"
          className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
        >
          {openId && (
            <WebhookDetail
              id={openId}
              projects={projects.data?.projects ?? []}
              onDeleted={() => open(null)}
            />
          )}
        </SheetContent>
      </Sheet>
      <SecretDialog
        secret={created?.secret ?? null}
        title={t("settings1.signingSecret")}
        description={t(SECRET_HELP)}
        onClose={() => {
          const id = created?.id;
          setCreated(null);
          if (id) open(id);
        }}
      />
    </Card>
  );
}

function EventPicker({ value, onChange }: { value: WebhookEvent[]; onChange: (v: WebhookEvent[]) => void }) {
  const t = useT();
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">{t("settings1.events")}</legend>
      {WEBHOOK_EVENTS.map((e) => (
        <div key={e} className="flex items-center gap-2.5 text-sm">
          <Checkbox
            id={`event-${e}`}
            checked={value.includes(e)}
            onCheckedChange={(on) => onChange(on ? [...value, e] : value.filter((x) => x !== e))}
          />
          <label htmlFor={`event-${e}`}>{t(EVENT_LABELS[e])}</label>
          <code className="ml-auto font-mono text-[11px] text-muted-foreground">{e}</code>
        </div>
      ))}
    </fieldset>
  );
}

function ProjectScope({
  value,
  onChange,
  projects,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  projects: Project[];
}) {
  const t = useT();
  const items = [
    { value: "all", label: t("settings1.allProjects") },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];
  return (
    <Select items={items} value={value ?? "all"} onValueChange={(v) => v && onChange(v === "all" ? null : v)}>
      <SelectTrigger className="w-full" aria-label={t("settings1.projects")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CreateWebhookDialog({
  open,
  onOpenChange,
  projects,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projects: Project[];
  onCreated: (w: Webhook, secret: string | null) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && (
          <CreateWebhookForm projects={projects} onCreated={onCreated} onCancel={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateWebhookForm({
  projects,
  onCreated,
  onCancel,
}: {
  projects: Project[];
  onCreated: (w: Webhook, secret: string | null) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [create] = useCreateWebhookMutation();
  const form = useZodForm(webhookForm, {
    defaultValues: {
      kind: "generic",
      name: "",
      url: "",
      events: ["feedback.created", "comment.created"],
      projectId: "all",
      botToken: "",
      chatId: "",
      accessToken: "",
    },
  });
  const { errors, isSubmitting } = form.formState;
  const kind = useWatch({ control: form.control, name: "kind" });
  const submit = form.handleSubmit(async (v) => {
    try {
      const { webhook, secret } = await create({
        kind: v.kind,
        events: v.events,
        projectId: v.projectId === "all" ? null : v.projectId,
        ...(v.name ? { name: v.name } : {}),
        ...(v.kind === "telegram" ? { botToken: v.botToken, chatId: v.chatId } : { url: v.url }),
        ...(v.kind === "ntfy" && v.accessToken ? { accessToken: v.accessToken } : {}),
      }).unwrap();
      toast.success(t("settings1.webhookAdded"));
      onCreated(webhook, secret);
    } catch (e) {
      form.setError("root", { message: errorMessage(e) });
    }
  });

  return (
    <form className="grid gap-4" noValidate onSubmit={(e) => void submit(e)}>
      <DialogHeader>
        <DialogTitle>{t("settings1.addAWebhook")}</DialogTitle>
        <DialogDescription>{t("settings1.addAWebhookDescription")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="wh-kind">{t("settings1.type")}</Label>
        <Controller
          control={form.control}
          name="kind"
          render={({ field }) => (
            <Select
              items={WEBHOOK_KINDS.map((k) => ({ value: k, label: t(KIND_OPTIONS[k]) }))}
              value={field.value}
              onValueChange={(v) => v && field.onChange(v)}
            >
              <SelectTrigger id="wh-kind" className="w-full" aria-label={t("settings1.type")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEBHOOK_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(KIND_OPTIONS[k])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        <p className="text-xs text-muted-foreground" data-testid="wh-kind-help">
          {kindHelp(kind, t)}
        </p>
      </div>
      {usesUrl(kind) ? (
        <Field
          id="wh-url"
          label={kind === "ntfy" ? t("settings1.topicUrl") : t("settings1.url")}
          error={errors.url?.message}
          help={kind !== "generic" ? t("settings1.urlCredentialHelp") : undefined}
        >
          <Input
            {...controlProps("wh-url", errors.url?.message, kind !== "generic")}
            {...form.register("url")}
            inputMode="url"
            spellCheck={false}
            placeholder={URL_HINT[kind]}
            className="font-mono text-xs"
          />
        </Field>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="wh-bot-token"
            label={t("settings1.botToken")}
            error={errors.botToken?.message}
            help={t("settings1.botTokenHelp")}
          >
            <Input
              {...controlProps("wh-bot-token", errors.botToken?.message, true)}
              {...form.register("botToken")}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="123456789:AA…"
              className="font-mono text-xs"
            />
          </Field>
          <Field id="wh-chat" label={t("settings1.chatId")} error={errors.chatId?.message}>
            <Input
              {...controlProps("wh-chat", errors.chatId?.message)}
              {...form.register("chatId")}
              spellCheck={false}
              placeholder={t("settings1.chatIdPlaceholder")}
              className="font-mono text-xs"
            />
          </Field>
        </div>
      )}
      {kind === "ntfy" && (
        <Field
          id="wh-ntfy-token"
          label={t("settings1.accessTokenOptional")}
          error={errors.accessToken?.message}
          help={t("settings1.accessTokenHelp")}
        >
          <Input
            {...controlProps("wh-ntfy-token", errors.accessToken?.message, true)}
            {...form.register("accessToken")}
            type="password"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
      )}
      <Field id="wh-name" label={t("settings1.nameOptional")} error={errors.name?.message}>
        <Input
          {...controlProps("wh-name", errors.name?.message)}
          {...form.register("name")}
          maxLength={80}
          placeholder="#design-feedback"
        />
      </Field>
      <div className="grid gap-2">
        <Label>{t("settings1.projects")}</Label>
        <Controller
          control={form.control}
          name="projectId"
          render={({ field }) => (
            <ProjectScope
              value={field.value === "all" ? null : field.value}
              onChange={(v) => field.onChange(v ?? "all")}
              projects={projects}
            />
          )}
        />
      </div>
      <Controller
        control={form.control}
        name="events"
        render={({ field }) => <EventPicker value={field.value} onChange={field.onChange} />}
      />
      <FormError message={errors.events?.message ?? errors.root?.message} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("settings1.cancel")}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t("settings1.adding") : t("settings1.addWebhook")}
        </Button>
      </DialogFooter>
    </form>
  );
}

function WebhookDetail({
  id,
  projects,
  onDeleted,
}: {
  id: string;
  projects: Project[];
  onDeleted: () => void;
}) {
  const t = useT();
  const timeAgo = useTimeAgo();
  const [confirm, setConfirm] = useState<"delete" | "rotate" | null>(null);
  const [rotated, setRotated] = useState<string | null>(null);
  const hook = useWebhookQuery(id);
  const deliveries = useDeliveriesQuery(id, { pollingInterval: 5000, skipPollingIfUnfocused: true });
  const [updateWebhook] = useUpdateWebhookMutation();
  const [testWebhook, test] = useTestWebhookMutation();
  const [rotateSecret, rotate] = useRotateWebhookSecretMutation();
  const [deleteWebhook, remove] = useDeleteWebhookMutation();
  const patch = (body: WebhookPatch) => {
    updateWebhook({ id, patch: body })
      .unwrap()
      .then(() => toast.success(t("settings1.webhookSaved"), { id: `wh-${id}` }))
      .catch((e: unknown) => toast.error(t("settings1.notSaved"), { description: errorMessage(e) }));
  };
  const sendTest = () => {
    testWebhook(id)
      .unwrap()
      .then(({ delivery }) => {
        if (delivery.status === "success")
          toast.success(
            t("settings1.testDelivered", { status: delivery.responseCode ?? t("settings1.noStatus") }),
          );
        else
          toast.error(t("settings1.testFailed"), {
            description:
              delivery.error ??
              t("settings1.httpStatus", { status: delivery.responseCode ?? t("settings1.error") }),
          });
      })
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };
  const rotateNow = () => {
    rotateSecret(id)
      .unwrap()
      .then(({ secret }) => {
        setConfirm(null);
        setRotated(secret);
      })
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };
  const removeNow = () => {
    deleteWebhook(id)
      .unwrap()
      .then(() => {
        setConfirm(null);
        toast.success(t("settings1.webhookDeleted"));
        onDeleted();
      })
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };

  if (hook.isLoading) {
    return (
      <div className="space-y-3 p-5">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-32" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  if (!hook.data) return <ErrorState error={hook.error} retry={() => void hook.refetch()} />;
  const w = hook.data.webhook;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <SheetHeader className="border-b p-5 pr-12">
        <SheetTitle className="flex items-center gap-2">
          {w.name || t(KIND_LABELS[w.kind])}
          <Badge variant="secondary" className="font-normal">
            {t(KIND_LABELS[w.kind])}
          </Badge>
        </SheetTitle>
        <SheetDescription className="font-mono text-xs break-all">
          {w.url}
          {w.chatId && t("settings1.arrowChat", { id: w.chatId })}
        </SheetDescription>
      </SheetHeader>
      <div className="grid gap-6 p-5">
        {w.failingSince && (
          <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-400">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {t("settings1.failingSince", { time: timeAgo(w.failingSince) })}
          </p>
        )}
        <SettingGroup>
          <SettingRow
            label={t("settings1.active")}
            htmlFor="wh-active"
            description={t("settings1.activeDescription")}
          >
            <Switch id="wh-active" checked={w.active} onCheckedChange={(active) => patch({ active })} />
          </SettingRow>
          <SettingRow label={t("settings1.projects")} stack>
            <ProjectScope
              value={w.projectId}
              onChange={(projectId) => patch({ projectId })}
              projects={projects}
            />
          </SettingRow>
          <ConnectionRows webhook={w} onPatch={patch} />
        </SettingGroup>
        <EventPicker
          value={w.events}
          onChange={(events) =>
            events.length ? patch({ events }) : toast.error(t("settings1.keepOneEvent"))
          }
        />
        <div className="flex flex-wrap gap-2">
          <Button onClick={sendTest} disabled={test.isLoading || !w.active}>
            <Send /> {test.isLoading ? t("settings1.sending") : t("settings1.sendTestEvent")}
          </Button>
          {w.hasSecret && (
            <Button variant="outline" onClick={() => setConfirm("rotate")}>
              <KeyRound /> {t("settings1.rotateSecret")}
            </Button>
          )}
          <Button
            variant="ghost"
            className="ml-auto text-destructive hover:text-destructive"
            onClick={() => setConfirm("delete")}
          >
            <Trash2 /> {t("settings1.delete")}
          </Button>
        </div>
        <section aria-label={t("settings1.deliveryLog")}>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            {t("settings1.recentDeliveries")}
            {deliveries.isFetching && <RotateCw className="size-3 animate-spin text-muted-foreground" />}
          </h3>
          {deliveries.isLoading && <Skeleton className="h-24" />}
          {deliveries.isError && (
            <ErrorState error={deliveries.error} retry={() => void deliveries.refetch()} />
          )}
          {deliveries.data?.deliveries.length === 0 && (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              {t("settings1.nothingSentYet")}
            </p>
          )}
          {deliveries.data && deliveries.data.deliveries.length > 0 && (
            <ul className="divide-y rounded-lg border" data-testid="deliveries">
              {deliveries.data.deliveries.map((d) => (
                <DeliveryRow key={d.id} delivery={d} webhookId={id} disabled={!w.active} />
              ))}
            </ul>
          )}
        </section>
      </div>
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(o) => setConfirm(o ? "delete" : null)}
        title={t("settings1.deleteWebhookTitle")}
        description={t("settings1.deleteWebhookDescription")}
        pending={remove.isLoading}
        onConfirm={removeNow}
      />
      <ConfirmDialog
        open={confirm === "rotate"}
        onOpenChange={(o) => setConfirm(o ? "rotate" : null)}
        title={t("settings1.rotateSecretTitle")}
        description={t("settings1.rotateSecretDescription")}
        confirmLabel={t("settings1.rotate")}
        pending={rotate.isLoading}
        onConfirm={rotateNow}
      />
      <SecretDialog
        secret={rotated}
        title={t("settings1.newSigningSecret")}
        description={t(SECRET_HELP)}
        onClose={() => setRotated(null)}
      />
    </div>
  );
}

const urlRule = z
  .string()
  .trim()
  .min(1, "settings1.enterTheUrl")
  .pipe(z.url({ protocol: /^https?$/, error: "settings1.useHttpUrl" }).max(2000));

/**
 * Replace a webhook's credentials without re-creating it: the URL (chat webhooks are write-only, so the
 * field starts empty), Telegram's bot token or chat, or ntfy's access token.
 */
function ConnectionRows({ webhook: w, onPatch }: { webhook: Webhook; onPatch: (p: WebhookPatch) => void }) {
  const t = useT();
  if (w.kind === "telegram") {
    return (
      <>
        <SettingRow
          label={t("settings1.chat")}
          htmlFor="wh-edit-chat"
          description={t("settings1.chatDescription")}
        >
          <ReplaceValue
            id="wh-edit-chat"
            placeholder={w.chatId ?? "-1001234567890"}
            rule={z.string().trim().regex(TELEGRAM_CHAT_ID, "settings1.chatIdRule")}
            label={t("settings1.move")}
            onSave={(chatId) => onPatch({ chatId })}
          />
        </SettingRow>
        <SettingRow
          label={t("settings1.botToken")}
          htmlFor="wh-edit-bot"
          description={t("settings1.botTokenReplaceDescription")}
        >
          <ReplaceValue
            id="wh-edit-bot"
            secret
            placeholder={t("settings1.newBotToken")}
            rule={z.string().trim().regex(TELEGRAM_BOT_TOKEN, "settings1.botTokenRule")}
            onSave={(botToken) => onPatch({ botToken })}
          />
        </SettingRow>
      </>
    );
  }
  return (
    <>
      <SettingRow
        label={w.kind === "ntfy" ? t("settings1.topicUrl") : t("settings1.url")}
        htmlFor="wh-edit-url"
        description={
          w.kind === "generic" ? t("settings1.urlGenericDescription") : t("settings1.urlReplaceDescription")
        }
        stack
      >
        <ReplaceValue
          id="wh-edit-url"
          placeholder={w.kind === "generic" ? w.url : URL_HINT[w.kind]}
          rule={urlRule}
          onSave={(url) => onPatch({ url })}
          wide
        />
      </SettingRow>
      {w.kind === "ntfy" && (
        <SettingRow
          label={t("settings1.accessToken")}
          htmlFor="wh-edit-ntfy"
          description={
            w.hasSecret ? t("settings1.accessTokenSetDescription") : t("settings1.accessTokenNoneDescription")
          }
        >
          <div className="flex flex-wrap gap-2">
            <ReplaceValue
              id="wh-edit-ntfy"
              secret
              placeholder={t("settings1.accessTokenPlaceholder")}
              rule={z.string().trim().min(4, "settings1.tokenTooShort").max(200)}
              onSave={(accessToken) => onPatch({ accessToken })}
            />
            {w.hasSecret && (
              <Button variant="ghost" onClick={() => onPatch({ accessToken: null })}>
                {t("settings1.remove")}
              </Button>
            )}
          </div>
        </SettingRow>
      )}
    </>
  );
}

function ReplaceValue({
  id,
  placeholder,
  rule,
  onSave,
  secret,
  wide,
  label,
}: {
  id: string;
  placeholder: string;
  rule: z.ZodType<string, string>;
  onSave: (v: string) => void;
  secret?: boolean;
  wide?: boolean;
  label?: string;
}) {
  const t = useT();
  const form = useZodForm(z.object({ value: rule }), { defaultValues: { value: "" } });
  const value = useWatch({ control: form.control, name: "value" });
  const rawError = form.formState.errors.value?.message;
  const error = rawError ? t(rawError as Key) : rawError;
  const submit = form.handleSubmit((v) => {
    onSave(v.value);
    form.reset({ value: "" });
  });
  return (
    <form className="grid gap-1" noValidate onSubmit={(e) => void submit(e)}>
      <div className="flex gap-2">
        <Input
          {...controlProps(id, error)}
          {...form.register("value")}
          type={secret ? "password" : "text"}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          className={cn("font-mono text-xs", wide ? "w-full" : "w-full sm:w-52")}
        />
        <Button type="submit" variant="outline" disabled={!value.trim()}>
          {label ?? t("settings1.replace")}
        </Button>
      </div>
      <FormError message={error} />
    </form>
  );
}

const DELIVERY_STATUS: Record<WebhookDelivery["status"], Key> = {
  success: "settings1.deliverySuccess",
  pending: "settings1.deliveryPending",
  retrying: "settings1.deliveryRetrying",
  failed: "settings1.deliveryFailed",
};

const DELIVERY_TONE: Record<WebhookDelivery["status"], string> = {
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  pending: "bg-muted text-muted-foreground",
  retrying: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  failed: "bg-red-500/10 text-red-700 dark:text-red-400",
};

function DeliveryRow({
  delivery: d,
  webhookId,
  disabled,
}: {
  delivery: WebhookDelivery;
  webhookId: string;
  disabled: boolean;
}) {
  const t = useT();
  const timeAgo = useTimeAgo();
  const [open, setOpen] = useState(false);
  const [redeliverNow, redeliver] = useRedeliverMutation();
  const run = () => {
    redeliverNow({ deliveryId: d.id, webhookId })
      .unwrap()
      .then(({ delivery }) =>
        toast[delivery.status === "success" ? "success" : "error"](
          delivery.status === "success" ? t("settings1.redelivered") : t("settings1.redeliveryFailed"),
        ),
      )
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };
  return (
    <li data-delivery={d.event}>
      <div className="flex items-center gap-2 px-3 py-2 text-xs">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
          <span className={cn("rounded px-1.5 py-0.5 font-medium capitalize", DELIVERY_TONE[d.status])}>
            {t(DELIVERY_STATUS[d.status])}
          </span>
          <code className="truncate font-mono">{d.event}</code>
          <span className="shrink-0 text-muted-foreground tabular-nums">
            {d.responseCode ?? "—"}
            {d.durationMs !== null && ` · ${d.durationMs}ms`}
            {d.attempt > 1 && ` · ${t("settings1.tryN", { n: d.attempt })}`}
          </span>
          <span className="ml-auto shrink-0 text-muted-foreground">{timeAgo(d.createdAt)}</span>
        </button>
        <Button size="xs" variant="ghost" onClick={run} disabled={redeliver.isLoading || disabled}>
          <RotateCw /> {t("settings1.redeliver")}
        </Button>
      </div>
      {open && (
        <div className="space-y-1.5 border-t bg-muted/30 px-3 py-2 font-mono text-[11px]">
          <p className="text-muted-foreground">{t("settings1.deliveryId", { id: d.eventId })}</p>
          {d.error && <p className="text-destructive">{d.error}</p>}
          {d.nextRetryAt && (
            <p className="text-muted-foreground">
              {t("settings1.nextRetry", { time: timeAgo(d.nextRetryAt) })}
            </p>
          )}
          <pre className="max-h-40 overflow-auto break-all whitespace-pre-wrap">
            {d.responseBody || t("settings1.emptyResponse")}
          </pre>
        </div>
      )}
    </li>
  );
}
