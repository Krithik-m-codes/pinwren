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
import { timeAgo } from "@/components/feedback-meta";
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

const EVENT_LABELS: Record<WebhookEvent, string> = {
  "feedback.created": "New feedback",
  "feedback.updated": "Feedback updated (any field)",
  "feedback.status_changed": "Status changed",
  "feedback.assigned": "Assignee changed",
  "feedback.priority_changed": "Priority changed",
  "feedback.labels_changed": "Labels changed",
  "feedback.deleted": "Feedback deleted",
  "comment.created": "New comment",
  "comment.updated": "Comment edited",
  "comment.deleted": "Comment deleted",
};
const KIND_LABELS: Record<WebhookKind, string> = {
  generic: "Webhook",
  slack: "Slack",
  discord: "Discord",
  teams: "Microsoft Teams",
  telegram: "Telegram",
  ntfy: "ntfy",
};
const KIND_OPTIONS: Record<WebhookKind, string> = { ...KIND_LABELS, generic: "Webhook (signed JSON)" };
const URL_HINT: Record<Exclude<WebhookKind, "telegram">, string> = {
  generic: "https://example.com/hooks/pinwren",
  slack: "https://hooks.slack.com/services/…",
  discord: "https://discord.com/api/webhooks/…",
  teams: "https://….logic.azure.com/workflows/…",
  ntfy: "https://ntfy.sh/my-team-bugs",
};
/** Where to find the URL (or the credentials) for each kind. */
const KIND_HELP: Record<WebhookKind, React.ReactNode> = {
  generic: "Pinwren signs each request; you get the signing secret next.",
  slack: (
    <>
      In Slack: <b>Apps › Incoming Webhooks</b>, add one for the channel and paste its URL.
    </>
  ),
  discord: (
    <>
      In Discord: <b>Channel settings › Integrations › Webhooks › New webhook</b>, then{" "}
      <b>Copy webhook URL</b>.
    </>
  ),
  teams: (
    <>
      In the Teams channel: <b>Workflows</b> › <b>Post to a channel when a webhook request is received</b>,
      then paste the URL the workflow shows.
    </>
  ),
  telegram: (
    <>
      Create a bot with <b>@BotFather</b>, add it to the group or channel, and use the chat&apos;s id (a group
      id starts with -100) or the channel&apos;s @name.
    </>
  ),
  ntfy: "The topic URL on ntfy.sh or your own server. Add an access token if the topic is protected.",
};
const usesUrl = (kind: WebhookKind) => kind !== "telegram";

const SECRET_HELP =
  "Verify the Pinwren-Signature header with it: v1 = HMAC-SHA256(secret, timestamp + '.' + body).";

export function IntegrationsSettings() {
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
    id ? (projects.data?.projects.find((p) => p.id === id)?.name ?? "One project") : "All projects";

  if (isForbidden(hooks.error)) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={Lock}
            title="Integrations are managed by admins"
            description="Ask a workspace Admin to connect Slack, Discord, Teams, Telegram, ntfy or a webhook."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Webhooks</CardTitle>
        <CardDescription>
          Send events to Slack, Discord, Microsoft Teams, Telegram, ntfy or your own endpoint. Deliveries are
          retried for up to 3 days and logged; generic webhooks are signed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex justify-end">
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> Add webhook
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
            title="No webhooks yet"
            description="Post new feedback to Slack, Discord, Teams, Telegram, ntfy or any HTTPS endpoint."
            action={
              <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
                <Plus /> Add webhook
              </Button>
            }
          />
        )}
        {hooks.data && hooks.data.webhooks.length > 0 && (
          <ul className="divide-y rounded-lg border" aria-label="Webhooks">
            {hooks.data.webhooks.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => open(w.id)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none"
                >
                  <span
                    title={!w.active ? "Disabled" : w.failingSince ? "Failing" : "Active"}
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      !w.active ? "bg-muted-foreground/40" : w.failingSince ? "bg-red-500" : "bg-emerald-500",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{w.name || KIND_LABELS[w.kind]}</span>
                      <Badge variant="secondary" className="font-normal">
                        {KIND_LABELS[w.kind]}
                      </Badge>
                      {!w.active && <Badge variant="outline">Disabled</Badge>}
                      {w.active && w.failingSince && <Badge variant="destructive">Failing</Badge>}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">
                      {w.url}
                      {w.chatId && ` → ${w.chatId}`}
                    </span>
                  </span>
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                    {w.events.length} event{w.events.length === 1 ? "" : "s"} · {projectName(w.projectId)}
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
        title="Signing secret"
        description={SECRET_HELP}
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
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">Events</legend>
      {WEBHOOK_EVENTS.map((e) => (
        <div key={e} className="flex items-center gap-2.5 text-sm">
          <Checkbox
            id={`event-${e}`}
            checked={value.includes(e)}
            onCheckedChange={(on) => onChange(on ? [...value, e] : value.filter((x) => x !== e))}
          />
          <label htmlFor={`event-${e}`}>{EVENT_LABELS[e]}</label>
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
  const items = [
    { value: "all", label: "All projects" },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];
  return (
    <Select items={items} value={value ?? "all"} onValueChange={(v) => v && onChange(v === "all" ? null : v)}>
      <SelectTrigger className="w-full" aria-label="Projects">
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
      toast.success("Webhook added");
      onCreated(webhook, secret);
    } catch (e) {
      form.setError("root", { message: errorMessage(e) });
    }
  });

  return (
    <form className="grid gap-4" noValidate onSubmit={(e) => void submit(e)}>
      <DialogHeader>
        <DialogTitle>Add a webhook</DialogTitle>
        <DialogDescription>Pinwren posts each selected event here.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="wh-kind">Type</Label>
        <Controller
          control={form.control}
          name="kind"
          render={({ field }) => (
            <Select
              items={WEBHOOK_KINDS.map((k) => ({ value: k, label: KIND_OPTIONS[k] }))}
              value={field.value}
              onValueChange={(v) => v && field.onChange(v)}
            >
              <SelectTrigger id="wh-kind" className="w-full" aria-label="Type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEBHOOK_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_OPTIONS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        <p className="text-xs text-muted-foreground" data-testid="wh-kind-help">
          {KIND_HELP[kind]}
        </p>
      </div>
      {usesUrl(kind) ? (
        <Field
          id="wh-url"
          label={kind === "ntfy" ? "Topic URL" : "URL"}
          error={errors.url?.message}
          help={
            kind !== "generic"
              ? "The URL is a credential — it's stored encrypted and shown masked afterwards."
              : undefined
          }
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
            label="Bot token"
            error={errors.botToken?.message}
            help="Stored encrypted, never shown again."
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
          <Field id="wh-chat" label="Chat id" error={errors.chatId?.message}>
            <Input
              {...controlProps("wh-chat", errors.chatId?.message)}
              {...form.register("chatId")}
              spellCheck={false}
              placeholder="-1001234567890 or @channel"
              className="font-mono text-xs"
            />
          </Field>
        </div>
      )}
      {kind === "ntfy" && (
        <Field
          id="wh-ntfy-token"
          label="Access token (optional)"
          error={errors.accessToken?.message}
          help="For protected topics: a tk_… token, or user:password. Stored encrypted."
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
      <Field id="wh-name" label="Name (optional)" error={errors.name?.message}>
        <Input
          {...controlProps("wh-name", errors.name?.message)}
          {...form.register("name")}
          maxLength={80}
          placeholder="#design-feedback"
        />
      </Field>
      <div className="grid gap-2">
        <Label>Projects</Label>
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
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Adding…" : "Add webhook"}
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
      .then(() => toast.success("Webhook saved", { id: `wh-${id}` }))
      .catch((e: unknown) => toast.error("Not saved", { description: errorMessage(e) }));
  };
  const sendTest = () => {
    testWebhook(id)
      .unwrap()
      .then(({ delivery }) => {
        if (delivery.status === "success")
          toast.success(`Test delivered · ${delivery.responseCode ?? "no status"}`);
        else
          toast.error("Test failed", {
            description: delivery.error ?? `HTTP ${delivery.responseCode ?? "error"}`,
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
        toast.success("Webhook deleted");
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
          {w.name || KIND_LABELS[w.kind]}
          <Badge variant="secondary" className="font-normal">
            {KIND_LABELS[w.kind]}
          </Badge>
        </SheetTitle>
        <SheetDescription className="font-mono text-xs break-all">
          {w.url}
          {w.chatId && ` → chat ${w.chatId}`}
        </SheetDescription>
      </SheetHeader>
      <div className="grid gap-6 p-5">
        {w.failingSince && (
          <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-400">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            Failing since {timeAgo(w.failingSince)}. It turns itself off after 3 days of failures.
          </p>
        )}
        <SettingGroup>
          <SettingRow label="Active" htmlFor="wh-active" description="Paused webhooks receive nothing.">
            <Switch id="wh-active" checked={w.active} onCheckedChange={(active) => patch({ active })} />
          </SettingRow>
          <SettingRow label="Projects" stack>
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
          onChange={(events) => (events.length ? patch({ events }) : toast.error("Keep at least one event"))}
        />
        <div className="flex flex-wrap gap-2">
          <Button onClick={sendTest} disabled={test.isLoading || !w.active}>
            <Send /> {test.isLoading ? "Sending…" : "Send test event"}
          </Button>
          {w.hasSecret && (
            <Button variant="outline" onClick={() => setConfirm("rotate")}>
              <KeyRound /> Rotate secret
            </Button>
          )}
          <Button
            variant="ghost"
            className="ml-auto text-destructive hover:text-destructive"
            onClick={() => setConfirm("delete")}
          >
            <Trash2 /> Delete
          </Button>
        </div>
        <section aria-label="Delivery log">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            Recent deliveries
            {deliveries.isFetching && <RotateCw className="size-3 animate-spin text-muted-foreground" />}
          </h3>
          {deliveries.isLoading && <Skeleton className="h-24" />}
          {deliveries.isError && (
            <ErrorState error={deliveries.error} retry={() => void deliveries.refetch()} />
          )}
          {deliveries.data?.deliveries.length === 0 && (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              Nothing sent yet. Send a test event to check the connection.
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
        title="Delete this webhook?"
        description="Deliveries stop at once and the log is removed."
        pending={remove.isLoading}
        onConfirm={removeNow}
      />
      <ConfirmDialog
        open={confirm === "rotate"}
        onOpenChange={(o) => setConfirm(o ? "rotate" : null)}
        title="Rotate the signing secret?"
        description="The old secret stops validating immediately. Update your receiver with the new one."
        confirmLabel="Rotate"
        pending={rotate.isLoading}
        onConfirm={rotateNow}
      />
      <SecretDialog
        secret={rotated}
        title="New signing secret"
        description={SECRET_HELP}
        onClose={() => setRotated(null)}
      />
    </div>
  );
}

const urlRule = z
  .string()
  .trim()
  .min(1, "Enter the URL")
  .pipe(z.url({ protocol: /^https?$/, error: "Use an http(s) URL" }).max(2000));

/**
 * Replace a webhook's credentials without re-creating it: the URL (chat webhooks are write-only, so the
 * field starts empty), Telegram's bot token or chat, or ntfy's access token.
 */
function ConnectionRows({ webhook: w, onPatch }: { webhook: Webhook; onPatch: (p: WebhookPatch) => void }) {
  if (w.kind === "telegram") {
    return (
      <>
        <SettingRow
          label="Chat"
          htmlFor="wh-edit-chat"
          description="The group, channel or chat the bot posts to."
        >
          <ReplaceValue
            id="wh-edit-chat"
            placeholder={w.chatId ?? "-1001234567890"}
            rule={z.string().trim().regex(TELEGRAM_CHAT_ID, "A numeric chat id or @channelname")}
            label="Move"
            onSave={(chatId) => onPatch({ chatId })}
          />
        </SettingRow>
        <SettingRow
          label="Bot token"
          htmlFor="wh-edit-bot"
          description="Saved and hidden. Paste a new one to replace it."
        >
          <ReplaceValue
            id="wh-edit-bot"
            secret
            placeholder="New bot token"
            rule={z.string().trim().regex(TELEGRAM_BOT_TOKEN, "A bot token looks like 123456789:AA…")}
            onSave={(botToken) => onPatch({ botToken })}
          />
        </SettingRow>
      </>
    );
  }
  return (
    <>
      <SettingRow
        label={w.kind === "ntfy" ? "Topic URL" : "URL"}
        htmlFor="wh-edit-url"
        description={
          w.kind === "generic"
            ? "Where events are posted."
            : "Saved encrypted. Paste a new URL to replace it."
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
          label="Access token"
          htmlFor="wh-edit-ntfy"
          description={w.hasSecret ? "Set. Paste a new one to replace it." : "None: the topic is public."}
        >
          <div className="flex flex-wrap gap-2">
            <ReplaceValue
              id="wh-edit-ntfy"
              secret
              placeholder="tk_… or user:password"
              rule={z.string().trim().min(4, "That token looks too short").max(200)}
              onSave={(accessToken) => onPatch({ accessToken })}
            />
            {w.hasSecret && (
              <Button variant="ghost" onClick={() => onPatch({ accessToken: null })}>
                Remove
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
  label = "Replace",
}: {
  id: string;
  placeholder: string;
  rule: z.ZodType<string, string>;
  onSave: (v: string) => void;
  secret?: boolean;
  wide?: boolean;
  label?: string;
}) {
  const form = useZodForm(z.object({ value: rule }), { defaultValues: { value: "" } });
  const value = useWatch({ control: form.control, name: "value" });
  const error = form.formState.errors.value?.message;
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
          {label}
        </Button>
      </div>
      <FormError message={error} />
    </form>
  );
}

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
  const [open, setOpen] = useState(false);
  const [redeliverNow, redeliver] = useRedeliverMutation();
  const run = () => {
    redeliverNow({ deliveryId: d.id, webhookId })
      .unwrap()
      .then(({ delivery }) =>
        toast[delivery.status === "success" ? "success" : "error"](
          delivery.status === "success" ? "Redelivered" : "Redelivery failed",
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
            {d.status}
          </span>
          <code className="truncate font-mono">{d.event}</code>
          <span className="shrink-0 text-muted-foreground tabular-nums">
            {d.responseCode ?? "—"}
            {d.durationMs !== null && ` · ${d.durationMs}ms`}
            {d.attempt > 1 && ` · try ${d.attempt}`}
          </span>
          <span className="ml-auto shrink-0 text-muted-foreground">{timeAgo(d.createdAt)}</span>
        </button>
        <Button size="xs" variant="ghost" onClick={run} disabled={redeliver.isLoading || disabled}>
          <RotateCw /> Redeliver
        </Button>
      </div>
      {open && (
        <div className="space-y-1.5 border-t bg-muted/30 px-3 py-2 font-mono text-[11px]">
          <p className="text-muted-foreground">Delivery {d.eventId}</p>
          {d.error && <p className="text-destructive">{d.error}</p>}
          {d.nextRetryAt && <p className="text-muted-foreground">Next retry {timeAgo(d.nextRetryAt)}</p>}
          <pre className="max-h-40 overflow-auto break-all whitespace-pre-wrap">
            {d.responseBody || "(empty response)"}
          </pre>
        </div>
      )}
    </li>
  );
}
