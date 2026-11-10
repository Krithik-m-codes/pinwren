"use client";

import { APP_ROLES, type ApiDashboard, type AppRole, dashboardCreate } from "@pinwren/core";
import {
  ChevronDown,
  Copy,
  LayoutDashboard,
  Pencil,
  Plus,
  Share2,
  Star,
  StarOff,
  Trash2,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Controller, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { controlProps, Field, FormError, useZodForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { DashboardsApi } from "@/lib/dashboard/use-dashboards";
import type { Key } from "@/lib/i18n/en";
import { useI18n } from "@/lib/i18n/provider";
import { errorMessage } from "@/lib/store/api";

// The dashboard picker of a screen and everything you can do to a dashboard: create, rename, duplicate,
// make default, share with the workspace (Admins) and delete.

const BUILTIN = "__builtin";
const nameForm = z.object({ name: dashboardCreate.shape.name });
const publishForm = z.object({ shared: z.boolean(), roles: z.array(z.enum(APP_ROLES)) });
const ROLE_LABELS: Record<AppRole, Key> = {
  admin: "dashx.roleAdmin",
  editor: "dashx.roleEditor",
  viewer: "dashx.roleViewer",
};

type Dialogs = "create" | "rename" | "publish" | "delete" | null;

export function DashboardSwitcher({
  board,
  isAdmin,
  onSelect,
  builtinName,
}: {
  board: DashboardsApi;
  isAdmin: boolean;
  onSelect: (id: string | null) => void;
  /** Name shown for the built-in layout a person has not saved yet. */
  builtinName: string;
}) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState<Dialogs>(null);
  const active = board.active;
  const mine = board.dashboards.filter((d) => d.mine);
  const shared = board.dashboards.filter((d) => !d.mine);
  const current = active?.id ?? BUILTIN;
  const isDefault = !!active && board.defaultId === active.id;
  const fail = (e: unknown) => toast.error(errorMessage(e));
  const pick = (v: unknown) => onSelect(typeof v === "string" && v !== BUILTIN ? v : null);

  const copy = async (d: ApiDashboard) => {
    try {
      const made = await board.duplicate(d.id);
      onSelect(made.id);
      toast.success(t("dashx.duplicated", { name: made.name }));
    } catch (e) {
      fail(e);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              aria-label={t("dashx.switcher")}
              data-testid="dashboard-switcher"
              className="max-w-56"
            />
          }
        >
          {active?.shared ? <Users /> : <LayoutDashboard />}
          <span className="truncate">{active?.name ?? builtinName}</span>
          <ChevronDown />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("dashx.myDashboards")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={current} onValueChange={pick}>
              {mine.length === 0 && (
                <DropdownMenuRadioItem value={BUILTIN} closeOnClick>
                  {builtinName}
                </DropdownMenuRadioItem>
              )}
              {mine.map((d) => (
                <DropdownMenuRadioItem key={d.id} value={d.id} data-dashboard={d.name} closeOnClick>
                  <span className="truncate">{d.name}</span>
                  {board.defaultId === d.id && (
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {t("dashx.defaultBadge")}
                    </span>
                  )}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          {shared.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t("dashx.sharedDashboards")}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={current} onValueChange={pick}>
                {shared.map((d) => (
                  <DropdownMenuRadioItem key={d.id} value={d.id} data-dashboard={d.name} closeOnClick>
                    <Users className="size-3.5" />
                    <span className="truncate">{d.name}</span>
                    {board.defaultId === d.id && (
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {t("dashx.defaultBadge")}
                      </span>
                    )}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setDialog("create")}>
            <Plus /> {t("dashx.new")}
          </DropdownMenuItem>
          {active && (
            <>
              {active.mine && (
                <DropdownMenuItem onClick={() => setDialog("rename")}>
                  <Pencil /> {t("dashx.rename")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => void copy(active)}>
                <Copy /> {active.mine ? t("dashx.duplicate") : t("dashx.duplicateToMine")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  void board
                    .makeDefault(isDefault ? null : active.id)
                    .then(() =>
                      toast.success(
                        isDefault ? t("dashx.defaultCleared") : t("dashx.defaultSet", { name: active.name }),
                      ),
                    )
                    .catch(fail)
                }
              >
                {isDefault ? <StarOff /> : <Star />}{" "}
                {isDefault ? t("dashx.clearDefault") : t("dashx.makeDefault")}
              </DropdownMenuItem>
              {isAdmin && (active.mine || active.shared) && (
                <DropdownMenuItem onClick={() => setDialog("publish")}>
                  <Share2 /> {active.shared ? t("dashx.sharing") : t("dashx.publish")}
                </DropdownMenuItem>
              )}
              {board.editable && (
                <DropdownMenuItem variant="destructive" onClick={() => setDialog("delete")}>
                  <Trash2 /> {t("dashx.delete")}
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <NameDialog
        open={dialog === "create" || dialog === "rename"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog === "rename" ? t("dashx.renameTitle") : t("dashx.createTitle")}
        hint={dialog === "rename" ? undefined : t("dashx.createHint")}
        submitLabel={dialog === "rename" ? t("dashx.save") : t("dashx.create")}
        initial={dialog === "rename" ? (active?.name ?? "") : ""}
        onSubmit={async (name) => {
          if (dialog === "rename" && active) {
            await board.rename(active.id, name);
            toast.success(t("dashx.renamed", { name }));
          } else {
            const made = await board.create(name);
            onSelect(made.id);
            toast.success(t("dashx.created", { name: made.name }));
          }
        }}
      />
      {active && (
        <PublishDialog
          key={active.id}
          open={dialog === "publish"}
          onOpenChange={(o) => !o && setDialog(null)}
          dashboard={active}
          onSubmit={async (isShared, roles) => {
            await board.publish(active.id, isShared, roles);
            toast.success(isShared ? t("dashx.published", { name: active.name }) : t("dashx.unpublished"));
          }}
        />
      )}
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("dashx.deleteTitle", { name: active?.name ?? "" })}
        description={active?.shared ? t("dashx.deleteShared") : t("dashx.deletePersonal")}
        onConfirm={() => {
          if (!active) return;
          void board
            .remove(active.id)
            .then(() => {
              onSelect(null);
              toast.success(t("dashx.deleted", { name: active.name }));
              setDialog(null);
            })
            .catch(fail);
        }}
      />
    </>
  );
}

function NameDialog({
  open,
  onOpenChange,
  title,
  hint,
  submitLabel,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  hint?: string | undefined;
  submitLabel: string;
  initial: string;
  onSubmit: (name: string) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && (
          <NameForm
            title={title}
            hint={hint}
            submitLabel={submitLabel}
            initial={initial}
            onSubmit={onSubmit}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function NameForm({
  title,
  hint,
  submitLabel,
  initial,
  onSubmit,
  onDone,
}: {
  title: string;
  hint: string | undefined;
  submitLabel: string;
  initial: string;
  onSubmit: (name: string) => Promise<void>;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const form = useZodForm(nameForm, { defaultValues: { name: initial } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async ({ name }) => {
    try {
      await onSubmit(name);
      onDone();
    } catch (e) {
      form.setError("root", { message: errorMessage(e) });
    }
  });
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {hint && <DialogDescription>{hint}</DialogDescription>}
      </DialogHeader>
      <Field id="dashboard-name" label={t("dashx.name")} error={errors.name?.message}>
        <Input
          {...controlProps("dashboard-name", errors.name?.message)}
          {...form.register("name")}
          maxLength={60}
          placeholder={t("dashx.namePlaceholder")}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog's first field; focus moves into a dialog on open
          autoFocus
        />
      </Field>
      <FormError message={errors.root?.message} />
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("dashx.cancel")}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Share a dashboard with the workspace (read-only for everyone else) and choose who starts on it. */
function PublishDialog({
  open,
  onOpenChange,
  dashboard,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dashboard: ApiDashboard;
  onSubmit: (shared: boolean, roles: AppRole[]) => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && (
          <PublishForm
            dashboard={dashboard}
            onSubmit={onSubmit}
            onDone={() => onOpenChange(false)}
            title={t("dashx.publishTitle", { name: dashboard.name })}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PublishForm({
  dashboard,
  title,
  onSubmit,
  onDone,
}: {
  dashboard: ApiDashboard;
  title: string;
  onSubmit: (shared: boolean, roles: AppRole[]) => Promise<void>;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const form = useZodForm(publishForm, {
    defaultValues: { shared: dashboard.shared, roles: dashboard.defaultRoles },
  });
  const { errors, isSubmitting } = form.formState;
  const shared = useWatch({ control: form.control, name: "shared" });
  const submit = form.handleSubmit(async (v) => {
    try {
      await onSubmit(v.shared, v.shared ? v.roles : []);
      onDone();
    } catch (e) {
      form.setError("root", { message: errorMessage(e) });
    }
  });
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{t("dashx.publishHint")}</DialogDescription>
      </DialogHeader>
      <div className="flex items-center justify-between gap-4">
        <label htmlFor="dashboard-shared" className="text-sm font-medium">
          {t("dashx.shareSwitch")}
        </label>
        <Controller
          control={form.control}
          name="shared"
          render={({ field }) => (
            <Switch id="dashboard-shared" checked={field.value} onCheckedChange={(v) => field.onChange(v)} />
          )}
        />
      </div>
      {shared && (
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">{t("dashx.roleDefaults")}</legend>
          <p className="text-xs text-muted-foreground">{t("dashx.roleHint")}</p>
          <Controller
            control={form.control}
            name="roles"
            render={({ field }) => (
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {APP_ROLES.map((role) => (
                  <label key={role} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={field.value.includes(role)}
                      onCheckedChange={(on) =>
                        field.onChange(on ? [...field.value, role] : field.value.filter((r) => r !== role))
                      }
                    />
                    {t(ROLE_LABELS[role])}
                  </label>
                ))}
              </div>
            )}
          />
        </fieldset>
      )}
      <FormError message={errors.root?.message} />
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("dashx.cancel")}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {t("dashx.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
