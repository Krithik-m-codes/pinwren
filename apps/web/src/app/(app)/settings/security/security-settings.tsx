"use client";

import { MAX_SESSION_DAYS, MIN_SESSION_DAYS } from "@pinwren/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpCircle, CircleCheck, Lock, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { timeAgo } from "@/components/feedback-meta";
import { NumberInput } from "@/components/number-input";
import { SettingGroup, SettingRow } from "@/components/setting-row";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api, isForbidden, qk, type SecuritySettings } from "@/lib/api";
import { SectionTitle } from "../settings-shell";

function EnvBadge({ name }: { name: string }) {
  return (
    <Badge
      variant="outline"
      className="gap-1 font-mono font-normal text-muted-foreground"
      title="Set by an environment variable"
    >
      <Lock className="size-3" /> {name}
    </Badge>
  );
}

/** Settings › Security (instance admins): session lifetime, HTTPS status, update check. */
export function SecuritySettingsForm() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: qk.security,
    queryFn: () => api<{ security: SecuritySettings }>("/admin/settings/security"),
    retry: (n, e) => !isForbidden(e) && n < 1,
  });
  const save = useMutation({
    mutationFn: ({
      patch,
    }: {
      patch: Partial<Pick<SecuritySettings, "sessionDays" | "updateCheck">>;
      message: string;
    }) => api<{ security: SecuritySettings }>("/admin/settings/security", { method: "PATCH", json: patch }),
    onSuccess: ({ security }, { message }) => {
      qc.setQueryData(qk.security, { security });
      toast.success(message);
    },
    onError: (e) => toast.error("Not saved", { description: e.message }),
  });
  const check = useMutation({
    mutationFn: () =>
      api<{ checked: boolean; reason?: string; state?: SecuritySettings["update"] }>("/admin/update-check", {
        method: "POST",
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: qk.security });
      void qc.invalidateQueries({ queryKey: qk.me });
      if (!r.checked)
        toast(
          r.reason === "privacy_mode" ? "Skipped: a project uses privacy mode" : "The update check is off",
        );
      else if (r.state?.error) toast.error("Couldn't reach the release feed", { description: r.state.error });
      else if (r.state?.available) toast.success(`Version ${r.state.latest} is available`);
      else toast.success("You're on the latest version");
    },
    onError: (e) => toast.error(e.message),
  });

  if (query.isPending) return <Skeleton className="h-96 rounded-xl" />;
  if (isForbidden(query.error)) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={Lock}
            title="Instance admins only"
            description="These settings belong to whoever runs this server (PINWREN_ADMIN_EMAILS)."
          />
        </CardContent>
      </Card>
    );
  }
  if (query.isError || !query.data) return <ErrorState error={query.error} retry={() => query.refetch()} />;
  const s = query.data.security;
  const blockedByPrivacy = s.privacyModeProjects > 0;

  return (
    <div className="grid gap-4">
      <SectionTitle
        title="Security"
        description="Instance-wide settings for everyone who signs in to this server."
      />
      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
          <CardDescription>How long a sign-in lasts.</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingRow
            label="Session lifetime"
            htmlFor="session-days"
            description={`People sign in again after this many days. Applies to new sign-ins; ${MIN_SESSION_DAYS}–${MAX_SESSION_DAYS} days.`}
          >
            <div className="grid gap-1">
              <NumberInput
                id="session-days"
                className="w-32"
                value={s.sessionDays}
                min={MIN_SESSION_DAYS}
                max={MAX_SESSION_DAYS}
                suffix="days"
                disabled={s.locked.sessionDays}
                onCommit={(n) =>
                  n !== null &&
                  n !== s.sessionDays &&
                  save.mutate({
                    patch: { sessionDays: n },
                    message: `New sessions last ${n} day${n === 1 ? "" : "s"}`,
                  })
                }
              />
              {s.locked.sessionDays && <EnvBadge name="PINWREN_SESSION_DAYS" />}
            </div>
          </SettingRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transport</CardTitle>
          <CardDescription>Set by environment variables when the server starts.</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingGroup>
            <SettingRow
              label="Enforce HTTPS"
              description="Plain-HTTP requests are redirected (pages) or refused (forms, API). Localhost stays reachable for health checks."
            >
              <div className="flex flex-col items-start gap-1 sm:items-end">
                {s.enforceHttps ? (
                  <Badge variant="secondary" className="gap-1.5 font-normal">
                    <ShieldCheck className="size-3.5 text-emerald-600" /> On
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1.5 font-normal">
                    <ShieldAlert className="size-3.5 text-amber-600" /> Off
                  </Badge>
                )}
                <code className="font-mono text-xs text-muted-foreground">PINWREN_ENFORCE_HTTPS=true</code>
              </div>
            </SettingRow>
            <SettingRow
              label="Behind a reverse proxy"
              description="Trust X-Forwarded-For / -Proto / -Host from your proxy. Only turn on when a proxy sets them."
            >
              <div className="flex flex-col items-start gap-1 sm:items-end">
                <Badge variant={s.trustProxy ? "secondary" : "outline"} className="font-normal">
                  {s.trustProxy ? "Trusted" : "Not trusted"}
                </Badge>
                <code className="font-mono text-xs text-muted-foreground">PINWREN_TRUST_PROXY=true</code>
              </div>
            </SettingRow>
          </SettingGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Updates
            <Badge variant="outline" className="ml-auto font-mono font-normal">
              v{s.version.replace(/^v/, "")}
            </Badge>
          </CardTitle>
          <CardDescription>Look for a newer release once a day and tell instance admins.</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingGroup>
            <SettingRow
              label="Check for updates"
              htmlFor="update-check"
              description={
                blockedByPrivacy
                  ? `Paused: ${s.privacyModeProjects} project${s.privacyModeProjects === 1 ? " uses" : "s use"} privacy mode, which allows no third-party calls.`
                  : "Reads the latest release from GitHub. Nothing about your instance is sent."
              }
            >
              <div className="flex items-center gap-2">
                {s.locked.updateCheck && <EnvBadge name="PINWREN_UPDATE_CHECK" />}
                <Switch
                  id="update-check"
                  checked={s.updateCheck}
                  disabled={s.locked.updateCheck}
                  onCheckedChange={(updateCheck) =>
                    save.mutate({
                      patch: { updateCheck },
                      message: updateCheck ? "Update check on" : "Update check off",
                    })
                  }
                />
              </div>
            </SettingRow>
            <SettingRow
              label="Latest check"
              description={
                s.update
                  ? s.update.error
                    ? `Couldn't reach the release feed ${timeAgo(s.update.checkedAt)}: ${s.update.error}`
                    : `Checked ${timeAgo(s.update.checkedAt)}.`
                  : "Not checked yet."
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                {s.update?.available ? (
                  <a
                    href={s.update.url ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    <ArrowUpCircle className="size-4" /> {s.update.latest} is available
                  </a>
                ) : s.update && !s.update.error ? (
                  <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                    <CircleCheck className="size-4 text-emerald-600" /> Up to date
                  </span>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={check.isPending || !s.updateCheck}
                  onClick={() => check.mutate()}
                >
                  <RefreshCw className={check.isPending ? "animate-spin" : undefined} /> Check now
                </Button>
              </div>
            </SettingRow>
          </SettingGroup>
        </CardContent>
      </Card>
    </div>
  );
}
