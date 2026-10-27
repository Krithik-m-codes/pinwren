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
import { useI18n, useT } from "@/lib/i18n/provider";
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
  const { t, tm } = useI18n();
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
    commit(next, t("projects1.orderSaved"));
  };

  return (
    <div className="grid max-w-3xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {t("projects1.panelActions")}
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
              <Plus /> {t("projects1.addAction")}
            </Button>
          </CardTitle>
          <CardDescription>{t("projects1.panelActionsDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {actions.length === 0 ? (
            <EmptyState
              icon={Zap}
              title={t("projects1.noActionsYet")}
              description={t("projects1.noActionsDescription")}
              className="py-8"
            />
          ) : (
            <ul className="divide-y rounded-lg border" aria-label={t("projects1.panelActions")}>
              {actions.map((a, i) => (
                <li key={a.id} className="flex items-center gap-3 px-3 py-2.5" data-action={a.id}>
                  <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted">
                    <PanelActionIcon action={a} className="size-4 text-muted-foreground" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      {a.label}
                      <Badge variant="outline" className="font-normal">
                        {a.kind === "link" ? t("projects1.kindLink") : t("projects1.kindWebhook")}
                      </Badge>
                      <Badge variant="secondary" className="font-normal">
                        {a.visibleTo === "team" ? t("projects1.teamOnly") : t("projects1.teamPlusWidget")}
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
                      aria-label={t("projects1.moveUp", { label: a.label })}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("projects1.moveDown", { label: a.label })}
                      disabled={i === actions.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("projects1.editActionLabel", { label: a.label })}
                      onClick={() => setEditing({ index: i, draft: { ...a } })}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("projects1.removeActionLabel", { label: a.label })}
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
            <p className="font-medium text-foreground">{t("projects1.placeholdersForLinks")}</p>
            <p>
              <code className="font-mono">{"{id}"}</code> {t("projects1.placeholderItemId")} ·{" "}
              <code className="font-mono">{"{number}"}</code> {t("projects1.placeholderItemNumber")} ·{" "}
              <code className="font-mono">{"{url}"}</code> {t("projects1.placeholderPageAddress")} ·{" "}
              <code className="font-mono">{"{projectSlug}"}</code>{" "}
              {t("projects1.placeholderProject", { slug: project.slug })}
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
              toast.error(tm(parsed.error.issues[0]?.message ?? t("projects1.invalidAction")));
              return;
            }
            commit(
              parsed.data,
              editing.index === null
                ? t("projects1.actionAdded", { label: a.label })
                : t("projects1.actionSaved", { label: a.label }),
            );
            setEditing(null);
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t("projects1.removeActionTitle", {
          label: removing !== null ? (actions[removing]?.label ?? "") : "",
        })}
        description={t("projects1.removeActionDescription")}
        confirmLabel={t("projects1.remove")}
        onConfirm={() => {
          if (removing === null) return;
          const a = actions[removing];
          commit(
            actions.filter((_, i) => i !== removing),
            t("projects1.actionRemoved", { label: a?.label ?? t("projects1.actionFallbackName") }),
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
  const t = useT();
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
            <DialogTitle>{isNew ? t("projects1.addAnAction") : t("projects1.editActionTitle")}</DialogTitle>
            <DialogDescription>{t("projects1.actionDialogDescription")}</DialogDescription>
          </DialogHeader>
          <Field id="action-label" label={t("projects1.label")} error={errors.label?.message}>
            <Input
              {...controlProps("action-label", errors.label?.message)}
              {...form.register("label")}
              maxLength={40}
              placeholder={t("projects1.labelPlaceholder")}
            />
          </Field>
          <div className="grid gap-1.5">
            <p className="text-sm font-medium">{t("projects1.type")}</p>
            <Controller
              control={form.control}
              name="kind"
              render={({ field }) => (
                <Segmented
                  label={t("projects1.actionType")}
                  value={field.value}
                  onChange={(k) => {
                    field.onChange(k);
                    if (k === "webhook") form.setValue("visibleTo", "team");
                  }}
                  options={[
                    { value: "link", label: t("projects1.openALink") },
                    { value: "webhook", label: t("projects1.callAWebhook") },
                  ]}
                />
              )}
            />
            <p className="text-xs text-muted-foreground">
              {kind === "link" ? t("projects1.linkHint") : t("projects1.webhookHint")}
            </p>
          </div>
          <Field id="action-url" label={t("projects1.url")} error={errors.url?.message}>
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
            <p className="text-sm font-medium">{t("projects1.icon")}</p>
            <Controller
              control={form.control}
              name="icon"
              render={({ field }) => (
                <Segmented
                  label={t("projects1.icon")}
                  value={field.value ?? "none"}
                  onChange={(v) => field.onChange(v === "none" ? null : v)}
                  options={[
                    { value: "none", label: t("projects1.iconAuto"), title: t("projects1.iconAutomatic") },
                    ...PANEL_ACTION_ICONS.map((k) => {
                      const Icon = PANEL_ACTION_ICON_META[k].icon;
                      return { value: k, title: t(PANEL_ACTION_ICON_META[k].labelKey), label: <Icon /> };
                    }),
                  ]}
                />
              )}
            />
          </div>
          <div className="grid gap-1.5">
            <p className="text-sm font-medium">{t("projects1.whoSeesIt")}</p>
            <Controller
              control={form.control}
              name="visibleTo"
              render={({ field }) => (
                <Segmented
                  label={t("projects1.whoSeesIt")}
                  value={field.value}
                  disabled={kind === "webhook"}
                  onChange={field.onChange}
                  options={[
                    { value: "everyone", label: t("projects1.teamAndWidget") },
                    { value: "team", label: t("projects1.teamOnly") },
                  ]}
                />
              )}
            />
            {kind === "webhook" && (
              <p className="text-xs text-muted-foreground">{t("projects1.webhookDashboardOnly")}</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("projects1.cancel")}
            </Button>
            <Button type="submit">{isNew ? t("projects1.addAction") : t("projects1.save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Revealable, rotatable secret that signs webhook actions (`Pinwren-Signature: v1=…`). */
function SigningSecretCard({ project }: { project: ProjectDetail }) {
  const t = useT();
  const [reveal] = useLazyActionSecretQuery();
  const [rotate] = useRotateActionSecretMutation();
  return (
    <SecretCard
      title={t("projects1.signingSecret")}
      testId="action-secret"
      hasSecret={project.hasActionSecret}
      reveal={() => reveal(project.id).unwrap()}
      rotate={() => rotate(project.id).unwrap()}
      rotateTitle={t("projects1.rotateSigningTitle")}
      rotateDescription={t("projects1.rotateSigningDescription")}
      rotatedMessage={t("projects1.signingRotated")}
      description={
        <>
          {t("projects1.webhookCarry")}{" "}
          <code className="font-mono text-xs">Pinwren-Signature: v1=HMAC-SHA256(secret, timestamp.body)</code>{" "}
          {t("projects1.and")} <code className="font-mono text-xs">Pinwren-Timestamp</code>{" "}
          {t("projects1.webhookSameScheme")}
        </>
      }
    />
  );
}
