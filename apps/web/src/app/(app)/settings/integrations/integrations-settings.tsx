"use client";

import { WEBHOOK_EVENTS } from "@annota/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Segmented } from "@/components/segmented";
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
import {
  api,
  isForbidden,
  type Project,
  qk,
  type Webhook,
  type WebhookDelivery,
  type WebhookEvent,
  type WebhookKind,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const EVENT_LABELS: Record<WebhookEvent, string> = {
  "feedback.created": "New feedback",
  "feedback.updated": "Feedback updated (any field)",
  "feedback.status_changed": "Status changed",
  "feedback.assigned": "Assignee changed",
  "comment.created": "New comment",
};
const KIND_LABELS: Record<WebhookKind, string> = { generic: "Webhook", slack: "Slack", discord: "Discord" };
const URL_HINT: Record<WebhookKind, string> = {
  generic: "https://example.com/hooks/annota",
  slack: "https://hooks.slack.com/services/…",
  discord: "https://discord.com/api/webhooks/…",
};

const webhooksKey = ["webhooks"] as const;
const SECRET_HELP =
  "Verify the Annota-Signature header with it: v1 = HMAC-SHA256(secret, timestamp + '.' + body).";
const deliveriesKey = (id: string) => ["webhooks", id, "deliveries"] as const;

export function IntegrationsSettings() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [creating, setCreating] = useState(false);
  // A new endpoint's secret is shown first; its detail sheet opens once the secret is dismissed.
  const [created, setCreated] = useState<{ id: string; secret: string } | null>(null);
  const hooks = useQuery({
    queryKey: webhooksKey,
    queryFn: () => api<{ webhooks: Webhook[] }>("/webhooks"),
    retry: (n, e) => !isForbidden(e) && n < 1,
  });
  const projects = useQuery({
    queryKey: qk.projects,
    queryFn: () => api<{ projects: Project[] }>("/projects"),
  });
  const openId = search.get("webhook");
  const open = (id: string | null) =>
    router.replace(id ? `${pathname}?webhook=${id}` : pathname, { scroll: false });
  const projectName = (id: string | null) =>
    id ? (projects.data?.projects.find((p) => p.id === id)?.name ?? "One project") : "All projects";

  if (isForbidden(hooks.error)) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={Lock}
            title="Integrations are managed by admins"
            description="Ask a workspace owner or admin to connect Slack, Discord or a webhook."
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
          Send events to Slack, Discord or your own endpoint. Deliveries are signed, retried for up to 3 days
          and logged.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex justify-end">
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> Add webhook
          </Button>
        </div>
        {hooks.isPending && (
          <div className="space-y-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        )}
        {hooks.isError && <ErrorState error={hooks.error} retry={() => hooks.refetch()} />}
        {hooks.data && hooks.data.webhooks.length === 0 && (
          <EmptyState
            icon={WebhookIcon}
            title="No webhooks yet"
            description="Post new feedback to a Slack channel, a Discord server or any HTTPS endpoint."
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
    <Select
      items={items}
      value={value ?? "all"}
      onValueChange={(v) => v && onChange(v === "all" ? null : String(v))}
    >
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
  const qc = useQueryClient();
  const [kind, setKind] = useState<WebhookKind>("generic");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>(["feedback.created", "comment.created"]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api<{ webhook: Webhook; secret: string | null }>("/webhooks", {
        method: "POST",
        json: { kind, url: url.trim(), events, projectId, ...(name.trim() ? { name: name.trim() } : {}) },
      }),
    onSuccess: ({ webhook, secret }) => {
      void qc.invalidateQueries({ queryKey: webhooksKey });
      toast.success("Webhook added");
      setName("");
      setUrl("");
      onCreated(webhook, secret);
    },
    onError: (e) => setError(e.message),
  });
  const validate = () => {
    try {
      const u = new URL(url.trim());
      if (u.protocol !== "https:" && u.protocol !== "http:") return "Use an http(s) URL";
    } catch {
      return "Enter the full URL, starting with https://";
    }
    if (!events.length) return "Pick at least one event";
    return null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const err = validate();
            setError(err);
            if (!err) create.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Add a webhook</DialogTitle>
            <DialogDescription>Annota posts each selected event to this URL.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label>Type</Label>
            <Segmented
              label="Type"
              value={kind}
              onChange={setKind}
              options={[
                { value: "generic", label: "Webhook (JSON)" },
                { value: "slack", label: "Slack" },
                { value: "discord", label: "Discord" },
              ]}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="wh-url">URL</Label>
            <Input
              id="wh-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={URL_HINT[kind]}
              className="font-mono text-xs"
              aria-invalid={!!error || undefined}
              autoFocus
            />
            {kind !== "generic" && (
              <p className="text-xs text-muted-foreground">
                The URL is a credential — it&apos;s stored encrypted and shown masked afterwards.
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="wh-name">Name (optional)</Label>
            <Input
              id="wh-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              placeholder="#design-feedback"
            />
          </div>
          <div className="grid gap-2">
            <Label>Projects</Label>
            <ProjectScope value={projectId} onChange={setProjectId} projects={projects} />
          </div>
          <EventPicker value={events} onChange={setEvents} />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Adding…" : "Add webhook"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<"delete" | "rotate" | null>(null);
  const [rotated, setRotated] = useState<string | null>(null);
  const hook = useQuery({
    queryKey: ["webhooks", id],
    queryFn: () => api<{ webhook: Webhook }>(`/webhooks/${id}`),
  });
  const deliveries = useQuery({
    queryKey: deliveriesKey(id),
    queryFn: () => api<{ deliveries: WebhookDelivery[] }>(`/webhooks/${id}/deliveries?limit=50`),
    refetchInterval: 5000,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: webhooksKey });
  };
  const patch = useMutation({
    mutationFn: (body: Partial<Pick<Webhook, "active" | "events" | "projectId" | "name">>) =>
      api<{ webhook: Webhook }>(`/webhooks/${id}`, { method: "PATCH", json: body }),
    onSuccess: ({ webhook }) => {
      qc.setQueryData(["webhooks", id], { webhook });
      refresh();
      toast.success("Webhook saved", { id: `wh-${id}` });
    },
    onError: (e) => toast.error("Not saved", { description: e.message }),
  });
  const test = useMutation({
    mutationFn: () => api<{ delivery: WebhookDelivery }>(`/webhooks/${id}/test`, { method: "POST" }),
    onSuccess: ({ delivery }) => {
      void qc.invalidateQueries({ queryKey: deliveriesKey(id) });
      if (delivery.status === "success") toast.success(`Test delivered · ${delivery.responseCode}`);
      else toast.error("Test failed", { description: delivery.error ?? `HTTP ${delivery.responseCode}` });
    },
    onError: (e) => toast.error(e.message),
  });
  const rotate = useMutation({
    mutationFn: () => api<{ secret: string }>(`/webhooks/${id}/rotate-secret`, { method: "POST" }),
    onSuccess: ({ secret }) => {
      setConfirm(null);
      setRotated(secret);
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => api(`/webhooks/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setConfirm(null);
      refresh();
      toast.success("Webhook deleted");
      onDeleted();
    },
    onError: (e) => toast.error(e.message),
  });

  if (hook.isPending) {
    return (
      <div className="space-y-3 p-5">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-32" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  if (hook.isError) return <ErrorState error={hook.error} retry={() => hook.refetch()} />;
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
        <SheetDescription className="font-mono text-xs break-all">{w.url}</SheetDescription>
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
            <Switch
              id="wh-active"
              checked={w.active}
              onCheckedChange={(active) => patch.mutate({ active })}
            />
          </SettingRow>
          <SettingRow label="Projects" stack>
            <ProjectScope
              value={w.projectId}
              onChange={(projectId) => patch.mutate({ projectId })}
              projects={projects}
            />
          </SettingRow>
        </SettingGroup>
        <EventPicker
          value={w.events}
          onChange={(events) =>
            events.length ? patch.mutate({ events }) : toast.error("Keep at least one event")
          }
        />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => test.mutate()} disabled={test.isPending || !w.active}>
            <Send /> {test.isPending ? "Sending…" : "Send test event"}
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
          {deliveries.isPending && <Skeleton className="h-24" />}
          {deliveries.isError && <ErrorState error={deliveries.error} retry={() => deliveries.refetch()} />}
          {deliveries.data && deliveries.data.deliveries.length === 0 && (
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
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
      <ConfirmDialog
        open={confirm === "rotate"}
        onOpenChange={(o) => setConfirm(o ? "rotate" : null)}
        title="Rotate the signing secret?"
        description="The old secret stops validating immediately. Update your receiver with the new one."
        confirmLabel="Rotate"
        pending={rotate.isPending}
        onConfirm={() => rotate.mutate()}
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
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const redeliver = useMutation({
    mutationFn: () =>
      api<{ delivery: WebhookDelivery }>(`/webhook-deliveries/${d.id}/redeliver`, { method: "POST" }),
    onSuccess: ({ delivery }) => {
      void qc.invalidateQueries({ queryKey: deliveriesKey(webhookId) });
      toast[delivery.status === "success" ? "success" : "error"](
        delivery.status === "success" ? "Redelivered" : "Redelivery failed",
      );
    },
    onError: (e) => toast.error(e.message),
  });
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
        <Button
          size="xs"
          variant="ghost"
          onClick={() => redeliver.mutate()}
          disabled={redeliver.isPending || disabled}
        >
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
