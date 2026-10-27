"use client";

import { MAX_SESSION_DAYS, MIN_SESSION_DAYS, safeHref } from "@pinwren/core";
import { ArrowUpCircle, CircleCheck, Lock, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useTimeAgo } from "@/components/feedback-meta";
import { NumberInput } from "@/components/number-input";
import { SettingGroup, SettingRow } from "@/components/setting-row";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { SecuritySettings } from "@/lib/api";
import { useI18n, useT } from "@/lib/i18n/provider";
import {
  errorMessage,
  isForbidden,
  useRunUpdateCheckMutation,
  useSecuritySettingsQuery,
  useUpdateSecuritySettingsMutation,
} from "@/lib/store/api";
import { SectionTitle } from "../settings-shell";
import { InstanceAdminsCard } from "./instance-admins";
import { SignInMethodsCard } from "./sign-in-methods-card";

function EnvBadge({ name }: { name: string }) {
  const t = useT();
  return (
    <Badge
      variant="outline"
      className="gap-1 font-mono font-normal text-muted-foreground"
      title={t("settings2.setByEnv")}
    >
      <Lock className="size-3" /> {name}
    </Badge>
  );
}

/**
 * Settings › Security (instance admins): administrators, sign-in methods, session lifetime, HTTPS status,
 * update check.
 */
export function SecuritySettingsForm() {
  const { t, tn } = useI18n();
  const timeAgo = useTimeAgo();
  const query = useSecuritySettingsQuery(undefined);
  const [updateSecurity] = useUpdateSecuritySettingsMutation();
  const [runCheck, checking] = useRunUpdateCheckMutation();
  const save = {
    mutate: ({
      patch,
      message,
    }: {
      patch: Partial<Pick<SecuritySettings, "sessionDays" | "updateCheck">>;
      message: string;
    }) => {
      updateSecurity(patch)
        .unwrap()
        .then(() => toast.success(message))
        .catch((e: unknown) => toast.error(t("settings2.notSaved"), { description: errorMessage(e) }));
    },
  };
  const check = () => {
    runCheck(undefined)
      .unwrap()
      .then((r) => {
        if (!r.checked)
          toast(
            r.reason === "privacy_mode" ? t("settings2.skippedPrivacyMode") : t("settings2.updateCheckIsOff"),
          );
        else if (r.state?.error) toast.error(t("settings2.couldntReachFeed"), { description: r.state.error });
        else if (r.state?.available)
          toast.success(t("settings2.versionAvailable", { version: r.state.latest ?? "?" }));
        else toast.success(t("settings2.onLatestVersion"));
      })
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };

  if (query.isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (isForbidden(query.error)) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={Lock}
            title={t("settings2.instanceAdminsOnly")}
            description={t("settings2.instanceAdminsOnlyDesc")}
          />
        </CardContent>
      </Card>
    );
  }
  if (!query.data) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const s = query.data.security;
  const blockedByPrivacy = s.privacyModeProjects > 0;

  return (
    <div className="grid gap-4">
      <SectionTitle title={t("settings2.security")} description={t("settings2.securityDesc")} />
      <InstanceAdminsCard />
      <SignInMethodsCard />
      <Card>
        <CardHeader>
          <CardTitle>{t("settings2.sessions")}</CardTitle>
          <CardDescription>{t("settings2.sessionsDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingRow
            label={t("settings2.sessionLifetime")}
            htmlFor="session-days"
            description={t("settings2.sessionLifetimeDesc", { min: MIN_SESSION_DAYS, max: MAX_SESSION_DAYS })}
          >
            <div className="grid gap-1">
              <NumberInput
                id="session-days"
                className="w-32"
                value={s.sessionDays}
                min={MIN_SESSION_DAYS}
                max={MAX_SESSION_DAYS}
                suffix={t("settings2.daysSuffix")}
                disabled={s.locked.sessionDays}
                onCommit={(n) =>
                  n !== null &&
                  n !== s.sessionDays &&
                  save.mutate({
                    patch: { sessionDays: n },
                    message: tn("settings2.newSessionsLast", n),
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
          <CardTitle>{t("settings2.transport")}</CardTitle>
          <CardDescription>{t("settings2.transportDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingGroup>
            <SettingRow label={t("settings2.enforceHttps")} description={t("settings2.enforceHttpsDesc")}>
              <div className="flex flex-col items-start gap-1 sm:items-end">
                {s.enforceHttps ? (
                  <Badge variant="secondary" className="gap-1.5 font-normal">
                    <ShieldCheck className="size-3.5 text-emerald-600" /> {t("settings2.on")}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1.5 font-normal">
                    <ShieldAlert className="size-3.5 text-amber-600" /> {t("settings2.off")}
                  </Badge>
                )}
                <code className="font-mono text-xs text-muted-foreground">PINWREN_ENFORCE_HTTPS=true</code>
              </div>
            </SettingRow>
            <SettingRow label={t("settings2.behindProxy")} description={t("settings2.behindProxyDesc")}>
              <div className="flex flex-col items-start gap-1 sm:items-end">
                <Badge variant={s.trustProxy ? "secondary" : "outline"} className="font-normal">
                  {s.trustProxy ? tn("settings2.trustedHops", s.trustProxyHops) : t("settings2.notTrusted")}
                </Badge>
                <code className="font-mono text-xs text-muted-foreground">PINWREN_TRUST_PROXY=1</code>
              </div>
            </SettingRow>
          </SettingGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {t("settings2.updates")}
            <Badge variant="outline" className="ml-auto font-mono font-normal">
              v{s.version.replace(/^v/, "")}
            </Badge>
          </CardTitle>
          <CardDescription>{t("settings2.updatesDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingGroup>
            <SettingRow
              label={t("settings2.checkForUpdates")}
              htmlFor="update-check"
              description={
                blockedByPrivacy
                  ? tn("settings2.pausedPrivacy", s.privacyModeProjects)
                  : t("settings2.readsLatestRelease")
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
                      message: updateCheck ? t("settings2.updateCheckOn") : t("settings2.updateCheckOff"),
                    })
                  }
                />
              </div>
            </SettingRow>
            <SettingRow
              label={t("settings2.latestCheck")}
              description={
                s.update
                  ? s.update.error
                    ? t("settings2.couldntReachFeedAgo", {
                        time: timeAgo(s.update.checkedAt),
                        error: s.update.error,
                      })
                    : t("settings2.checkedAgo", { time: timeAgo(s.update.checkedAt) })
                  : t("settings2.notCheckedYet")
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                {s.update?.available ? (
                  <a
                    href={safeHref(s.update.url) ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    <ArrowUpCircle className="size-4" />{" "}
                    {t("settings2.versionIsAvailable", { version: s.update.latest ?? "" })}
                  </a>
                ) : s.update && !s.update.error ? (
                  <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                    <CircleCheck className="size-4 text-emerald-600" /> {t("settings2.upToDate")}
                  </span>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={checking.isLoading || !s.updateCheck}
                  onClick={check}
                >
                  <RefreshCw className={checking.isLoading ? "animate-spin" : undefined} />{" "}
                  {t("settings2.checkNow")}
                </Button>
              </div>
            </SettingRow>
          </SettingGroup>
        </CardContent>
      </Card>
    </div>
  );
}
