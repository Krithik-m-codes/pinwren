"use client";

import { labelCreate, MAX_LABELS_PER_PROJECT } from "@pinwren/core";
import { Loader2, Plus, Tag, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Controller, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { ColorPicker } from "@/components/color-picker";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { controlProps, Field, useZodForm } from "@/components/form";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { Label, ProjectDetail } from "@/lib/api";
import { useI18n, useT } from "@/lib/i18n/provider";
import {
  errorMessage,
  useCreateLabelMutation,
  useDeleteLabelMutation,
  useLabelsQuery,
  useUpdateLabelMutation,
} from "@/lib/store/api";
import { useSyncedState } from "@/lib/use-synced-state";
import { useViewer } from "@/lib/viewer";
import { colorFor, LabelDot } from "../../inbox/pickers";

/**
 * Settings › Labels (F-051): the project's labels with how many live items carry each. Admins and Editors
 * add, rename, recolour and delete them (`labels.manage`); Viewers read. Items get labels in the inbox
 * (`l` on an open item, or the bulk bar).
 */
export function LabelsTab({ project }: { project: ProjectDetail }) {
  const t = useT();
  const { canWrite } = useViewer();
  const labels = useLabelsQuery(project.id);
  const list = labels.data?.labels ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tag className="size-4" /> {t("projects1.labels")}
        </CardTitle>
        <CardDescription>
          {t("projects1.labelsDescriptionBefore")}{" "}
          <kbd className="rounded border px-1 font-mono text-[11px]">l</kbd>
          {t("projects1.labelsDescriptionAfter")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canWrite && <NewLabel projectId={project.id} full={list.length >= MAX_LABELS_PER_PROJECT} />}
        {labels.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : labels.isError ? (
          <ErrorState error={labels.error} retry={() => void labels.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState
            icon={Tag}
            title={t("projects1.noLabelsYet")}
            description={canWrite ? t("projects1.noLabelsAdmin") : t("projects1.noLabelsViewer")}
            className="py-8"
          />
        ) : (
          <ul
            className="divide-y rounded-lg border"
            aria-label={t("projects1.labels")}
            data-testid="labels-list"
          >
            {list.map((l) => (
              <LabelRow key={l.id} label={l} canWrite={canWrite} projectId={project.id} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function NewLabel({ projectId, full }: { projectId: string; full: boolean }) {
  const t = useT();
  const [createLabel] = useCreateLabelMutation();
  const form = useZodForm(labelCreate, { defaultValues: { name: "", color: "#e5484d" } });
  const { isSubmitting, errors } = form.formState;
  const name = useWatch({ control: form.control, name: "name" });
  const submit = form.handleSubmit(async (v) => {
    try {
      await createLabel({ projectId, ...v }).unwrap();
      toast.success(t("projects1.labelAdded", { name: v.name }));
      form.reset({ name: "", color: colorFor(`${v.name}-next`) });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });
  return (
    <form className="flex flex-wrap items-end gap-2" noValidate onSubmit={(e) => void submit(e)}>
      <Field
        id="label-name"
        label={t("projects1.newLabel")}
        error={errors.name?.message}
        className="min-w-48 flex-1"
      >
        <Input
          {...form.register("name")}
          {...controlProps("label-name", errors.name?.message)}
          placeholder={t("projects1.labelNamePlaceholder")}
          maxLength={40}
          disabled={full}
        />
      </Field>
      <Field id="label-color" label={t("projects1.colour")} error={errors.color?.message}>
        <Controller
          control={form.control}
          name="color"
          render={({ field }) => (
            <ColorPicker
              id="label-color"
              label={t("projects1.labelColour")}
              value={field.value}
              onChange={field.onChange}
              onCommit={field.onChange}
            />
          )}
        />
      </Field>
      <Button type="submit" disabled={full || !name.trim() || isSubmitting}>
        {isSubmitting ? <Loader2 className="animate-spin" /> : <Plus />} {t("projects1.addLabel")}
      </Button>
      {full && (
        <p className="w-full text-xs text-muted-foreground">
          {t("projects1.labelLimit", { max: MAX_LABELS_PER_PROJECT })}
        </p>
      )}
    </form>
  );
}

function LabelRow({ label: l, canWrite, projectId }: { label: Label; canWrite: boolean; projectId: string }) {
  const { t, tn } = useI18n();
  const [updateLabel, updating] = useUpdateLabelMutation();
  const [deleteLabel, deleting] = useDeleteLabelMutation();
  const [name, setName] = useSyncedState(l.name);
  const [color, setColor] = useSyncedState(l.color);
  const [confirming, setConfirming] = useState(false);
  const save = (patch: { name?: string; color?: string }) =>
    updateLabel({ id: l.id, ...patch })
      .unwrap()
      .then(() => toast.success(t("projects1.labelSaved")))
      .catch((e: unknown) => {
        setName(l.name);
        setColor(l.color);
        toast.error(errorMessage(e));
      });
  const items = tn("projects1.labelItems", l.count);

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2" data-label={l.name}>
      {canWrite ? (
        <>
          <ColorPicker
            id={`label-color-${l.id}`}
            label={t("projects1.colourOf", { name: l.name })}
            value={color}
            onChange={setColor}
            onCommit={(hex) => hex !== l.color && void save({ color: hex })}
          />
          <Input
            value={name}
            aria-label={t("projects1.nameOf", { name: l.name })}
            maxLength={40}
            className="h-8 max-w-64 flex-1"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const next = name.trim();
              if (!next) setName(l.name);
              else if (next !== l.name) void save({ name: next });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setName(l.name);
                e.currentTarget.blur();
              }
            }}
          />
        </>
      ) : (
        <span className="flex items-center gap-2 text-sm">
          <LabelDot color={l.color} className="size-2.5" /> {l.name}
        </span>
      )}
      <Link
        href={`/inbox?project=${projectId}&label=${l.id}&status=all`}
        className="ml-auto text-xs text-muted-foreground tabular-nums underline-offset-4 hover:underline"
      >
        {items}
      </Link>
      {updating.isLoading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
      {canWrite && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("projects1.deleteLabelAria", { name: l.name })}
          className="text-muted-foreground hover:text-destructive"
          onClick={() => setConfirming(true)}
        >
          <Trash2 />
        </Button>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("projects1.deleteLabelTitle", { name: l.name })}
        description={t("projects1.deleteLabelDescription", { items })}
        pending={deleting.isLoading}
        onConfirm={() =>
          deleteLabel(l.id)
            .unwrap()
            .then(() => {
              setConfirming(false);
              toast.success(t("projects1.labelDeleted"));
            })
            .catch((e: unknown) => toast.error(errorMessage(e)))
        }
      />
    </li>
  );
}
