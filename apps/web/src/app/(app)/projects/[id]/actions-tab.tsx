"use client";

import {
  MAX_PANEL_ACTIONS,
  PANEL_ACTION_ICONS,
  PANEL_ACTION_KINDS,
  PANEL_ACTION_VISIBILITY,
  type PanelAction,
  panelAction,
  widgetConfig,
} from "@pinwren/core";
import { Controller, useWatch } from "react-hook-form";
import { z } from "zod";
import { controlProps, Field, useZodForm } from "@/components/form";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
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
import type { ProjectDetail } from "@/lib/api";
import { SecretCard } from "@/components/secret-card";
import { useLazyActionSecretQuery, useRotateActionSecretMutation } from "@/lib/store/api";
import { useViewer } from "@/lib/viewer";
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
  const { isAdmin } = useViewer();
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

/**
 * The action form: react-hook-form validated by core's `panelAction` schema itself (the API's rules —
 * http(s) only, known placeholders, no placeholders in webhook URLs), with the id derived from the label.
 */
const actionForm = z
  .object({
    label: z.string(),
    kind: z.enum(PANEL_ACTION_KINDS),
    url: z.string(),
    icon: z.enum(PANEL_ACTION_ICONS).nullable(),
    visibleTo: z.enum(PANEL_ACTION_VISIBILITY),
  })
  .superRefine((v, ctx) => {
    const r = panelAction.safeParse({ ...v, id: "draft" });
    if (r.success) return;
    for (const issue of r.error.issues) {
      ctx.addIssue({ code: "custom", path: [String(issue.path[0] ?? "url")], message: issue.message });
    }
  });

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
  const form = useZodForm(actionForm, {
    defaultValues: {
      label: initial.label,
      kind: initial.kind,
      url: initial.url,
      icon: initial.icon,
      visibleTo: initial.visibleTo,
    },
  });
  const { errors } = form.formState;
  const kind = useWatch({ control: form.control, name: "kind" });
  const submit = form.handleSubmit((v) => {
    const id = isNew ? uniqueId(slug(v.label), takenIds) : initial.id;
    const parsed = panelAction.safeParse({ ...v, id });
    if (parsed.success) onSave(parsed.data);
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{isNew ? "Add an action" : "Edit action"}</DialogTitle>
            <DialogDescription>Shown as a button on each item of this project.</DialogDescription>
          </DialogHeader>
          <Field id="action-label" label="Label" error={errors.label?.message}>
            <Input
              {...controlProps("action-label", errors.label?.message)}
              {...form.register("label")}
              maxLength={40}
              placeholder="Create Jira ticket"
            />
          </Field>
          <div className="grid gap-1.5">
            <p className="text-sm font-medium">Type</p>
            <Controller
              control={form.control}
              name="kind"
              render={({ field }) => (
                <Segmented
                  label="Action type"
                  value={field.value}
                  onChange={(k) => {
                    field.onChange(k);
                    if (k === "webhook") form.setValue("visibleTo", "team");
                  }}
                  options={[
                    { value: "link", label: "Open a link" },
                    { value: "webhook", label: "Call a webhook" },
                  ]}
                />
              )}
            />
            <p className="text-xs text-muted-foreground">
              {kind === "link"
                ? "Opens in a new tab with the placeholders filled in."
                : "Pinwren POSTs the item as JSON, signed with this project's secret, and shows the reply's “message”."}
            </p>
          </div>
          <Field id="action-url" label="URL" error={errors.url?.message}>
            <Input
              {...controlProps("action-url", errors.url?.message)}
              {...form.register("url")}
              inputMode="url"
              spellCheck={false}
              className="font-mono text-[13px]"
              placeholder={
                kind === "link"
                  ? "https://jira.example.com/create?summary={number}"
                  : "https://hooks.example.com/pinwren"
              }
            />
          </Field>
          <div className="grid gap-1.5">
            <p className="text-sm font-medium">Icon</p>
            <Controller
              control={form.control}
              name="icon"
              render={({ field }) => (
                <Segmented
                  label="Icon"
                  value={field.value ?? "none"}
                  onChange={(v) => field.onChange(v === "none" ? null : v)}
                  options={[
                    { value: "none", label: "Auto", title: "Automatic" },
                    ...PANEL_ACTION_ICONS.map((k) => {
                      const Icon = PANEL_ACTION_ICON_META[k].icon;
                      return { value: k, title: PANEL_ACTION_ICON_META[k].label, label: <Icon /> };
                    }),
                  ]}
                />
              )}
            />
          </div>
          <div className="grid gap-1.5">
            <p className="text-sm font-medium">Who sees it</p>
            <Controller
              control={form.control}
              name="visibleTo"
              render={({ field }) => (
                <Segmented
                  label="Who sees it"
                  value={field.value}
                  disabled={kind === "webhook"}
                  onChange={field.onChange}
                  options={[
                    { value: "everyone", label: "Team and widget" },
                    { value: "team", label: "Team only" },
                  ]}
                />
              )}
            />
            {kind === "webhook" && (
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
  const [reveal] = useLazyActionSecretQuery();
  const [rotate] = useRotateActionSecretMutation();
  return (
    <SecretCard
      title="Signing secret"
      testId="action-secret"
      hasSecret={project.hasActionSecret}
      reveal={() => reveal(project.id).unwrap()}
      rotate={() => rotate(project.id).unwrap()}
      rotateTitle="Rotate the signing secret?"
      rotateDescription="Receivers checking the old secret will reject actions until you give them the new one."
      rotatedMessage="New signing secret — update your receivers"
      description={
        <>
          Webhook actions carry{" "}
          <code className="font-mono text-xs">Pinwren-Signature: v1=HMAC-SHA256(secret, timestamp.body)</code>{" "}
          and <code className="font-mono text-xs">Pinwren-Timestamp</code> — the same scheme as outgoing
          webhooks. Verify it before acting.
        </>
      }
    />
  );
}
