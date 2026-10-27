"use client";

import type { EmailDigestFrequency } from "@pinwren/core";
import { BellOff } from "lucide-react";
import { toast } from "sonner";
import { ButtonLink } from "@/components/button-link";
import { EmailNotConfiguredNotice } from "@/components/notifications/notification-parts";
import { Segmented } from "@/components/segmented";
import { SettingGroup, SettingRow } from "@/components/setting-row";
import { EmptyState, ErrorState } from "@/components/states";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { NotificationPreference } from "@/lib/api";
import { setDesktopEnabled, useDesktopNotifications } from "@/lib/desktop-notifications";
import type { Key as I18nKey } from "@/lib/i18n/en";
import { useT } from "@/lib/i18n/provider";
import { errorMessage, useNotificationPrefsQuery, useUpdateNotificationPrefsMutation } from "@/lib/store/api";
import { useUpdateUserPreferencesMutation, useUserPreferencesQuery } from "@/lib/store/api/notifications";

type Key = Exclude<keyof NotificationPreference, "projectId" | "projectName">;
const COLUMNS: { key: Key; label: I18nKey; hint: I18nKey }[] = [
  { key: "newFeedback", label: "settings3.colNew", hint: "settings3.colNewHint" },
  { key: "assigned", label: "settings3.colAssigned", hint: "settings3.colAssignedHint" },
  { key: "mentioned", label: "settings3.colMentions", hint: "settings3.colMentionsHint" },
  { key: "replies", label: "settings3.colReplies", hint: "settings3.colRepliesHint" },
  {
    key: "statusChanges",
    label: "settings3.colStatus",
    hint: "settings3.colStatusHint",
  },
  {
    key: "priorityChanges",
    label: "settings3.colPriority",
    hint: "settings3.colPriorityHint",
  },
  { key: "email", label: "settings3.colEmail", hint: "settings3.colEmailHint" },
];

const DIGESTS: { value: EmailDigestFrequency; label: I18nKey }[] = [
  { value: "off", label: "settings3.digestInstantly" },
  { value: "hourly", label: "settings3.digestHourly" },
  { value: "daily", label: "settings3.digestDaily" },
];

/** My notifications: account-wide email (instant, digest, paused), this device's desktop alerts, the matrix. */
export function MyNotifications() {
  const prefs = useNotificationPrefsQuery(undefined);
  return (
    <div className="grid gap-4">
      {prefs.data && !prefs.data.emailConfigured && <EmailNotConfiguredNotice />}
      <DeliveryCard />
      <MatrixCard />
    </div>
  );
}

function DeliveryCard() {
  const t = useT();
  const query = useUserPreferencesQuery(undefined);
  const [update] = useUpdateUserPreferencesMutation();
  const save = (patch: { emailDigest?: EmailDigestFrequency; emailPaused?: boolean }) =>
    update(patch)
      .unwrap()
      .then(() => toast.success(t("settings3.saved"), { id: "user-prefs" }))
      .catch((e: unknown) => toast.error(t("settings3.notSaved"), { description: errorMessage(e) }));
  const p = query.data?.preferences;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings3.howYoureNotified")}</CardTitle>
        <CardDescription>{t("settings3.forEveryWorkspace")}</CardDescription>
      </CardHeader>
      <CardContent>
        {query.isLoading && <Skeleton className="h-28" />}
        {query.isError && <ErrorState error={query.error} retry={() => void query.refetch()} />}
        {p && (
          <SettingGroup>
            <SettingRow
              label={t("settings3.colEmail")}
              description={
                p.emailDigest === "off"
                  ? t("settings3.emailInstantDescription")
                  : p.emailDigest === "hourly"
                    ? t("settings3.emailHourlyDescription")
                    : t("settings3.emailDailyDescription")
              }
            >
              <Segmented
                label={t("settings3.emailFrequency")}
                value={p.emailDigest}
                disabled={p.emailPaused}
                onChange={(v) => void save({ emailDigest: v })}
                options={DIGESTS.map((d) => ({ ...d, label: t(d.label) }))}
              />
            </SettingRow>
            <SettingRow
              label={t("settings3.pauseAllEmail")}
              htmlFor="email-paused"
              description={t("settings3.pauseAllEmailDescription")}
            >
              <Switch
                id="email-paused"
                checked={p.emailPaused}
                onCheckedChange={(v) => void save({ emailPaused: v })}
              />
            </SettingRow>
            <DesktopRow />
          </SettingGroup>
        )}
      </CardContent>
    </Card>
  );
}

/** Per device: stored in this browser, and the browser asks for permission. */
function DesktopRow() {
  const t = useT();
  const state = useDesktopNotifications();
  const description =
    state === "unsupported"
      ? t("settings3.desktopUnsupported")
      : state === "blocked"
        ? t("settings3.desktopBlocked")
        : t("settings3.desktopOnDeviceOnly");
  return (
    <SettingRow
      label={t("settings3.desktopNotifications")}
      htmlFor="desktop-notifications"
      description={description}
    >
      <Switch
        id="desktop-notifications"
        checked={state === "on"}
        disabled={state === "unsupported" || state === "blocked"}
        onCheckedChange={(v) => {
          void setDesktopEnabled(v).then((r) => {
            if (r === "denied") toast.error(t("settings3.browserBlockedNotifications"));
          });
        }}
      />
    </SettingRow>
  );
}

/** Per-project matrix. In-app notifications follow these switches; Email decides whether they're emailed too. */
function MatrixCard() {
  const t = useT();
  const prefs = useNotificationPrefsQuery(undefined);
  const [updatePrefs] = useUpdateNotificationPrefsMutation();
  // Optimistic in the endpoint: the box ticks at once and rolls back if the save fails.
  const save = (body: Partial<NotificationPreference> & { projectId: string }) => {
    updatePrefs(body)
      .unwrap()
      .then(() => toast.success(t("settings3.notificationPreferencesSaved"), { id: "prefs" }))
      .catch((e: unknown) => toast.error(t("settings3.notSaved"), { description: errorMessage(e) }));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings3.whatYoureNotifiedAbout")}</CardTitle>
        <CardDescription>{t("settings3.perProjectEmailBell")}</CardDescription>
      </CardHeader>
      <CardContent>
        {prefs.isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        )}
        {prefs.isError && <ErrorState error={prefs.error} retry={() => void prefs.refetch()} />}
        {prefs.data?.preferences.length === 0 && (
          <EmptyState
            icon={BellOff}
            title={t("settings3.noProjectsYet")}
            description={t("settings3.preferencesAppearHere")}
            action={
              <ButtonLink href="/projects?new=1" size="sm" variant="outline">
                {t("settings3.createAProject")}
              </ButtonLink>
            }
          />
        )}
        {prefs.data && prefs.data.preferences.length > 0 && (
          <div className="-mx-4 overflow-x-auto px-4">
            <table
              className="w-full min-w-[40rem] text-sm"
              aria-label={t("settings3.notificationPreferences")}
            >
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">{t("settings3.project")}</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="px-2 py-2 text-center font-medium" title={t(c.hint)}>
                      {t(c.label)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {prefs.data.preferences.map((p) => (
                  <tr key={p.projectId} data-project={p.projectName}>
                    <th scope="row" className="max-w-48 truncate py-2.5 pr-4 text-left font-medium">
                      {p.projectName}
                    </th>
                    {COLUMNS.map((c) => (
                      <td key={c.key} className="px-2 py-2.5 text-center">
                        <Checkbox
                          className="mx-auto"
                          checked={p[c.key]}
                          aria-label={t("settings3.columnForProject", {
                            column: t(c.label),
                            project: p.projectName,
                          })}
                          onCheckedChange={(v) => save({ projectId: p.projectId, [c.key]: v })}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <dl className="mt-4 grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
          {COLUMNS.map((c) => (
            <div key={c.key}>
              <dt className="inline font-medium text-foreground">{t(c.label)}</dt> —{" "}
              <dd className="inline">{t(c.hint)}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
