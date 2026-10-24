"use client";

import { type AppRole, appRoleOf, roleCan } from "@pinwren/core";
import { KeyRound, Link2, MailPlus, MoreHorizontal, UserMinus, UserPlus, Users, Wand2 } from "lucide-react";
import { useState } from "react";
import { Controller, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton, copyText } from "@/components/copy-button";
import { timeAgo } from "@/components/feedback-meta";
import { controlProps, Field, FieldError, FormError, useZodForm } from "@/components/form";
import { EmptyState, ErrorState } from "@/components/states";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { addUserForm, inviteUserForm } from "@/lib/account-forms";
import type { Invitation, Member } from "@/lib/api";
import {
  errorMessage,
  isApiError,
  useCancelInvitationMutation,
  useInvitationsQuery,
  useInviteMemberMutation,
  useMembersQuery,
} from "@/lib/store/api";
import {
  useAddMemberMutation,
  useMemberResetLinkMutation,
  useRemoveMemberByIdMutation,
  useSetMemberRoleMutation,
} from "@/lib/store/api/people";
import { useOrigin } from "@/lib/use-synced-state";
import { useViewer } from "@/lib/viewer";
import { SectionTitle } from "../settings-shell";

// Settings › Users (BugPin model, wave-5 contract §3.1): Admins add accounts directly or invite by email,
// change roles and remove people. Roles are Admin, Editor and Viewer; the API enforces them.

const ROLES: { value: AppRole; label: string; description: string }[] = [
  { value: "admin", label: "Admin", description: "Everything: projects, users, integrations and settings" },
  {
    value: "editor",
    label: "Editor",
    description: "View, edit, assign and bulk-update reports, and add them by hand. No deleting, no settings",
  },
  { value: "viewer", label: "Viewer", description: "Read-only: sees everything, changes nothing" },
];
const ROLE_PHRASE = { admin: "an Admin", editor: "an Editor", viewer: "a Viewer" } as const;
const roleLabel = (r: AppRole) => ROLES.find((x) => x.value === r)?.label ?? r;
const isOwner = (role: string) => role.split(",").some((r) => r.trim() === "owner");
/** The Better Auth role an invitation stores for an app role (`ORG_ROLE_FOR` in @pinwren/core). */
const INVITE_ROLE = { admin: "admin", editor: "member", viewer: "viewer" } as const;

/** A readable random password for Add User (the Admin hands it over; the person can change it). */
function generatePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function MembersSettings() {
  const { me, userId, instanceAdmin } = useViewer();
  const members = useMembersQuery(undefined);
  const invitations = useInvitationsQuery(undefined);
  const canManage = !!me && roleCan(me.role, "users.manage");
  const [adding, setAdding] = useState(false);
  const [inviteEmail, setInviteEmail] = useState<string | null>(null);
  const list = members.data?.members ?? [];

  return (
    <div className="grid gap-4">
      <SectionTitle
        title="Users"
        description="Everyone in this workspace and what they can do."
        action={
          canManage && (
            <Button onClick={() => setAdding(true)}>
              <UserPlus /> Add user
            </Button>
          )
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>People</CardTitle>
          <CardDescription>
            {members.data ? `${list.length} in this workspace` : "People in this workspace"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {members.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-11" />
              <Skeleton className="h-11" />
            </div>
          )}
          {members.isError && <ErrorState error={members.error} retry={() => void members.refetch()} />}
          {members.data && list.length === 0 && (
            <EmptyState icon={Users} title="Nobody here yet" className="py-6" />
          )}
          {list.length > 0 && (
            <ul className="-my-1 divide-y" aria-label="Members">
              {list.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  isMe={m.id === userId}
                  canManage={canManage}
                  canResetPassword={instanceAdmin}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canManage && <InviteCard prefill={inviteEmail} emailConfigured={me.emailConfigured} />}

      <Card>
        <CardHeader>
          <CardTitle>Pending invitations</CardTitle>
          <CardDescription>
            Invitations expire after 7 days. Copy the link to send it yourself.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invitations.isLoading && <Skeleton className="h-11" />}
          {invitations.isError && (
            <ErrorState error={invitations.error} retry={() => void invitations.refetch()} />
          )}
          {invitations.data?.invitations.length === 0 && (
            <EmptyState icon={MailPlus} title="No pending invitations" className="py-6" />
          )}
          {invitations.data && invitations.data.invitations.length > 0 && (
            <ul className="-my-1 divide-y" aria-label="Pending invitations">
              {invitations.data.invitations.map((inv) => (
                <InvitationRow key={inv.id} invitation={inv} canManage={canManage} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Roles</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-sm">
            {ROLES.map((r) => (
              <div key={r.value} className="grid gap-0.5 sm:grid-cols-[6rem_1fr] sm:gap-3">
                <dt className="font-medium">{r.label}</dt>
                <dd className="text-muted-foreground">{r.description}.</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {canManage && (
        <AddUserDialog
          open={adding}
          onOpenChange={setAdding}
          onInviteInstead={(email) => {
            setAdding(false);
            setInviteEmail(email);
          }}
        />
      )}
    </div>
  );
}

function RoleSelect({
  value,
  onChange,
  label,
  size,
}: {
  value: AppRole;
  onChange: (role: AppRole) => void;
  label: string;
  size?: "sm";
}) {
  return (
    <Select items={ROLES} value={value} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger {...(size ? { size } : {})} className={size ? "w-28" : "sm:w-32"} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLES.map((r) => (
          <SelectItem key={r.value} value={r.value}>
            {r.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Users › Add User: the account is created at once, with the password the Admin chose. */
function AddUserDialog({
  open,
  onOpenChange,
  onInviteInstead,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInviteInstead: (email: string) => void;
}) {
  const [addMember] = useAddMemberMutation();
  const [created, setCreated] = useState<{ email: string; password: string; name: string } | null>(null);
  const [taken, setTaken] = useState<string | null>(null);
  const form = useZodForm(addUserForm, {
    defaultValues: { name: "", email: "", password: "", role: "editor" },
  });
  const { errors, isSubmitting } = form.formState;
  const role = useWatch({ control: form.control, name: "role" });
  const signInUrl = `${useOrigin()}/sign-in`;

  const close = (o: boolean) => {
    if (!o) {
      form.reset();
      setCreated(null);
      setTaken(null);
    }
    onOpenChange(o);
  };
  const submit = form.handleSubmit(async (v) => {
    setTaken(null);
    try {
      await addMember(v).unwrap();
      toast.success(`${v.name} was added`);
      setCreated({ email: v.email, password: v.password, name: v.name });
    } catch (e) {
      if (isApiError(e) && e.code === "EMAIL_TAKEN") setTaken(v.email);
      form.setError("root", { message: errorMessage(e) });
    }
  });

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        {created ? (
          <div className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{created.name} can sign in now</DialogTitle>
              <DialogDescription>
                Send them these details. They can change the password in Settings › Profile.
              </DialogDescription>
            </DialogHeader>
            <dl className="grid gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
              <div className="flex items-center gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">Sign in at</dt>
                <dd className="min-w-0 flex-1 truncate font-mono text-xs">{signInUrl}</dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">Email</dt>
                <dd className="min-w-0 flex-1 truncate">{created.email}</dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">Password</dt>
                <dd className="min-w-0 flex-1 truncate font-mono" data-testid="new-user-password">
                  {created.password}
                </dd>
              </div>
            </dl>
            <DialogFooter>
              <CopyButton
                value={`Sign in at ${signInUrl}\nEmail: ${created.email}\nPassword: ${created.password}`}
                label="Copy details"
                size="sm"
                variant="outline"
              />
              <Button type="button" onClick={() => close(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Add user</DialogTitle>
              <DialogDescription>
                Creates the account now and adds it to this workspace. No email needed.
              </DialogDescription>
            </DialogHeader>
            <Field id="add-name" label="Name" error={errors.name?.message}>
              <Input
                {...controlProps("add-name", errors.name?.message)}
                {...form.register("name")}
                autoComplete="off"
                // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog's first field; focus moves into a dialog on open
                autoFocus
              />
            </Field>
            <Field id="add-email" label="Email" error={errors.email?.message}>
              <Input
                {...controlProps("add-email", errors.email?.message)}
                {...form.register("email")}
                type="email"
                autoComplete="off"
              />
            </Field>
            <Field
              id="add-password"
              label="Password"
              help="At least 8 characters. You'll see it again to pass on."
              error={errors.password?.message}
            >
              <div className="flex gap-2">
                <Input
                  {...controlProps("add-password", errors.password?.message, true)}
                  {...form.register("password")}
                  type="text"
                  autoComplete="new-password"
                  spellCheck={false}
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => form.setValue("password", generatePassword(), { shouldValidate: true })}
                >
                  <Wand2 /> Generate
                </Button>
              </div>
            </Field>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Role</span>
              <Controller
                control={form.control}
                name="role"
                render={({ field }) => (
                  <RoleSelect value={field.value} onChange={field.onChange} label="Role" />
                )}
              />
              <p className="text-xs text-muted-foreground">
                {ROLES.find((r) => r.value === role)?.description}.
              </p>
            </div>
            <FormError message={errors.root?.message} />
            {taken && (
              <Button
                type="button"
                variant="outline"
                className="justify-self-start"
                onClick={() => onInviteInstead(taken)}
              >
                <MailPlus /> Invite {taken} instead
              </Button>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Adding…" : "Add user"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The second option: an email with a link to join (they create their own password). */
function InviteCard({ prefill, emailConfigured }: { prefill: string | null; emailConfigured: boolean }) {
  const [invite] = useInviteMemberMutation();
  const origin = useOrigin();
  const form = useZodForm(inviteUserForm, { defaultValues: { email: prefill ?? "", role: "editor" } });
  const { errors, isSubmitting } = form.formState;
  const role = useWatch({ control: form.control, name: "role" });
  // "Invite instead" from Add User fills the address in.
  const [seen, setSeen] = useState(prefill);
  if (prefill !== seen) {
    setSeen(prefill);
    if (prefill) form.setValue("email", prefill);
  }
  const submit = form.handleSubmit(async ({ email, role }) => {
    try {
      const created = (await invite({ email, role: INVITE_ROLE[role] }).unwrap()) as { id?: string } | null;
      if (emailConfigured) {
        toast.success(`Invitation sent to ${email}`);
      } else {
        // Nothing can be emailed: hand the link over instead of pretending it went out.
        const link = created?.id ? `${origin}/accept-invitation/${created.id}` : null;
        if (link) await copyText(link, "Invitation link copied");
        toast(`Invitation created for ${email}`, {
          description: "Email isn't set up on this server, so send them the link yourself (copied).",
        });
      }
      form.reset({ email: "", role });
    } catch (e) {
      form.setError("root", { message: errorMessage(e) });
    }
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite by email</CardTitle>
        <CardDescription>
          {emailConfigured
            ? "They get a link to join and choose their own password."
            : "Email isn't set up on this server: you'll get a link to send them yourself."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form noValidate className="grid gap-2" onSubmit={(e) => void submit(e)}>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              {...controlProps("invite-email", errors.email?.message)}
              {...form.register("email")}
              type="email"
              placeholder="teammate@example.com"
              aria-label="Email address"
              className="sm:flex-1"
            />
            <Controller
              control={form.control}
              name="role"
              render={({ field }) => (
                <RoleSelect value={field.value} onChange={field.onChange} label="Role" />
              )}
            />
            <Button type="submit" variant="outline" disabled={isSubmitting}>
              <MailPlus /> {isSubmitting ? "Sending…" : "Send invite"}
            </Button>
          </div>
          <FieldError id="invite-email" message={errors.email?.message} />
          <FormError message={errors.root?.message} />
          <p className="text-xs text-muted-foreground">{ROLES.find((r) => r.value === role)?.description}.</p>
        </form>
      </CardContent>
    </Card>
  );
}

function MemberRow({
  member: m,
  isMe,
  canManage,
  canResetPassword,
}: {
  member: Member;
  isMe: boolean;
  canManage: boolean;
  canResetPassword: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  const [setRole] = useSetMemberRoleMutation();
  const [removeMember, removal] = useRemoveMemberByIdMutation();
  const [resetLink] = useMemberResetLinkMutation();
  const appRole = m.appRole ?? appRoleOf(m.role);
  const owner = isOwner(m.role);
  // Not your own role (another Admin changes it), never the owner's (transfer ownership instead).
  const editable = canManage && !isMe && !owner;

  const changeRole = (role: AppRole) => {
    if (role === appRole) return;
    setRole({ userId: m.id, role })
      .unwrap()
      .then(() => toast.success(`${m.name} is now ${ROLE_PHRASE[role]}`))
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };
  const remove = () => {
    removeMember(m.id)
      .unwrap()
      .then(() => {
        toast.success(`${m.name} was removed`);
        setConfirm(false);
      })
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };
  const copyReset = () => {
    resetLink(m.id)
      .unwrap()
      .then(({ url }) => copyText(url, `Reset link for ${m.name} copied. It works for 24 hours.`))
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };
  const canCopyReset = canResetPassword && !isMe;
  const menu = editable || canCopyReset;

  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5" data-member={m.email}>
      <UserAvatar name={m.name} image={m.image} className="size-8" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {m.name} {isMe && <span className="font-normal text-muted-foreground">(you)</span>}
        </p>
        <p className="truncate text-xs text-muted-foreground">{m.email}</p>
      </div>
      {owner && (
        <Badge variant="secondary" className="font-normal">
          Owner
        </Badge>
      )}
      {editable ? (
        <RoleSelect value={appRole} onChange={changeRole} label={`Role of ${m.name}`} size="sm" />
      ) : (
        <Badge variant="outline">{roleLabel(appRole)}</Badge>
      )}
      {menu ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${m.name}`} />}
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {canCopyReset && (
              <DropdownMenuItem onClick={copyReset}>
                <KeyRound /> Copy password reset link
              </DropdownMenuItem>
            )}
            {editable && (
              <DropdownMenuItem variant="destructive" onClick={() => setConfirm(true)}>
                <UserMinus /> Remove from workspace
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="size-7" aria-hidden />
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Remove ${m.name}?`}
        description="They lose access to this workspace at once. Their account and comments stay."
        confirmLabel="Remove"
        pending={removal.isLoading}
        onConfirm={remove}
      />
    </li>
  );
}

function InvitationRow({ invitation: inv, canManage }: { invitation: Invitation; canManage: boolean }) {
  const [cancelInvitation, revoke] = useCancelInvitationMutation();
  const link = `${useOrigin()}/accept-invitation/${inv.id}`;
  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5" data-invitation={inv.email}>
      <span className="grid size-8 place-items-center rounded-full bg-muted">
        <Users className="size-4 text-muted-foreground" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{inv.email}</p>
        <p className="truncate text-xs text-muted-foreground">
          {roleLabel(appRoleOf(inv.role))} · invited {timeAgo(inv.createdAt)}
          {inv.inviter && ` by ${inv.inviter.name}`} · expires {timeAgo(inv.expiresAt)}
        </p>
      </div>
      <Button variant="ghost" size="sm" onClick={() => void copyText(link, "Invitation link copied")}>
        <Link2 /> Copy link
      </Button>
      {canManage && (
        <Button
          variant="outline"
          size="sm"
          disabled={revoke.isLoading}
          onClick={() => {
            cancelInvitation(inv.id)
              .unwrap()
              .then(() => toast.success(`Invitation to ${inv.email} revoked`))
              .catch((e: unknown) => toast.error(errorMessage(e)));
          }}
        >
          {revoke.isLoading ? "Revoking…" : "Revoke"}
        </Button>
      )}
    </li>
  );
}
