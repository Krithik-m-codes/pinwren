"use client";

import { type AppRole, appRoleOf, roleCan } from "@pinwren/core";
import { KeyRound, Link2, MailPlus, MoreHorizontal, UserMinus, UserPlus, Users, Wand2 } from "lucide-react";
import { useState } from "react";
import { Controller, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton, copyText } from "@/components/copy-button";
import { useTimeAgo } from "@/components/feedback-meta";
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
import type { TFn } from "@/lib/i18n/english";
import type { Key } from "@/lib/i18n/en";
import { useT } from "@/lib/i18n/provider";
import { useOrigin } from "@/lib/use-synced-state";
import { useViewer } from "@/lib/viewer";
import { SectionTitle } from "../settings-shell";

// Settings › Users (BugPin model, wave-5 contract §3.1): Admins add accounts directly or invite by email,
// change roles and remove people. Roles are Admin, Editor and Viewer; the API enforces them.

const ROLES: { value: AppRole; label: Key; description: Key }[] = [
  { value: "admin", label: "settings3.roleAdmin", description: "settings3.roleAdminDescription" },
  { value: "editor", label: "settings3.roleEditor", description: "settings3.roleEditorDescription" },
  { value: "viewer", label: "settings3.roleViewer", description: "settings3.roleViewerDescription" },
];
const ROLE_PHRASE = {
  admin: "settings3.rolePhraseAdmin",
  editor: "settings3.rolePhraseEditor",
  viewer: "settings3.rolePhraseViewer",
} as const satisfies Record<AppRole, Key>;
const roleLabel = (t: TFn, r: AppRole) => {
  const key = ROLES.find((x) => x.value === r)?.label;
  return key ? t(key) : r;
};
const roleDescription = (t: TFn, r: AppRole) => {
  const key = ROLES.find((x) => x.value === r)?.description;
  return key ? t(key) : undefined;
};
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
  const t = useT();
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
        title={t("settings3.users")}
        description={t("settings3.usersDescription")}
        action={
          canManage && (
            <Button onClick={() => setAdding(true)}>
              <UserPlus /> {t("settings3.addUser")}
            </Button>
          )
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("settings3.people")}</CardTitle>
          <CardDescription>
            {members.data
              ? t("settings3.countInWorkspace", { count: list.length })
              : t("settings3.peopleInWorkspace")}
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
            <EmptyState icon={Users} title={t("settings3.nobodyHereYet")} className="py-6" />
          )}
          {list.length > 0 && (
            <ul className="-my-1 divide-y" aria-label={t("settings3.members")}>
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
          <CardTitle>{t("settings3.pendingInvitations")}</CardTitle>
          <CardDescription>{t("settings3.pendingInvitationsDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {invitations.isLoading && <Skeleton className="h-11" />}
          {invitations.isError && (
            <ErrorState error={invitations.error} retry={() => void invitations.refetch()} />
          )}
          {invitations.data?.invitations.length === 0 && (
            <EmptyState icon={MailPlus} title={t("settings3.noPendingInvitations")} className="py-6" />
          )}
          {invitations.data && invitations.data.invitations.length > 0 && (
            <ul className="-my-1 divide-y" aria-label={t("settings3.pendingInvitations")}>
              {invitations.data.invitations.map((inv) => (
                <InvitationRow key={inv.id} invitation={inv} canManage={canManage} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings3.roles")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-sm">
            {ROLES.map((r) => (
              <div key={r.value} className="grid gap-0.5 sm:grid-cols-[6rem_1fr] sm:gap-3">
                <dt className="font-medium">{t(r.label)}</dt>
                <dd className="text-muted-foreground">{t(r.description)}.</dd>
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
  const t = useT();
  return (
    <Select
      items={ROLES.map((r) => ({ ...r, label: t(r.label) }))}
      value={value}
      onValueChange={(v) => v && onChange(v)}
    >
      <SelectTrigger {...(size ? { size } : {})} className={size ? "w-28" : "sm:w-32"} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLES.map((r) => (
          <SelectItem key={r.value} value={r.value}>
            {t(r.label)}
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
  const t = useT();
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
      toast.success(t("settings3.userAdded", { name: v.name }));
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
              <DialogTitle>{t("settings3.canSignInNow", { name: created.name })}</DialogTitle>
              <DialogDescription>{t("settings3.sendTheseDetails")}</DialogDescription>
            </DialogHeader>
            <dl className="grid gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
              <div className="flex items-center gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">{t("settings3.signInAt")}</dt>
                <dd className="min-w-0 flex-1 truncate font-mono text-xs">{signInUrl}</dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">{t("settings3.colEmail")}</dt>
                <dd className="min-w-0 flex-1 truncate">{created.email}</dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">{t("settings3.password")}</dt>
                <dd className="min-w-0 flex-1 truncate font-mono" data-testid="new-user-password">
                  {created.password}
                </dd>
              </div>
            </dl>
            <DialogFooter>
              <CopyButton
                value={t("settings3.copiedDetails", {
                  url: signInUrl,
                  email: created.email,
                  password: created.password,
                })}
                label={t("settings3.copyDetails")}
                size="sm"
                variant="outline"
              />
              <Button type="button" onClick={() => close(false)}>
                {t("settings3.done")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t("settings3.addUser")}</DialogTitle>
              <DialogDescription>{t("settings3.addUserDescription")}</DialogDescription>
            </DialogHeader>
            <Field id="add-name" label={t("settings3.name")} error={errors.name?.message}>
              <Input
                {...controlProps("add-name", errors.name?.message)}
                {...form.register("name")}
                autoComplete="off"
                // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog's first field; focus moves into a dialog on open
                autoFocus
              />
            </Field>
            <Field id="add-email" label={t("settings3.colEmail")} error={errors.email?.message}>
              <Input
                {...controlProps("add-email", errors.email?.message)}
                {...form.register("email")}
                type="email"
                autoComplete="off"
              />
            </Field>
            <Field
              id="add-password"
              label={t("settings3.password")}
              help={t("settings3.passwordHelp")}
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
                  <Wand2 /> {t("settings3.generate")}
                </Button>
              </div>
            </Field>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">{t("settings3.role")}</span>
              <Controller
                control={form.control}
                name="role"
                render={({ field }) => (
                  <RoleSelect value={field.value} onChange={field.onChange} label={t("settings3.role")} />
                )}
              />
              <p className="text-xs text-muted-foreground">{roleDescription(t, role)}.</p>
            </div>
            <FormError message={errors.root?.message} />
            {taken && (
              <Button
                type="button"
                variant="outline"
                className="justify-self-start"
                onClick={() => onInviteInstead(taken)}
              >
                <MailPlus /> {t("settings3.inviteInstead", { email: taken })}
              </Button>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => close(false)}>
                {t("settings3.cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? t("settings3.adding") : t("settings3.addUser")}
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
  const t = useT();
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
        toast.success(t("settings3.invitationSentTo", { email }));
      } else {
        // Nothing can be emailed: hand the link over instead of pretending it went out.
        const link = created?.id ? `${origin}/accept-invitation/${created.id}` : null;
        if (link) await copyText(link, t("settings3.invitationLinkCopied"));
        toast(t("settings3.invitationCreatedFor", { email }), {
          description: t("settings3.emailNotSetUpSendLink"),
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
        <CardTitle>{t("settings3.inviteByEmail")}</CardTitle>
        <CardDescription>
          {emailConfigured ? t("settings3.inviteLinkDescription") : t("settings3.inviteNoEmailDescription")}
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
              aria-label={t("settings3.emailAddress")}
              className="sm:flex-1"
            />
            <Controller
              control={form.control}
              name="role"
              render={({ field }) => (
                <RoleSelect value={field.value} onChange={field.onChange} label={t("settings3.role")} />
              )}
            />
            <Button type="submit" variant="outline" disabled={isSubmitting}>
              <MailPlus /> {isSubmitting ? t("settings3.sending") : t("settings3.sendInvite")}
            </Button>
          </div>
          <FieldError id="invite-email" message={errors.email?.message} />
          <FormError message={errors.root?.message} />
          <p className="text-xs text-muted-foreground">{roleDescription(t, role)}.</p>
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
  const t = useT();
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
      .then(() => toast.success(t("settings3.isNowRole", { name: m.name, role: t(ROLE_PHRASE[role]) })))
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };
  const remove = () => {
    removeMember(m.id)
      .unwrap()
      .then(() => {
        toast.success(t("settings3.userRemoved", { name: m.name }));
        setConfirm(false);
      })
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };
  const copyReset = () => {
    resetLink(m.id)
      .unwrap()
      .then(({ url }) => copyText(url, t("settings3.resetLinkCopied", { name: m.name })))
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };
  const canCopyReset = canResetPassword && !isMe;
  const menu = editable || canCopyReset;

  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5" data-member={m.email}>
      <UserAvatar name={m.name} image={m.image} className="size-8" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {m.name} {isMe && <span className="font-normal text-muted-foreground">{t("settings3.you")}</span>}
        </p>
        <p className="truncate text-xs text-muted-foreground">{m.email}</p>
      </div>
      {owner && (
        <Badge variant="secondary" className="font-normal">
          {t("settings3.owner")}
        </Badge>
      )}
      {editable ? (
        <RoleSelect
          value={appRole}
          onChange={changeRole}
          label={t("settings3.roleOf", { name: m.name })}
          size="sm"
        />
      ) : (
        <Badge variant="outline">{roleLabel(t, appRole)}</Badge>
      )}
      {menu ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("settings3.actionsFor", { name: m.name })}
              />
            }
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {canCopyReset && (
              <DropdownMenuItem onClick={copyReset}>
                <KeyRound /> {t("settings3.copyPasswordResetLink")}
              </DropdownMenuItem>
            )}
            {editable && (
              <DropdownMenuItem variant="destructive" onClick={() => setConfirm(true)}>
                <UserMinus /> {t("settings3.removeFromWorkspace")}
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
        title={t("settings3.removeNameQuestion", { name: m.name })}
        description={t("settings3.removeMemberDescription")}
        confirmLabel={t("settings3.remove")}
        pending={removal.isLoading}
        onConfirm={remove}
      />
    </li>
  );
}

function InvitationRow({ invitation: inv, canManage }: { invitation: Invitation; canManage: boolean }) {
  const t = useT();
  const timeAgo = useTimeAgo();
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
          {inv.inviter
            ? t("settings3.invitedByLine", {
                role: roleLabel(t, appRoleOf(inv.role)),
                created: timeAgo(inv.createdAt),
                inviter: inv.inviter.name,
                expires: timeAgo(inv.expiresAt),
              })
            : t("settings3.invitedLine", {
                role: roleLabel(t, appRoleOf(inv.role)),
                created: timeAgo(inv.createdAt),
                expires: timeAgo(inv.expiresAt),
              })}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void copyText(link, t("settings3.invitationLinkCopied"))}
      >
        <Link2 /> {t("settings3.copyLink")}
      </Button>
      {canManage && (
        <Button
          variant="outline"
          size="sm"
          disabled={revoke.isLoading}
          onClick={() => {
            cancelInvitation(inv.id)
              .unwrap()
              .then(() => toast.success(t("settings3.invitationRevoked", { email: inv.email })))
              .catch((e: unknown) => toast.error(errorMessage(e)));
          }}
        >
          {revoke.isLoading ? t("settings3.revoking") : t("settings3.revoke")}
        </Button>
      )}
    </li>
  );
}
