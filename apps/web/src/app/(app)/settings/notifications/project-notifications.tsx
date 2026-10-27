"use client";

import type { ProjectNotifications, ProjectNotificationsUpdate } from "@pinwren/core";
import { MAX_NOTIFY_EMAILS } from "@pinwren/core";
import { FolderOpen, Mail, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { ButtonLink } from "@/components/button-link";
import { controlProps, FieldError, useZodForm } from "@/components/form";
import { ReadOnly } from "@/components/read-only";
import { SettingGroup, SettingRow } from "@/components/setting-row";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/segmented";
import { EmailNotConfiguredNotice } from "@/components/notifications/notification-parts";
import type { Key } from "@/lib/i18n/en";
import { useT } from "@/lib/i18n/provider";
import { errorMessage, useNotificationPrefsQuery, useProjectsQuery } from "@/lib/store/api";
import {
  type ProjectNotificationsResponse,
  useProjectNotificationsQuery,
  useUpdateProjectNotificationsMutation,
} from "@/lib/store/api/notifications";
import { useViewer } from "@/lib/viewer";

/** The project these settings are for; the first one to start with. */
function useProjectChoice() {
  const projects = useProjectsQuery(undefined);
  const [chosen, setChosen] = useState<string | null>(null);
  const list = projects.data?.projects ?? [];
  const id = list.find((p) => p.id === chosen)?.id ?? list[0]?.id ?? null;
  return { projects, list, id, setChosen };
}

function ProjectPicker({
  list,
  id,
  onChange,
}: {
  list: { id: string; name: string }[];
  id: string;
  onChange: (id: string) => void;
}) {
  const t = useT();
  const items = list.map((p) => ({ value: p.id, label: p.name }));
  return (
    <Select items={items} value={id} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger
        size="sm"
        aria-label={t("settings2.project")}
        className="min-w-44"
        data-testid="notify-project"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((p) => (
          <SelectItem key={p.value} value={p.value}>
            {p.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Loading, no projects, error — then the card for one project's settings. */
function PerProject({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: (
    data: ProjectNotificationsResponse,
    save: (patch: ProjectNotificationsUpdate) => void,
  ) => React.ReactNode;
}) {
  const t = useT();
  const { isAdmin } = useViewer();
  const { projects, list, id, setChosen } = useProjectChoice();
  const query = useProjectNotificationsQuery(id ?? "", { skip: !id });
  const [update] = useUpdateProjectNotificationsMutation();
  const save = (patch: ProjectNotificationsUpdate) => {
    if (!id) return;
    update({ projectId: id, patch })
      .unwrap()
      .then(() => toast.success(t("settings2.notificationSettingsSaved"), { id: "project-notify" }))
      .catch((e: unknown) => toast.error(t("settings2.notSaved"), { description: errorMessage(e) }));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {description}
          {!isAdmin && ` ${t("settings2.onlyAdminsCanChange")}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {projects.isLoading && <Skeleton className="h-40" />}
        {projects.isError && <ErrorState error={projects.error} retry={() => void projects.refetch()} />}
        {projects.isSuccess && list.length === 0 && (
          <EmptyState
            icon={FolderOpen}
            title={t("settings2.noProjectsYet")}
            description={t("settings2.notificationsPerProject")}
            action={
              <ButtonLink href="/projects?new=1" size="sm" variant="outline">
                {t("settings2.createAProject")}
              </ButtonLink>
            }
          />
        )}
        {id && (
          <>
            {list.length > 1 && <ProjectPicker list={list} id={id} onChange={setChosen} />}
            {!query.data && !query.isError && <Skeleton className="h-40" />}
            {query.isError && !query.data && (
              <ErrorState error={query.error} retry={() => void query.refetch()} />
            )}
            {query.data && <ReadOnly when={!isAdmin}>{children(query.data, save)}</ReadOnly>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Notifications › General: who on the team hears about new reports, plus addresses outside the team. */
export function ProjectGeneral() {
  const t = useT();
  const prefs = useNotificationPrefsQuery(undefined);
  return (
    <div className="grid gap-4">
      {prefs.data && !prefs.data.emailConfigured && <EmailNotConfiguredNotice />}
      <PerProject
        title={t("settings2.newReportRecipients")}
        description={t("settings2.newReportRecipientsDesc")}
      >
        {(data, save) => <Recipients data={data} save={save} />}
      </PerProject>
    </div>
  );
}

function Recipients({
  data,
  save,
}: {
  data: ProjectNotificationsResponse;
  save: (patch: ProjectNotificationsUpdate) => void;
}) {
  const t = useT();
  const n = data.notifications;
  const everyone = n.memberIds === null;
  const chosen = new Set(n.memberIds ?? []);
  const toggle = (userId: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(userId);
    else next.delete(userId);
    save({ memberIds: [...next] });
  };
  return (
    <SettingGroup>
      <SettingRow
        label={t("settings2.teamMembers")}
        description={
          everyone
            ? t("settings2.everyMember")
            : t("settings2.chosenOfTotal", { chosen: chosen.size, total: data.members.length })
        }
        stack
      >
        <div className="grid gap-3">
          <Segmented
            label={t("settings2.teamMembers")}
            value={everyone ? "all" : "chosen"}
            onChange={(v) => save({ memberIds: v === "all" ? null : data.members.map((m) => m.userId) })}
            options={[
              { value: "all", label: t("settings2.allMembers") },
              { value: "chosen", label: t("settings2.chosenMembers") },
            ]}
          />
          {!everyone && (
            <ul className="grid gap-1 sm:grid-cols-2" data-testid="notify-members">
              {data.members.map((m) => (
                <li key={m.userId}>
                  <label className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60">
                    <Checkbox checked={chosen.has(m.userId)} onCheckedChange={(v) => toggle(m.userId, v)} />
                    <span className="min-w-0 flex-1 truncate">
                      {m.name}
                      <span className="text-muted-foreground"> · {m.email}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SettingRow>
      <SettingRow
        label={t("settings2.otherEmailAddresses")}
        description={t("settings2.otherEmailAddressesDesc", { max: MAX_NOTIFY_EMAILS })}
        stack
      >
        <ExtraEmails emails={n.emails} onChange={(emails) => save({ emails })} />
      </SettingRow>
    </SettingGroup>
  );
}

const addressForm = z.object({ email: z.email("settings2.emailExample" satisfies Key) });

function ExtraEmails({ emails, onChange }: { emails: string[]; onChange: (emails: string[]) => void }) {
  const t = useT();
  const form = useZodForm(addressForm, { defaultValues: { email: "" } });
  const { errors } = form.formState;
  const emailError = errors.email?.message ? t(errors.email.message as Key) : undefined;
  const full = emails.length >= MAX_NOTIFY_EMAILS;
  const add = form.handleSubmit(({ email }) => {
    const e = email.trim().toLowerCase();
    if (emails.includes(e)) {
      form.setError("email", { message: "settings2.alreadyOnList" satisfies Key });
      return;
    }
    onChange([...emails, e]);
    form.reset({ email: "" });
  });
  return (
    <div className="grid gap-2">
      {emails.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" data-testid="notify-emails">
          {emails.map((e) => (
            <li key={e}>
              <Badge variant="secondary" className="gap-1 pr-0.5 font-normal">
                <Mail className="size-3" /> {e}
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={t("settings2.removeNamed", { name: e })}
                  onClick={() => onChange(emails.filter((x) => x !== e))}
                >
                  <X />
                </Button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("settings2.noExtraAddresses")}</p>
      )}
      <form noValidate className="grid gap-1" onSubmit={(e) => void add(e)}>
        <div className="flex gap-2">
          <Input
            {...controlProps("notify-email", emailError)}
            {...form.register("email")}
            type="email"
            placeholder={t("settings2.emailPlaceholder")}
            aria-label={t("settings2.addAnEmailAddress")}
            className="sm:max-w-xs"
            disabled={full}
          />
          <Button type="submit" variant="outline" disabled={full}>
            <Plus /> {t("settings2.add")}
          </Button>
        </div>
        <FieldError
          id="notify-email"
          message={full ? t("settings2.atMostAddresses", { max: MAX_NOTIFY_EMAILS }) : emailError}
        />
      </form>
    </div>
  );
}

/** Notifications › Reporter: which emails the person who sent a report gets (to the address they left). */
export function ProjectReporter() {
  const t = useT();
  const prefs = useNotificationPrefsQuery(undefined);
  return (
    <div className="grid gap-4">
      {prefs.data && !prefs.data.emailConfigured && <EmailNotConfiguredNotice />}
      <PerProject title={t("settings2.emailsToReporter")} description={t("settings2.emailsToReporterDesc")}>
        {(data, save) => <ReporterSwitches n={data.notifications} save={save} />}
      </PerProject>
    </div>
  );
}

const REPORTER_SWITCHES: {
  key: Exclude<keyof ProjectNotifications["reporter"], "enabled">;
  label: Key;
  description: Key;
}[] = [
  { key: "received", label: "settings2.reporterReceived", description: "settings2.reporterReceivedDesc" },
  {
    key: "statusChanged",
    label: "settings2.reporterStatusChanged",
    description: "settings2.reporterStatusChangedDesc",
  },
  {
    key: "priorityChanged",
    label: "settings2.reporterPriorityChanged",
    description: "settings2.reporterPriorityChangedDesc",
  },
  { key: "assigned", label: "settings2.reporterAssigned", description: "settings2.reporterAssignedDesc" },
];

function ReporterSwitches({
  n,
  save,
}: {
  n: ProjectNotifications;
  save: (patch: ProjectNotificationsUpdate) => void;
}) {
  const t = useT();
  const on = n.reporter.enabled;
  return (
    <SettingGroup>
      <SettingRow
        label={t("settings2.emailTheReporter")}
        htmlFor="reporter-enabled"
        description={t("settings2.emailTheReporterDesc")}
      >
        <Switch
          id="reporter-enabled"
          checked={on}
          onCheckedChange={(v) => save({ reporter: { enabled: v } })}
        />
      </SettingRow>
      {REPORTER_SWITCHES.map((s) => (
        <SettingRow
          key={s.key}
          label={t(s.label)}
          htmlFor={`reporter-${s.key}`}
          description={t(s.description)}
        >
          <Switch
            id={`reporter-${s.key}`}
            checked={on && n.reporter[s.key]}
            disabled={!on}
            onCheckedChange={(v) => save({ reporter: { [s.key]: v } })}
          />
        </SettingRow>
      ))}
    </SettingGroup>
  );
}
