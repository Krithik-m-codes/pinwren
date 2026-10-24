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
  const items = list.map((p) => ({ value: p.id, label: p.name }));
  return (
    <Select items={items} value={id} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger size="sm" aria-label="Project" className="min-w-44" data-testid="notify-project">
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
  const { isAdmin } = useViewer();
  const { projects, list, id, setChosen } = useProjectChoice();
  const query = useProjectNotificationsQuery(id ?? "", { skip: !id });
  const [update] = useUpdateProjectNotificationsMutation();
  const save = (patch: ProjectNotificationsUpdate) => {
    if (!id) return;
    update({ projectId: id, patch })
      .unwrap()
      .then(() => toast.success("Notification settings saved", { id: "project-notify" }))
      .catch((e: unknown) => toast.error("Not saved", { description: errorMessage(e) }));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {description}
          {!isAdmin && " Only workspace Admins can change these."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {projects.isLoading && <Skeleton className="h-40" />}
        {projects.isError && <ErrorState error={projects.error} retry={() => void projects.refetch()} />}
        {projects.isSuccess && list.length === 0 && (
          <EmptyState
            icon={FolderOpen}
            title="No projects yet"
            description="Notification settings are per project. Create one first."
            action={
              <ButtonLink href="/projects?new=1" size="sm" variant="outline">
                Create a project
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
  const prefs = useNotificationPrefsQuery(undefined);
  return (
    <div className="grid gap-4">
      {prefs.data && !prefs.data.emailConfigured && <EmailNotConfiguredNotice />}
      <PerProject
        title="New report recipients"
        description="Who gets an email and a bell notification when a report arrives. Each person can still switch kinds off for themselves under My notifications."
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
        label="Team members"
        description={
          everyone
            ? "Every member of the workspace, now and later."
            : `${chosen.size} of ${data.members.length} members.`
        }
        stack
      >
        <div className="grid gap-3">
          <Segmented
            label="Team members"
            value={everyone ? "all" : "chosen"}
            onChange={(v) => save({ memberIds: v === "all" ? null : data.members.map((m) => m.userId) })}
            options={[
              { value: "all", label: "All members" },
              { value: "chosen", label: "Chosen members" },
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
        label="Other email addresses"
        description={`People without an account (a client, a shared inbox) who get every new-report email. Each email has a one-click unsubscribe. Up to ${MAX_NOTIFY_EMAILS}.`}
        stack
      >
        <ExtraEmails emails={n.emails} onChange={(emails) => save({ emails })} />
      </SettingRow>
    </SettingGroup>
  );
}

const addressForm = z.object({ email: z.email("An email address like boss@example.com") });

function ExtraEmails({ emails, onChange }: { emails: string[]; onChange: (emails: string[]) => void }) {
  const form = useZodForm(addressForm, { defaultValues: { email: "" } });
  const { errors } = form.formState;
  const full = emails.length >= MAX_NOTIFY_EMAILS;
  const add = form.handleSubmit(({ email }) => {
    const e = email.trim().toLowerCase();
    if (emails.includes(e)) {
      form.setError("email", { message: "Already on the list" });
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
                  aria-label={`Remove ${e}`}
                  onClick={() => onChange(emails.filter((x) => x !== e))}
                >
                  <X />
                </Button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No extra addresses.</p>
      )}
      <form noValidate className="grid gap-1" onSubmit={(e) => void add(e)}>
        <div className="flex gap-2">
          <Input
            {...controlProps("notify-email", errors.email?.message)}
            {...form.register("email")}
            type="email"
            placeholder="boss@example.com"
            aria-label="Add an email address"
            className="sm:max-w-xs"
            disabled={full}
          />
          <Button type="submit" variant="outline" disabled={full}>
            <Plus /> Add
          </Button>
        </div>
        <FieldError
          id="notify-email"
          message={full ? `At most ${MAX_NOTIFY_EMAILS} addresses.` : errors.email?.message}
        />
      </form>
    </div>
  );
}

/** Notifications › Reporter: which emails the person who sent a report gets (to the address they left). */
export function ProjectReporter() {
  const prefs = useNotificationPrefsQuery(undefined);
  return (
    <div className="grid gap-4">
      {prefs.data && !prefs.data.emailConfigured && <EmailNotConfiguredNotice />}
      <PerProject
        title="Emails to the reporter"
        description="Sent to the address a reporter leaves in the widget. Nothing is sent about what reporters do themselves."
      >
        {(data, save) => <ReporterSwitches n={data.notifications} save={save} />}
      </PerProject>
    </div>
  );
}

const REPORTER_SWITCHES: {
  key: Exclude<keyof ProjectNotifications["reporter"], "enabled">;
  label: string;
  description: string;
}[] = [
  { key: "received", label: "Report received", description: "A confirmation right after they send it." },
  {
    key: "statusChanged",
    label: "Status changes",
    description: "When the team resolves, closes or reopens it.",
  },
  {
    key: "priorityChanged",
    label: "Priority changes",
    description: "When the team sets or changes its priority.",
  },
  { key: "assigned", label: "Assignment", description: "When someone on the team takes it on." },
];

function ReporterSwitches({
  n,
  save,
}: {
  n: ProjectNotifications;
  save: (patch: ProjectNotificationsUpdate) => void;
}) {
  const on = n.reporter.enabled;
  return (
    <SettingGroup>
      <SettingRow
        label="Email the reporter"
        htmlFor="reporter-enabled"
        description="The master switch. While it is on, public replies from the team are always emailed to the reporter, with a link that opens the conversation on the page."
      >
        <Switch
          id="reporter-enabled"
          checked={on}
          onCheckedChange={(v) => save({ reporter: { enabled: v } })}
        />
      </SettingRow>
      {REPORTER_SWITCHES.map((s) => (
        <SettingRow key={s.key} label={s.label} htmlFor={`reporter-${s.key}`} description={s.description}>
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
