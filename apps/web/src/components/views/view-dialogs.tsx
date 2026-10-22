"use client";

import type { ViewFilters } from "@pinwren/core";
import { Controller } from "react-hook-form";
import { toast } from "sonner";
import { controlProps, Field, FormError, useZodForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { SavedView } from "@/lib/api";
import { saveViewForm } from "@/lib/form-schemas";
import type { InboxLayout } from "@/lib/inbox-filters";
import { errorMessage, useCreateViewMutation, useUpdateViewMutation } from "@/lib/store/api";

/**
 * Save the inbox's current filters and layout as a view (wave-4 contract §2), or rename / re-share an
 * existing one. Viewers may keep personal views; only members can share one with the team.
 */
export function ViewDialog({
  open,
  onOpenChange,
  view,
  filters,
  layout,
  canShare,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing this view; otherwise a new one from `filters` + `layout`. */
  view?: SavedView | undefined;
  filters?: ViewFilters;
  layout?: InboxLayout;
  canShare: boolean;
  onSaved?: (view: SavedView) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && (
          <ViewForm
            view={view}
            filters={filters ?? {}}
            layout={layout ?? "list"}
            canShare={canShare}
            onDone={(v) => {
              onOpenChange(false);
              onSaved?.(v);
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ViewForm({
  view,
  filters,
  layout,
  canShare,
  onDone,
  onCancel,
}: {
  view: SavedView | undefined;
  filters: ViewFilters;
  layout: InboxLayout;
  canShare: boolean;
  onDone: (v: SavedView) => void;
  onCancel: () => void;
}) {
  const [create, created] = useCreateViewMutation();
  const [update, updated] = useUpdateViewMutation();
  const form = useZodForm(saveViewForm, {
    defaultValues: { name: view?.name ?? "", shared: view?.shared ?? false },
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async ({ name, shared }) => {
    try {
      const { view: saved } = view
        ? await update({ id: view.id, patch: { name, shared } }).unwrap()
        : await create({ name, shared, filters, layout }).unwrap();
      toast.success(view ? `“${saved.name}” saved` : `View “${saved.name}” saved`);
      onDone(saved);
    } catch (e) {
      form.setError("root", { message: errorMessage(e) });
    }
  });

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{view ? "Edit view" : "Save view"}</DialogTitle>
        <DialogDescription>
          {view
            ? "Rename it, or change who can see it."
            : "Keeps these filters and the layout one click away in the sidebar."}
        </DialogDescription>
      </DialogHeader>
      <Field id="view-name" label="Name" error={errors.name?.message}>
        <Input
          {...controlProps("view-name", errors.name?.message)}
          {...form.register("name")}
          maxLength={80}
          placeholder="Urgent bugs"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog's first field; focus moves into a dialog on open
          autoFocus
        />
      </Field>
      <div className="flex items-start justify-between gap-4">
        <div>
          <label htmlFor="view-shared" className="text-sm font-medium">
            Share with the team
          </label>
          <p className="text-xs text-muted-foreground">
            {canShare
              ? "Everyone in the workspace sees it in their sidebar."
              : "Viewers keep personal views only."}
          </p>
        </div>
        <Controller
          control={form.control}
          name="shared"
          render={({ field }) => (
            <Switch
              id="view-shared"
              checked={field.value}
              disabled={!canShare}
              onCheckedChange={(v) => field.onChange(v)}
            />
          )}
        />
      </div>
      <FormError message={errors.root?.message} />
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting || created.isLoading || updated.isLoading}>
          {isSubmitting ? "Saving…" : view ? "Save" : "Save view"}
        </Button>
      </DialogFooter>
    </form>
  );
}
