"use client";

import { type CustomRole, customRoleCreate, type Permission, PERMISSION_GROUPS } from "@pinwren/core";
import { Lock, Pencil, Plus, ShieldPlus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { Controller } from "react-hook-form";
import { toast } from "sonner";
import { ButtonLink } from "@/components/button-link";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { controlProps, Field, FormError, useZodForm } from "@/components/form";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { Key } from "@/lib/i18n/en";
import { useI18n } from "@/lib/i18n/provider";
import {
  errorMessage,
  useCreateRoleMutation,
  useDeleteRoleMutation,
  useMeQuery,
  useRolesQuery,
  useUpdateRoleMutation,
} from "@/lib/store/api";
import { SectionTitle } from "../settings-shell";

const GROUP_LABELS = {
  feedback: "roles.group_feedback",
  workspace: "roles.group_workspace",
  access: "roles.group_access",
} as const satisfies Record<(typeof PERMISSION_GROUPS)[number]["id"], Key>;

const PERMISSION_LABELS = {
  "feedback.read": "roles.perm_feedback_read",
  "feedback.create": "roles.perm_feedback_create",
  "feedback.update": "roles.perm_feedback_update",
  "feedback.comment": "roles.perm_feedback_comment",
  "feedback.delete": "roles.perm_feedback_delete",
  "feedback.restore": "roles.perm_feedback_restore",
  "projects.manage": "roles.perm_projects_manage",
  "labels.manage": "roles.perm_labels_manage",
  "integrations.manage": "roles.perm_integrations_manage",
  "settings.manage": "roles.perm_settings_manage",
  "branding.manage": "roles.perm_branding_manage",
  "users.manage": "roles.perm_users_manage",
  "audit.read": "roles.perm_audit_read",
  "billing.manage": "roles.perm_billing_manage",
} as const satisfies Partial<Record<Permission, Key>>;

/**
 * Settings › Roles (F-093, ADR 0045): define custom roles from a fixed catalogue of permissions. Workspace
 * Admins only; without the Enterprise `custom_roles` feature the page explains what it needs and lists any
 * roles already defined (they stay, but no longer apply).
 */
export function RolesSettings() {
  const { t, tn } = useI18n();
  const me = useMeQuery(undefined);
  const roles = useRolesQuery(undefined, { skip: !me.data?.permissions.includes("roles.manage") });
  const [editing, setEditing] = useState<CustomRole | "new" | null>(null);
  const [deleting, setDeleting] = useState<CustomRole | null>(null);
  const [deleteRole, deletion] = useDeleteRoleMutation();

  if (me.isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (!me.data?.permissions.includes("roles.manage")) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={Lock}
            title={t("roles.adminsOnlyTitle")}
            description={t("roles.adminsOnlyDescription")}
          />
        </CardContent>
      </Card>
    );
  }
  if (roles.isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (!roles.data) return <ErrorState error={roles.error} retry={() => void roles.refetch()} />;

  const { entitled, roles: list } = roles.data;
  const remove = () => {
    if (!deleting) return;
    const { id, name } = deleting;
    deleteRole(id)
      .unwrap()
      .then(() => {
        toast.success(t("roles.deleted", { name }));
        setDeleting(null);
      })
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };

  return (
    <div className="grid gap-4">
      <SectionTitle
        title={t("roles.title")}
        description={t("roles.description")}
        action={
          entitled && (
            <Button onClick={() => setEditing("new")}>
              <Plus /> {t("roles.new")}
            </Button>
          )
        }
      />

      {!entitled && (
        <Card data-testid="roles-upgrade">
          <CardContent>
            <EmptyState
              icon={Sparkles}
              title={t("roles.upgradeTitle")}
              description={t("roles.upgradeDescription")}
              action={
                <ButtonLink href="/settings/license" variant="outline">
                  {t("roles.upgradeAction")}
                </ButtonLink>
              }
            />
          </CardContent>
        </Card>
      )}

      {(entitled || list.length > 0) && (
        <Card>
          <CardContent>
            {!entitled && <p className="mb-3 text-sm text-muted-foreground">{t("roles.lapsedNote")}</p>}
            {list.length === 0 ? (
              <EmptyState
                icon={ShieldPlus}
                title={t("roles.emptyTitle")}
                description={t("roles.emptyDescription")}
                className="py-6"
              />
            ) : (
              <ul className="-my-1 divide-y" aria-label={t("roles.listLabel")}>
                {list.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 py-3" data-role={r.name}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {r.description || t("roles.noDescription")}
                      </p>
                    </div>
                    <Badge variant="outline">{tn("roles.permissionCount", r.permissions.length)}</Badge>
                    <Badge variant="secondary">{tn("roles.memberCount", r.memberCount)}</Badge>
                    {entitled && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("roles.editNamed", { name: r.name })}
                        onClick={() => setEditing(r)}
                      >
                        <Pencil />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("roles.deleteNamed", { name: r.name })}
                      onClick={() => setDeleting(r)}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {editing && (
        <RoleDialog
          key={editing === "new" ? "new" : editing.id}
          role={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("roles.deleteTitle", { name: deleting?.name ?? "" })}
        description={
          deleting && deleting.memberCount > 0
            ? tn("roles.inUse", deleting.memberCount)
            : t("roles.deleteDescription")
        }
        confirmLabel={t("roles.delete")}
        pending={deletion.isLoading}
        onConfirm={remove}
      />
    </div>
  );
}

/** Create or edit one role: name, description and grouped permission checkboxes. */
function RoleDialog({ role, onClose }: { role: CustomRole | null; onClose: () => void }) {
  const { t } = useI18n();
  const [create] = useCreateRoleMutation();
  const [update] = useUpdateRoleMutation();
  const form = useZodForm(customRoleCreate, {
    defaultValues: {
      name: role?.name ?? "",
      description: role?.description ?? "",
      permissions: role?.permissions ?? ["feedback.read"],
    },
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (v) => {
    try {
      if (role) await update({ id: role.id, ...v }).unwrap();
      else await create(v).unwrap();
      toast.success(t(role ? "roles.saved" : "roles.created", { name: v.name }));
      onClose();
    } catch (e) {
      form.setError("root", { message: errorMessage(e) });
    }
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t(role ? "roles.editTitle" : "roles.createTitle")}</DialogTitle>
            <DialogDescription>{t("roles.dialogDescription")}</DialogDescription>
          </DialogHeader>
          <Field id="role-name" label={t("roles.nameLabel")} error={errors.name?.message}>
            <Input
              {...controlProps("role-name", errors.name?.message)}
              {...form.register("name")}
              placeholder={t("roles.namePlaceholder")}
              autoComplete="off"
              maxLength={60}
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog's first field; focus moves into a dialog on open
              autoFocus
            />
          </Field>
          <Field
            id="role-description"
            label={t("roles.descriptionLabel")}
            error={errors.description?.message}
          >
            <Textarea
              {...controlProps("role-description", errors.description?.message)}
              {...form.register("description")}
              placeholder={t("roles.descriptionPlaceholder")}
              rows={2}
              maxLength={300}
            />
          </Field>
          <fieldset className="grid max-h-72 gap-3 overflow-y-auto">
            <legend className="mb-1 text-sm font-medium">{t("roles.permissionsLabel")}</legend>
            <Controller
              control={form.control}
              name="permissions"
              render={({ field }) => (
                <>
                  {PERMISSION_GROUPS.map((g) => (
                    <div key={g.id} className="grid gap-1.5" role="group" aria-label={t(GROUP_LABELS[g.id])}>
                      <p className="text-xs font-medium text-muted-foreground uppercase">
                        {t(GROUP_LABELS[g.id])}
                      </p>
                      {g.permissions.map((p) => {
                        const always = p === "feedback.read";
                        return (
                          <div key={p} className="flex items-start gap-2.5 text-sm">
                            <Checkbox
                              id={`perm-${p}`}
                              className="mt-0.5"
                              checked={always || field.value.includes(p)}
                              disabled={always}
                              onCheckedChange={(on) =>
                                field.onChange(on ? [...field.value, p] : field.value.filter((x) => x !== p))
                              }
                            />
                            <label htmlFor={`perm-${p}`}>{t(PERMISSION_LABELS[p])}</label>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </>
              )}
            />
            <p className="text-xs text-muted-foreground">{t("roles.alwaysOn")}</p>
          </fieldset>
          <FormError message={errors.root?.message} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("roles.cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t("roles.saving") : t(role ? "roles.save" : "roles.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
