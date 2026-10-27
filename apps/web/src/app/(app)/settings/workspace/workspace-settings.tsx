"use client";

import { roleCan } from "@pinwren/core";
import { Crown, LogOut, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { controlProps, Field, FieldError, FormError, useZodForm } from "@/components/form";
import { ErrorState } from "@/components/states";
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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { workspaceNameForm } from "@/lib/account-forms";
import { authClient } from "@/lib/auth-client";
import { useT } from "@/lib/i18n/provider";
import { refreshWorkspace } from "@/lib/server/actions";
import { errorMessage, useMembersQuery } from "@/lib/store/api";
import {
  useDeleteWorkspaceMutation,
  useRenameWorkspaceMutation,
  useTransferOwnershipMutation,
  useWorkspacesQuery,
} from "@/lib/store/api/people";
import { useViewer } from "@/lib/viewer";
import { SectionTitle } from "../settings-shell";

const isOwner = (role: string | undefined) => !!role && role.split(",").some((r) => r.trim() === "owner");

/** After leaving or deleting: a full load picks another workspace (or onboarding) on the server. */
const reload = () => window.location.assign(new URL("/inbox", window.location.href).href);

/** Settings › Workspace (wave-5 §3.1): rename it, leave it, hand it over, or delete it. */
export function WorkspaceSettings() {
  const t = useT();
  const { me, userId } = useViewer();
  const workspaces = useWorkspacesQuery(undefined);
  const members = useMembersQuery(undefined);
  const current = workspaces.data?.find((w) => w.id === me?.orgId);
  const owner = isOwner(me?.role);
  const canRename = !!me && roleCan(me.role, "settings.manage");

  if (workspaces.isLoading || !me) return <Skeleton className="h-96 rounded-xl" />;
  if (!current) return <ErrorState error={workspaces.error} retry={() => void workspaces.refetch()} />;

  const others = (members.data?.members ?? []).filter((m) => m.id !== userId);
  return (
    <div className="grid gap-4">
      <SectionTitle title={t("settings3.workspace")} description={t("settings3.workspaceDescription")} />
      <Card>
        <CardHeader>
          <CardTitle>{t("settings3.name")}</CardTitle>
          <CardDescription>{t("settings3.nameShownIn")}</CardDescription>
        </CardHeader>
        <CardContent>
          {canRename ? (
            <RenameForm key={current.name} name={current.name} />
          ) : (
            <p className="text-sm font-medium" data-testid="workspace-name">
              {current.name}
            </p>
          )}
        </CardContent>
      </Card>

      {owner ? (
        <>
          <TransferCard members={others} />
          <DeleteCard name={current.name} />
        </>
      ) : (
        <LeaveCard orgId={current.id} name={current.name} />
      )}
    </div>
  );
}

function RenameForm({ name }: { name: string }) {
  const t = useT();
  const [rename] = useRenameWorkspaceMutation();
  const form = useZodForm(workspaceNameForm, { defaultValues: { name }, mode: "onChange" });
  const { errors, isSubmitting, isDirty } = form.formState;
  const submit = form.handleSubmit(async (v) => {
    try {
      await rename({ name: v.name }).unwrap();
      await refreshWorkspace();
      toast.success(t("settings3.workspaceRenamed"));
    } catch (e) {
      toast.error(errorMessage(e, t("settings3.couldntRenameWorkspace")));
    }
  });
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-2 sm:max-w-sm">
      <Label htmlFor="workspace-name">{t("settings3.workspaceName")}</Label>
      <div className="flex gap-2">
        <Input
          {...controlProps("workspace-name", errors.name?.message)}
          {...form.register("name")}
          maxLength={80}
        />
        <Button type="submit" disabled={isSubmitting || !isDirty || !!errors.name}>
          {isSubmitting ? t("settings3.saving") : t("settings3.save")}
        </Button>
      </div>
      <FieldError id="workspace-name" message={errors.name?.message} />
    </form>
  );
}

function LeaveCard({ orgId, name }: { orgId: string; name: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  async function leave() {
    setPending(true);
    const { error } = await authClient.organization.leave({ organizationId: orgId });
    if (error) {
      setPending(false);
      toast.error(error.message ?? t("settings3.couldntLeaveWorkspace"));
      return;
    }
    reload();
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings3.leaveWorkspace")}</CardTitle>
        <CardDescription>{t("settings3.leaveWorkspaceDescription", { name })}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" onClick={() => setOpen(true)}>
          <LogOut /> {t("settings3.leaveName", { name })}
        </Button>
      </CardContent>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("settings3.leaveNameQuestion", { name })}
        description={t("settings3.leaveConfirmDescription")}
        confirmLabel={t("settings3.leave")}
        pending={pending}
        onConfirm={() => void leave()}
      />
    </Card>
  );
}

function TransferCard({ members }: { members: { id: string; name: string; email: string }[] }) {
  const t = useT();
  const [to, setTo] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [transfer, state] = useTransferOwnershipMutation();
  const target = members.find((m) => m.id === to);
  const items = members.map((m) => ({ value: m.id, label: m.name || m.email }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings3.transferOwnership")}</CardTitle>
        <CardDescription>{t("settings3.transferOwnershipDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("settings3.addSomeoneFirst")}</p>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select items={items} value={to} onValueChange={(v) => setTo(v)}>
              <SelectTrigger className="sm:w-64" aria-label={t("settings3.newOwner")}>
                <SelectValue placeholder={t("settings3.chooseAMember")} />
              </SelectTrigger>
              <SelectContent>
                {items.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" disabled={!target} onClick={() => setConfirm(true)}>
              <Crown /> {t("settings3.transfer")}
            </Button>
          </div>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("settings3.makeOwnerQuestion", { name: target?.name ?? t("settings3.them") })}
        description={t("settings3.makeOwnerDescription")}
        confirmLabel={t("settings3.transferOwnership")}
        pending={state.isLoading}
        onConfirm={() => {
          if (!target) return;
          transfer({ userId: target.id })
            .unwrap()
            .then(() => {
              toast.success(t("settings3.ownsWorkspaceNow", { name: target.name }));
              setConfirm(false);
              setTo(null);
            })
            .catch((e: unknown) => toast.error(errorMessage(e)));
        }}
      />
    </Card>
  );
}

function DeleteCard({ name }: { name: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [remove, state] = useDeleteWorkspaceMutation();
  const matches = typed.trim() === name.trim();
  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle>{t("settings3.deleteWorkspace")}</CardTitle>
        <CardDescription className="text-pretty">
          {t("settings3.deleteWorkspaceDescription", { name })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          <Trash2 /> {t("settings3.deleteWorkspace")}
        </Button>
      </CardContent>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) {
            setTyped("");
            setError(undefined);
          }
          setOpen(o);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form
            noValidate
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!matches) return;
              remove({ confirm: typed })
                .unwrap()
                .then(reload)
                .catch((err: unknown) => setError(errorMessage(err)));
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("settings3.deleteNameQuestion", { name })}</DialogTitle>
              <DialogDescription>
                {t("settings3.typeBefore")} <span className="font-medium text-foreground">{name}</span>{" "}
                {t("settings3.typeAfter")}
              </DialogDescription>
            </DialogHeader>
            <Field id="delete-workspace-name" label={t("settings3.workspaceName")}>
              <Input
                id="delete-workspace-name"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog's only field
                autoFocus
              />
            </Field>
            <FormError message={error} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t("settings3.cancel")}
              </Button>
              <Button type="submit" variant="destructive" disabled={!matches || state.isLoading}>
                {state.isLoading ? t("settings3.deleting") : t("settings3.deleteWorkspace")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
