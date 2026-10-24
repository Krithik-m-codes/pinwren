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
import { errorMessage, useNotificationPrefsQuery, useUpdateNotificationPrefsMutation } from "@/lib/store/api";
import { useUpdateUserPreferencesMutation, useUserPreferencesQuery } from "@/lib/store/api/notifications";

type Key = Exclude<keyof NotificationPreference, "projectId" | "projectName">;
const COLUMNS: { key: Key; label: string; hint: string }[] = [
  { key: "newFeedback", label: "New", hint: "New reports (when you're one of the project's recipients)" },
  { key: "assigned", label: "Assigned", hint: "Something is assigned to you" },
  { key: "mentioned", label: "Mentions", hint: "Someone @mentions you in a comment" },
  { key: "replies", label: "Replies", hint: "Replies on items you're involved in or follow" },
  {
    key: "statusChanges",
    label: "Status",
    hint: "Status changes and deletions on items you're involved in or follow",
  },
  {
    key: "priorityChanges",
    label: "Priority",
    hint: "Priority changes on items you're involved in or follow",
  },
  { key: "email", label: "Email", hint: "Also send these by email (the bell always shows them)" },
];

const DIGESTS: { value: EmailDigestFrequency; label: string }[] = [
  { value: "off", label: "Instantly" },
  { value: "hourly", label: "Hourly digest" },
  { value: "daily", label: "Daily digest" },
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
  const query = useUserPreferencesQuery(undefined);
  const [update] = useUpdateUserPreferencesMutation();
  const save = (patch: { emailDigest?: EmailDigestFrequency; emailPaused?: boolean }) =>
    update(patch)
      .unwrap()
      .then(() => toast.success("Saved", { id: "user-prefs" }))
      .catch((e: unknown) => toast.error("Not saved", { description: errorMessage(e) }));
  const p = query.data?.preferences;

  return (
    <Card>
      <CardHeader>
        <CardTitle>How you&apos;re notified</CardTitle>
        <CardDescription>For every workspace you&apos;re in.</CardDescription>
      </CardHeader>
      <CardContent>
        {query.isLoading && <Skeleton className="h-28" />}
        {query.isError && <ErrorState error={query.error} retry={() => void query.refetch()} />}
        {p && (
          <SettingGroup>
            <SettingRow
              label="Email"
              description={
                p.emailDigest === "off"
                  ? "One email per notification, as it happens."
                  : `One email ${p.emailDigest === "hourly" ? "an hour" : "a day"} listing what you haven't read yet.`
              }
            >
              <Segmented
                label="Email frequency"
                value={p.emailDigest}
                disabled={p.emailPaused}
                onChange={(v) => void save({ emailDigest: v })}
                options={DIGESTS}
              />
            </SettingRow>
            <SettingRow
              label="Pause all email"
              htmlFor="email-paused"
              description="No notification emails at all (digests included). The bell keeps working."
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
  const state = useDesktopNotifications();
  const description =
    state === "unsupported"
      ? "This browser doesn't support desktop notifications."
      : state === "blocked"
        ? "Blocked by the browser. Allow notifications for this site in its settings, then switch this on."
        : "On this device only: a system notification when something new arrives while Pinwren is in the background.";
  return (
    <SettingRow label="Desktop notifications" htmlFor="desktop-notifications" description={description}>
      <Switch
        id="desktop-notifications"
        checked={state === "on"}
        disabled={state === "unsupported" || state === "blocked"}
        onCheckedChange={(v) => {
          void setDesktopEnabled(v).then((r) => {
            if (r === "denied") toast.error("The browser blocked notifications for this site");
          });
        }}
      />
    </SettingRow>
  );
}

/** Per-project matrix. In-app notifications follow these switches; Email decides whether they're emailed too. */
function MatrixCard() {
  const prefs = useNotificationPrefsQuery(undefined);
  const [updatePrefs] = useUpdateNotificationPrefsMutation();
  // Optimistic in the endpoint: the box ticks at once and rolls back if the save fails.
  const save = (body: Partial<NotificationPreference> & { projectId: string }) => {
    updatePrefs(body)
      .unwrap()
      .then(() => toast.success("Notification preferences saved", { id: "prefs" }))
      .catch((e: unknown) => toast.error("Not saved", { description: errorMessage(e) }));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>What you&apos;re notified about</CardTitle>
        <CardDescription>Per project. Turning off Email keeps the in-app bell.</CardDescription>
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
            title="No projects yet"
            description="Preferences appear here once the workspace has a project."
            action={
              <ButtonLink href="/projects?new=1" size="sm" variant="outline">
                Create a project
              </ButtonLink>
            }
          />
        )}
        {prefs.data && prefs.data.preferences.length > 0 && (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[40rem] text-sm" aria-label="Notification preferences">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Project</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="px-2 py-2 text-center font-medium" title={c.hint}>
                      {c.label}
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
                          aria-label={`${c.label} for ${p.projectName}`}
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
              <dt className="inline font-medium text-foreground">{c.label}</dt> —{" "}
              <dd className="inline">{c.hint}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
