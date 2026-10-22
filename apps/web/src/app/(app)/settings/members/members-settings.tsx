"use client";

import { Link2, MailPlus, MoreHorizontal, UserMinus, Users } from "lucide-react";
import { useState } from "react";
import { Controller, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { copyText } from "@/components/copy-button";
import { timeAgo } from "@/components/feedback-meta";
import { controlProps, FieldError, FormError, useZodForm } from "@/components/form";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { type Invitation, isAdminRole } from "@/lib/api";
import { inviteForm } from "@/lib/form-schemas";
import {
  errorMessage,
  useCancelInvitationMutation,
  useFullOrgQuery,
  useInvitationsQuery,
  useInviteMemberMutation,
  useRemoveMemberMutation,
  useUpdateMemberRoleMutation,
} from "@/lib/store/api";
import type { FullOrg, OrgRole } from "@/lib/store/api/account";
import { useOrigin } from "@/lib/use-synced-state";
import { useViewer } from "@/lib/viewer";

const ROLES: { value: OrgRole; label: string; description: string }[] = [
  {
    value: "viewer",
    label: "Viewer",
    description: "Read everything, change nothing (clients, stakeholders)",
  },
  { value: "member", label: "Member", description: "Triage feedback and comment" },
  { value: "admin", label: "Admin", description: "Also manage members, projects and integrations" },
  { value: "owner", label: "Owner", description: "Full control, including the workspace itself" },
];
const roleLabel = (r: string) => ROLES.find((x) => x.value === r)?.label ?? r;
const INVITE_ROLES = ROLES.filter((r) => r.value !== "owner");

/** Members, roles (owner / admin / member / viewer) and pending invitations (wave-1 §8, wave-4 §4). */
export function MembersSettings() {
  const { userId } = useViewer();
  const org = useFullOrgQuery(undefined);
  const invitations = useInvitationsQuery(undefined);
  const me = org.data?.members.find((m) => m.userId === userId);
  const canManage = isAdminRole(me?.role);

  return (
    <div className="grid gap-4">
      {canManage && <InviteCard />}

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            {org.data ? `${org.data.members.length} in ${org.data.name}` : "People in this workspace"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {org.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-11" />
              <Skeleton className="h-11" />
            </div>
          )}
          {org.isError && <ErrorState error={org.error} retry={() => void org.refetch()} />}
          {org.data && (
            <ul className="-my-1 divide-y" aria-label="Members">
              {org.data.members.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  isMe={m.userId === userId}
                  canManage={canManage}
                  myRole={me?.role}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending invitations</CardTitle>
          <CardDescription>
            Invitations expire after 7 days. Share the link if email isn&apos;t set up.
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
    </div>
  );
}

function InviteCard() {
  const [invite] = useInviteMemberMutation();
  const form = useZodForm(inviteForm, { defaultValues: { email: "", role: "member" } });
  const { errors, isSubmitting } = form.formState;
  const role = useWatch({ control: form.control, name: "role" });
  const submit = form.handleSubmit(async ({ email, role }) => {
    try {
      await invite({ email, role }).unwrap();
      toast.success(`Invitation sent to ${email}`);
      form.reset({ email: "", role });
    } catch (e) {
      form.setError("root", { message: errorMessage(e) });
    }
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite people</CardTitle>
        <CardDescription>
          They get an email with a link to join. They can sign up with that address.
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
                <Select
                  items={INVITE_ROLES}
                  value={field.value}
                  onValueChange={(v) => v && field.onChange(v)}
                >
                  <SelectTrigger className="sm:w-32" aria-label="Role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INVITE_ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <Button type="submit" disabled={isSubmitting}>
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
  myRole,
}: {
  member: FullOrg["members"][number];
  isMe: boolean;
  canManage: boolean;
  myRole: string | undefined;
}) {
  const [confirm, setConfirm] = useState(false);
  const [changeRole] = useUpdateMemberRoleMutation();
  const [removeMember, removal] = useRemoveMemberMutation();
  // Only owners can hand out or take away ownership.
  const editable = canManage && !isMe && (m.role !== "owner" || myRole === "owner");
  const roleOptions = ROLES.filter((r) => r.value !== "owner" || myRole === "owner");

  const setRole = (role: OrgRole) => {
    changeRole({ memberId: m.id, role })
      .unwrap()
      .then(() => toast.success(`${m.user.name} is now ${roleLabel(role).toLowerCase()}`))
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };
  const remove = () => {
    removeMember(m.id)
      .unwrap()
      .then(() => {
        toast.success(`${m.user.name} was removed`);
        setConfirm(false);
      })
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };

  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5" data-member={m.user.email}>
      <UserAvatar name={m.user.name} image={m.user.image} className="size-8" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {m.user.name} {isMe && <span className="font-normal text-muted-foreground">(you)</span>}
        </p>
        <p className="truncate text-xs text-muted-foreground">{m.user.email}</p>
      </div>
      {editable ? (
        <Select
          items={roleOptions}
          value={m.role}
          onValueChange={(v) => v && v !== m.role && setRole(v as OrgRole)}
        >
          <SelectTrigger size="sm" className="w-28" aria-label={`Role of ${m.user.name}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roleOptions.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Badge variant="outline">{roleLabel(m.role)}</Badge>
      )}
      {editable ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${m.user.name}`} />}
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem variant="destructive" onClick={() => setConfirm(true)}>
              <UserMinus /> Remove from workspace
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="size-7" aria-hidden />
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Remove ${m.user.name}?`}
        description="They lose access to this workspace at once. Their comments stay."
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
          {roleLabel(inv.role)} · invited {timeAgo(inv.createdAt)}
          {inv.inviter && ` by ${inv.inviter.name}`} · expires {timeAgo(inv.expiresAt)}
        </p>
      </div>
      <Button variant="ghost" size="sm" onClick={() => copyText(link, "Invitation link copied")}>
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
