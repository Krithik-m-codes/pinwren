"use client";

import { Lock, ShieldCheck, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, useMembersQuery } from "@/lib/store/api";
import {
  type InstanceAdmin,
  useAddInstanceAdminMutation,
  useInstanceAdminsQuery,
  useRemoveInstanceAdminMutation,
} from "@/lib/store/api/people";
import { useViewer } from "@/lib/viewer";

/**
 * Who administers this server (SMTP, security, licence): the first account, people they name here, and
 * PINWREN_ADMIN_EMAILS (locked, changed in the environment). The server never lets the last one go.
 */
export function InstanceAdminsCard() {
  const { userId } = useViewer();
  const q = useInstanceAdminsQuery(undefined);
  const members = useMembersQuery(undefined);
  const [add, adding] = useAddInstanceAdminMutation();
  const [remove, removing] = useRemoveInstanceAdminMutation();
  const [pick, setPick] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<InstanceAdmin | null>(null);

  const adminIds = new Set(q.data?.admins.map((a) => a.id));
  const candidates = (members.data?.members ?? [])
    .filter((m) => !adminIds.has(m.id))
    .map((m) => ({ value: m.id, label: `${m.name} (${m.email})` }));
  const total = q.data?.admins.length ?? 0;
  const removable = (q.data?.admins ?? []).filter((a) => a.source === "dashboard").length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Instance administrators</CardTitle>
        <CardDescription>
          They set up email delivery, security and the licence for everyone on this server.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {q.isLoading && <Skeleton className="h-20" />}
        {q.isError && <ErrorState error={q.error} retry={() => void q.refetch()} className="py-6" />}
        {q.data && (
          <ul className="-my-1 divide-y" aria-label="Instance administrators">
            {q.data.admins.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 py-2.5" data-admin={a.email}>
                <span className="grid size-8 place-items-center rounded-full bg-muted">
                  <ShieldCheck className="size-4 text-muted-foreground" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {a.name}{" "}
                    {a.id === userId && <span className="font-normal text-muted-foreground">(you)</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{a.email}</p>
                </div>
                {a.source === "env" ? (
                  <Badge
                    variant="outline"
                    className="gap-1 font-mono font-normal text-muted-foreground"
                    title="Listed in PINWREN_ADMIN_EMAILS; change it in the server's environment"
                  >
                    <Lock className="size-3" /> PINWREN_ADMIN_EMAILS
                  </Badge>
                ) : (
                  // The last dashboard-named admin can only go once someone else administers the server.
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${a.name} as administrator`}
                    disabled={removable <= 1 && total <= 1}
                    onClick={() => setConfirm(a)}
                  >
                    <X />
                  </Button>
                )}
              </li>
            ))}
            {q.data.pendingEmails.map((email) => (
              <li key={email} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="grid size-8 place-items-center rounded-full bg-muted">
                  <Lock className="size-4 text-muted-foreground" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{email}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    Listed in PINWREN_ADMIN_EMAILS; an administrator once they sign up
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {q.data && candidates.length > 0 && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select items={candidates} value={pick} onValueChange={(v) => setPick(v)}>
              <SelectTrigger className="sm:flex-1" aria-label="Member to make an administrator">
                <SelectValue placeholder="Choose someone from this workspace" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              disabled={!pick || adding.isLoading}
              onClick={() => {
                if (!pick) return;
                add(pick)
                  .unwrap()
                  .then(() => {
                    toast.success("Administrator added");
                    setPick(null);
                  })
                  .catch((e: unknown) => toast.error(errorMessage(e)));
              }}
            >
              <UserPlus /> {adding.isLoading ? "Adding…" : "Make administrator"}
            </Button>
          </div>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Remove ${confirm?.name ?? ""} as administrator?`}
        description={
          confirm?.id === userId
            ? "You lose access to email, security and licence settings."
            : "They keep their account and workspaces."
        }
        confirmLabel="Remove"
        pending={removing.isLoading}
        onConfirm={() => {
          if (!confirm) return;
          remove(confirm.id)
            .unwrap()
            .then(() => {
              toast.success(`${confirm.name} is no longer an administrator`);
              setConfirm(null);
            })
            .catch((e: unknown) => toast.error(errorMessage(e)));
        }}
      />
    </Card>
  );
}
