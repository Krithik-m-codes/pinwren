"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, MailPlus, MoreHorizontal, UserMinus, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { copyText } from "@/components/copy-button";
import { timeAgo } from "@/components/feedback-meta";
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
import { api, type Invitation, isAdminRole, qk } from "@/lib/api";
import { authClient, useSession } from "@/lib/auth-client";

type Role = "owner" | "admin" | "member";
const ROLES: { value: Role; label: string; description: string }[] = [
  { value: "member", label: "Member", description: "Triage feedback and comment" },
  { value: "admin", label: "Admin", description: "Also manage members, projects and integrations" },
  { value: "owner", label: "Owner", description: "Full control, including the workspace itself" },
];
const roleLabel = (r: string) => ROLES.find((x) => x.value === r)?.label ?? r;

type FullOrg = {
  id: string;
  name: string;
  members: {
    id: string;
    role: string;
    userId: string;
    createdAt: string | Date;
    user: { name: string; email: string; image?: string | null };
  }[];
};

const orgKey = ["org-full"] as const;
const invitationsKey = ["invitations"] as const;

function unwrap<T>(res: { data: T | null; error: { message?: string | undefined } | null }): T {
  if (res.error || !res.data) throw new Error(res.error?.message ?? "Request failed");
  return res.data;
}

export function MembersSettings() {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const org = useQuery({
    queryKey: orgKey,
    queryFn: async () => unwrap(await authClient.organization.getFullOrganization()) as unknown as FullOrg,
  });
  const invitations = useQuery({
    queryKey: invitationsKey,
    queryFn: () => api<{ invitations: Invitation[] }>("/invitations"),
  });
  const me = org.data?.members.find((m) => m.userId === session?.user.id);
  const canManage = isAdminRole(me?.role);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: orgKey });
    void qc.invalidateQueries({ queryKey: invitationsKey });
    void qc.invalidateQueries({ queryKey: qk.members });
  };

  return (
    <div className="grid gap-4">
      {canManage && <InviteCard onInvited={refresh} />}

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            {org.data ? `${org.data.members.length} in ${org.data.name}` : "People in this workspace"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {org.isPending && (
            <div className="space-y-2">
              <Skeleton className="h-11" />
              <Skeleton className="h-11" />
            </div>
          )}
          {org.isError && <ErrorState error={org.error} retry={() => org.refetch()} />}
          {org.data && (
            <ul className="-my-1 divide-y" aria-label="Members">
              {org.data.members.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  isMe={m.userId === session?.user.id}
                  canManage={canManage}
                  myRole={me?.role}
                  onChanged={refresh}
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
          {invitations.isPending && <Skeleton className="h-11" />}
          {invitations.isError && (
            <ErrorState error={invitations.error} retry={() => invitations.refetch()} />
          )}
          {invitations.data?.invitations.length === 0 && (
            <EmptyState icon={MailPlus} title="No pending invitations" className="py-6" />
          )}
          {invitations.data && invitations.data.invitations.length > 0 && (
            <ul className="-my-1 divide-y" aria-label="Pending invitations">
              {invitations.data.invitations.map((inv) => (
                <InvitationRow key={inv.id} invitation={inv} canManage={canManage} onChanged={refresh} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InviteCard({ onInvited }: { onInvited: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [error, setError] = useState<string | null>(null);
  const invite = useMutation({
    mutationFn: async () =>
      unwrap(await authClient.organization.inviteMember({ email: email.trim(), role: role })),
    onSuccess: () => {
      toast.success(`Invitation sent to ${email.trim()}`);
      setEmail("");
      onInvited();
    },
    onError: (e) => setError(e.message),
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
        <form
          noValidate
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
              setError("Enter a valid email address");
              return;
            }
            setError(null);
            invite.mutate();
          }}
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              placeholder="teammate@example.com"
              aria-label="Email address"
              aria-invalid={!!error || undefined}
              className="sm:flex-1"
            />
            <Select
              items={ROLES.filter((r) => r.value !== "owner")}
              value={role}
              onValueChange={(v) => v && setRole(v)}
            >
              <SelectTrigger className="sm:w-32" aria-label="Role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.filter((r) => r.value !== "owner").map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" disabled={!email.trim() || invite.isPending}>
              <MailPlus /> {invite.isPending ? "Sending…" : "Send invite"}
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
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
  onChanged,
}: {
  member: FullOrg["members"][number];
  isMe: boolean;
  canManage: boolean;
  myRole: string | undefined;
  onChanged: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const changeRole = useMutation({
    mutationFn: async (role: Role) =>
      unwrap(await authClient.organization.updateMemberRole({ memberId: m.id, role })),
    onSuccess: (_d, role) => {
      toast.success(`${m.user.name} is now ${roleLabel(role).toLowerCase()}`);
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async () => unwrap(await authClient.organization.removeMember({ memberIdOrEmail: m.id })),
    onSuccess: () => {
      toast.success(`${m.user.name} was removed`);
      setConfirm(false);
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });
  // Only owners can hand out or take away ownership.
  const editable = canManage && !isMe && (m.role !== "owner" || myRole === "owner");
  const roleOptions = ROLES.filter((r) => r.value !== "owner" || myRole === "owner");

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
          onValueChange={(v) => v && v !== m.role && changeRole.mutate(v as Role)}
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
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </li>
  );
}

function InvitationRow({
  invitation: inv,
  canManage,
  onChanged,
}: {
  invitation: Invitation;
  canManage: boolean;
  onChanged: () => void;
}) {
  const revoke = useMutation({
    mutationFn: async () => unwrap(await authClient.organization.cancelInvitation({ invitationId: inv.id })),
    onSuccess: () => {
      toast.success(`Invitation to ${inv.email} revoked`);
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });
  const link = `${typeof window === "undefined" ? "" : window.location.origin}/accept-invitation/${inv.id}`;
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
        <Button variant="outline" size="sm" onClick={() => revoke.mutate()} disabled={revoke.isPending}>
          {revoke.isPending ? "Revoking…" : "Revoke"}
        </Button>
      )}
    </li>
  );
}
