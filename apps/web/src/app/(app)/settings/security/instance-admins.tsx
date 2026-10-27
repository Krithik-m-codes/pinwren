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
import { useT } from "@/lib/i18n/provider";
import { useViewer } from "@/lib/viewer";

/**
 * Who administers this server (SMTP, security, licence): the first account, people they name here, and
 * PINWREN_ADMIN_EMAILS (locked, changed in the environment). The server never lets the last one go.
 */
export function InstanceAdminsCard() {
  const t = useT();
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
        <CardTitle>{t("settings3.instanceAdministrators")}</CardTitle>
        <CardDescription>{t("settings3.instanceAdminsDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {q.isLoading && <Skeleton className="h-20" />}
        {q.isError && <ErrorState error={q.error} retry={() => void q.refetch()} className="py-6" />}
        {q.data && (
          <ul className="-my-1 divide-y" aria-label={t("settings3.instanceAdministrators")}>
            {q.data.admins.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 py-2.5" data-admin={a.email}>
                <span className="grid size-8 place-items-center rounded-full bg-muted">
                  <ShieldCheck className="size-4 text-muted-foreground" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {a.name}{" "}
                    {a.id === userId && (
                      <span className="font-normal text-muted-foreground">{t("settings3.you")}</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{a.email}</p>
                </div>
                {a.source === "env" ? (
                  <Badge
                    variant="outline"
                    className="gap-1 font-mono font-normal text-muted-foreground"
                    title={t("settings3.listedInEnvTitle")}
                  >
                    <Lock className="size-3" /> PINWREN_ADMIN_EMAILS
                  </Badge>
                ) : (
                  // The last dashboard-named admin can only go once someone else administers the server.
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("settings3.removeAsAdministrator", { name: a.name })}
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
                    {t("settings3.listedInEnvPending")}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {q.data && candidates.length > 0 && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select items={candidates} value={pick} onValueChange={(v) => setPick(v)}>
              <SelectTrigger className="sm:flex-1" aria-label={t("settings3.memberToMakeAdmin")}>
                <SelectValue placeholder={t("settings3.chooseSomeoneFromWorkspace")} />
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
                    toast.success(t("settings3.administratorAdded"));
                    setPick(null);
                  })
                  .catch((e: unknown) => toast.error(errorMessage(e)));
              }}
            >
              <UserPlus /> {adding.isLoading ? t("settings3.adding") : t("settings3.makeAdministrator")}
            </Button>
          </div>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t("settings3.removeAsAdministratorQuestion", { name: confirm?.name ?? "" })}
        description={confirm?.id === userId ? t("settings3.youLoseAccess") : t("settings3.theyKeepAccount")}
        confirmLabel={t("settings3.remove")}
        pending={removing.isLoading}
        onConfirm={() => {
          if (!confirm) return;
          remove(confirm.id)
            .unwrap()
            .then(() => {
              toast.success(t("settings3.noLongerAdministrator", { name: confirm.name }));
              setConfirm(null);
            })
            .catch((e: unknown) => toast.error(errorMessage(e)));
        }}
      />
    </Card>
  );
}
