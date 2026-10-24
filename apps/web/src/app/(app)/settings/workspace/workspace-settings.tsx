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
      <SectionTitle title="Workspace" description="The team, projects and settings you share." />
      <Card>
        <CardHeader>
          <CardTitle>Name</CardTitle>
          <CardDescription>Shown in the sidebar, invitations and emails.</CardDescription>
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
  const [rename] = useRenameWorkspaceMutation();
  const form = useZodForm(workspaceNameForm, { defaultValues: { name }, mode: "onChange" });
  const { errors, isSubmitting, isDirty } = form.formState;
  const submit = form.handleSubmit(async (v) => {
    try {
      await rename({ name: v.name }).unwrap();
      await refreshWorkspace();
      toast.success("Workspace renamed");
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't rename the workspace"));
    }
  });
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-2 sm:max-w-sm">
      <Label htmlFor="workspace-name">Workspace name</Label>
      <div className="flex gap-2">
        <Input
          {...controlProps("workspace-name", errors.name?.message)}
          {...form.register("name")}
          maxLength={80}
        />
        <Button type="submit" disabled={isSubmitting || !isDirty || !!errors.name}>
          {isSubmitting ? "Saving…" : "Save"}
        </Button>
      </div>
      <FieldError id="workspace-name" message={errors.name?.message} />
    </form>
  );
}

function LeaveCard({ orgId, name }: { orgId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  async function leave() {
    setPending(true);
    const { error } = await authClient.organization.leave({ organizationId: orgId });
    if (error) {
      setPending(false);
      toast.error(error.message ?? "Couldn't leave the workspace");
      return;
    }
    reload();
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Leave workspace</CardTitle>
        <CardDescription>You lose access to {name} until someone adds you again.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" onClick={() => setOpen(true)}>
          <LogOut /> Leave {name}
        </Button>
      </CardContent>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Leave ${name}?`}
        description="Your comments stay. An Admin can add you back."
        confirmLabel="Leave"
        pending={pending}
        onConfirm={() => void leave()}
      />
    </Card>
  );
}

function TransferCard({ members }: { members: { id: string; name: string; email: string }[] }) {
  const [to, setTo] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [transfer, state] = useTransferOwnershipMutation();
  const target = members.find((m) => m.id === to);
  const items = members.map((m) => ({ value: m.id, label: m.name || m.email }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Transfer ownership</CardTitle>
        <CardDescription>
          The new owner can delete the workspace and hand it on. You stay an Admin.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add someone in Settings › Users first.</p>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select items={items} value={to} onValueChange={(v) => setTo(v)}>
              <SelectTrigger className="sm:w-64" aria-label="New owner">
                <SelectValue placeholder="Choose a member" />
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
              <Crown /> Transfer
            </Button>
          </div>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Make ${target?.name ?? "them"} the owner?`}
        description="Only they can undo it, by transferring it back."
        confirmLabel="Transfer ownership"
        pending={state.isLoading}
        onConfirm={() => {
          if (!target) return;
          transfer({ userId: target.id })
            .unwrap()
            .then(() => {
              toast.success(`${target.name} owns this workspace now`);
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
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [remove, state] = useDeleteWorkspaceMutation();
  const matches = typed.trim() === name.trim();
  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle>Delete workspace</CardTitle>
        <CardDescription className="text-pretty">
          Deletes every project, report, screenshot, comment and integration in {name}, for everyone. This
          can&apos;t be undone.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          <Trash2 /> Delete workspace
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
              <DialogTitle>Delete {name}?</DialogTitle>
              <DialogDescription>
                Type <span className="font-medium text-foreground">{name}</span> to confirm.
              </DialogDescription>
            </DialogHeader>
            <Field id="delete-workspace-name" label="Workspace name">
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
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={!matches || state.isLoading}>
                {state.isLoading ? "Deleting…" : "Delete workspace"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
