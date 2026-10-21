"use client";

import {
  MAX_PANEL_ACTIONS,
  PANEL_ACTION_ICONS,
  type PanelAction,
  panelAction,
  widgetConfig,
} from "@pinwren/core";
import { useMutation } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Eye, KeyRound, Pencil, Plus, RefreshCw, Trash2, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton } from "@/components/copy-button";
import { PANEL_ACTION_ICON_META, PanelActionIcon } from "@/components/panel-action-icon";
import { Segmented } from "@/components/segmented";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, type ProjectDetail } from "@/lib/api";
import { useMe } from "@/lib/feedback-hooks";
import { useProjectPatch } from "./use-project";

type Draft = {
  id: string;
  label: string;
  kind: PanelAction["kind"];
  url: string;
  icon: PanelAction["icon"];
  visibleTo: PanelAction["visibleTo"];
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "action";

function uniqueId(base: string, taken: string[]) {
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base.slice(0, 29)}-${n}`;
  return id;
}

/**
 * Panel actions (F-016): custom buttons on a feedback item — links that open a URL with the item's
 * details filled in, or webhooks Pinwren calls (signed) from the dashboard.
 */
export function ActionsTab({ project }: { project: ProjectDetail }) {
  const save = useProjectPatch(project.id);
  const { isAdmin } = useMe();
  const actions = project.widgetConfig.panelActions;
  const [editing, setEditing] = useState<{ index: number | null; draft: Draft } | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);

  const commit = (next: PanelAction[], message: string) =>
    save.mutate({ patch: { widgetConfig: { panelActions: next } }, message });

  const move = (i: number, by: -1 | 1) => {
    const next = [...actions];
    const [a] = next.splice(i, 1);
    if (!a) return;
    next.splice(i + by, 0, a);
    commit(next, "Order saved");
  };

  return (
    <div className="grid max-w-3xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Panel actions
            <span className="text-sm font-normal text-muted-foreground tabular-nums">
              {actions.length}/{MAX_PANEL_ACTIONS}
            </span>
            <Button
              size="sm"
              className="ml-auto"
              disabled={actions.length >= MAX_PANEL_ACTIONS}
              onClick={() =>
                setEditing({
                  index: null,
                  draft: { id: "", label: "", kind: "link", url: "", icon: null, visibleTo: "everyone" },
                })
              }
            >
              <Plus /> Add action
            </Button>
          </CardTitle>
          <CardDescription>
            Buttons on each item&apos;s detail: “Create Jira ticket”, “Open in Sentry”, “Send to agent”. Links
            can be shown in the widget too; webhooks run from the dashboard only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {actions.length === 0 ? (
            <EmptyState
              icon={Zap}
              title="No actions yet"
              description="Add a link with the item's number or page filled in, or a webhook your tools receive."
              className="py-8"
            />
          ) : (
            <ul className="divide-y rounded-lg border" aria-label="Panel actions">
              {actions.map((a, i) => (
                <li key={a.id} className="flex items-center gap-3 px-3 py-2.5" data-action={a.id}>
                  <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted">
                    <PanelActionIcon action={a} className="size-4 text-muted-foreground" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      {a.label}
                      <Badge variant="outline" className="font-normal">
                        {a.kind === "link" ? "Link" : "Webhook"}
                      </Badge>
                      <Badge variant="secondary" className="font-normal">
                        {a.visibleTo === "team" ? "Team only" : "Team + widget"}
                      </Badge>
                    </p>
                    <p className="truncate font-mono text-xs text-muted-foreground" title={a.url}>
                      {a.url}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move ${a.label} up`}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move ${a.label} down`}
                      disabled={i === actions.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit ${a.label}`}
                      onClick={() => setEditing({ index: i, draft: { ...a } })}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${a.label}`}
                      onClick={() => setRemoving(i)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 grid gap-1 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Placeholders for links</p>
            <p>
              <code className="font-mono">{"{id}"}</code> item id ·{" "}
              <code className="font-mono">{"{number}"}</code> item number ·{" "}
              <code className="font-mono">{"{url}"}</code> page address ·{" "}
              <code className="font-mono">{"{projectSlug}"}</code> this project ({project.slug}). Values are
              URL-encoded.
            </p>
          </div>
        </CardContent>
      </Card>

      {isAdmin && <SigningSecretCard project={project} />}

      {editing && (
        <ActionDialog
          initial={editing.draft}
          isNew={editing.index === null}
          takenIds={actions.filter((_, i) => i !== editing.index).map((a) => a.id)}
          onClose={() => setEditing(null)}
          onSave={(a) => {
            const next = [...actions];
            if (editing.index === null) next.push(a);
            else next[editing.index] = a;
            const parsed = widgetConfig.shape.panelActions.safeParse(next);
            if (!parsed.success) {
              toast.error(parsed.error.issues[0]?.message ?? "Invalid action");
              return;
            }
            commit(parsed.data, editing.index === null ? `“${a.label}” added` : `“${a.label}” saved`);
            setEditing(null);
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove “${removing !== null ? (actions[removing]?.label ?? "") : ""}”?`}
        description="The button disappears from the dashboard and the widget."
        confirmLabel="Remove"
        onConfirm={() => {
          if (removing === null) return;
          const a = actions[removing];
          commit(
            actions.filter((_, i) => i !== removing),
            `“${a?.label ?? "Action"}” removed`,
          );
          setRemoving(null);
        }}
      />
    </div>
  );
}

function ActionDialog({
  initial,
  isNew,
  takenIds,
  onClose,
  onSave,
}: {
  initial: Draft;
  isNew: boolean;
  takenIds: string[];
  onClose: () => void;
  onSave: (a: PanelAction) => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  function submit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const id = isNew ? uniqueId(slug(d.label), takenIds) : d.id;
    const parsed = panelAction.safeParse({ ...d, id, label: d.label.trim(), url: d.url.trim() });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0] ?? "url")] ??= issue.message;
      setErrors(next);
      return;
    }
    onSave(parsed.data);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{isNew ? "Add an action" : "Edit action"}</DialogTitle>
            <DialogDescription>Shown as a button on each item of this project.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <label htmlFor="action-label" className="text-sm font-medium">
              Label
            </label>
            <Input
              id="action-label"
              value={d.label}
              maxLength={40}
              placeholder="Create Jira ticket"
              aria-invalid={!!errors.label || undefined}
              onChange={(e) => set("label", e.target.value)}
            />
            {errors.label && <p className="text-xs text-destructive">{errors.label}</p>}
          </div>
          <div className="grid gap-1.5">
            <p className="text-sm font-medium">Type</p>
            <Segmented
              label="Action type"
              value={d.kind}
              onChange={(kind) =>
                setD((x) => ({ ...x, kind, visibleTo: kind === "webhook" ? "team" : x.visibleTo }))
              }
              options={[
                { value: "link", label: "Open a link" },
                { value: "webhook", label: "Call a webhook" },
              ]}
            />
            <p className="text-xs text-muted-foreground">
              {d.kind === "link"
                ? "Opens in a new tab with the placeholders filled in."
                : "Pinwren POSTs the item as JSON, signed with this project's secret, and shows the reply's “message”."}
            </p>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="action-url" className="text-sm font-medium">
              URL
            </label>
            <Input
              id="action-url"
              value={d.url}
              inputMode="url"
              spellCheck={false}
              className="font-mono text-[13px]"
              placeholder={
                d.kind === "link"
                  ? "https://jira.example.com/create?summary={number}"
                  : "https://hooks.example.com/pinwren"
              }
              aria-invalid={!!errors.url || undefined}
              onChange={(e) => set("url", e.target.value)}
            />
            {errors.url && <p className="text-xs text-destructive">{errors.url}</p>}
          </div>
          <div className="grid gap-1.5">
            <p className="text-sm font-medium">Icon</p>
            <Segmented
              label="Icon"
              value={d.icon ?? "none"}
              onChange={(v) => set("icon", v === "none" ? null : (v as PanelAction["icon"]))}
              options={[
                { value: "none", label: "Auto", title: "Automatic" },
                ...PANEL_ACTION_ICONS.map((k) => {
                  const Icon = PANEL_ACTION_ICON_META[k].icon;
                  return { value: k, title: PANEL_ACTION_ICON_META[k].label, label: <Icon /> };
                }),
              ]}
            />
          </div>
          <div className="grid gap-1.5">
            <p className="text-sm font-medium">Who sees it</p>
            <Segmented
              label="Who sees it"
              value={d.visibleTo}
              disabled={d.kind === "webhook"}
              onChange={(visibleTo) => set("visibleTo", visibleTo)}
              options={[
                { value: "everyone", label: "Team and widget" },
                { value: "team", label: "Team only" },
              ]}
            />
            {d.kind === "webhook" && (
              <p className="text-xs text-muted-foreground">Webhook actions run from the dashboard only.</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">{isNew ? "Add action" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Revealable, rotatable secret that signs webhook actions (`Pinwren-Signature: v1=…`). */
function SigningSecretCard({ project }: { project: ProjectDetail }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const reveal = useMutation({
    mutationFn: () => api<{ secret: string }>(`/projects/${project.id}/action-secret`),
    onSuccess: (r) => setSecret(r.secret),
    onError: (e) => toast.error(e.message),
  });
  const rotate = useMutation({
    mutationFn: () =>
      api<{ secret: string }>(`/projects/${project.id}/action-secret/rotate`, { method: "POST" }),
    onSuccess: (r) => {
      setSecret(r.secret);
      setConfirmRotate(false);
      toast.success("New signing secret — update your receivers");
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Signing secret</CardTitle>
        <CardDescription>
          Webhook actions carry{" "}
          <code className="font-mono text-xs">Pinwren-Signature: v1=HMAC-SHA256(secret, timestamp.body)</code>{" "}
          and <code className="font-mono text-xs">Pinwren-Timestamp</code> — the same scheme as outgoing
          webhooks. Verify it before acting.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {secret ? (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-2 pl-3">
            <code
              className="min-w-0 flex-1 font-mono text-xs break-all select-all"
              data-testid="action-secret"
            >
              {secret}
            </code>
            <CopyButton value={secret} label="Copy" size="sm" variant="outline" />
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <KeyRound className="size-4" />
            {project.hasActionSecret
              ? "A secret is set."
              : "Created the first time you reveal it or run a webhook action."}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {!secret && (
            <Button variant="outline" size="sm" disabled={reveal.isPending} onClick={() => reveal.mutate()}>
              <Eye /> Reveal secret
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setConfirmRotate(true)}>
            <RefreshCw /> Rotate
          </Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirmRotate}
        onOpenChange={setConfirmRotate}
        title="Rotate the signing secret?"
        description="Receivers checking the old secret will reject actions until you give them the new one."
        confirmLabel="Rotate"
        pending={rotate.isPending}
        onConfirm={() => rotate.mutate()}
      />
    </Card>
  );
}
