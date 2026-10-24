"use client";

import type { EmailSettingsUpdate } from "@pinwren/core";
import { CircleCheck, CircleX, Lock, Mail, Send, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Controller, type UseFormReturn, useFormState, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { controlProps, FieldError, useZodForm } from "@/components/form";
import { NumberInput } from "@/components/number-input";
import { SettingGroup, SettingRow } from "@/components/setting-row";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { EmailField, EmailSettings, EmailTestResult } from "@/lib/api";
import { emailSettingsForm } from "@/lib/form-schemas";
import {
  errorMessage,
  isForbidden,
  useEmailSettingsQuery,
  useUpdateEmailSettingsMutation,
} from "@/lib/store/api";
import { useTestSmtpMutation } from "@/lib/store/api/notifications";
import { EmailDeliveries } from "./email-deliveries";

const ENV: Record<EmailField, string> = {
  host: "SMTP_HOST",
  port: "SMTP_PORT",
  user: "SMTP_USER",
  password: "SMTP_PASSWORD",
  secure: "SMTP_SECURE",
  from: "EMAIL_FROM",
  requireTls: "SMTP_REQUIRE_TLS",
  allowSelfSigned: "SMTP_TLS_REJECT_UNAUTHORIZED",
};

/** Common providers: what to fill in. Nothing is saved until "Save changes". */
const PRESETS = [
  {
    id: "gmail",
    label: "Gmail / Google Workspace",
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    hint: "Use an app password (Google account › Security › App passwords), not your normal password.",
  },
  {
    id: "m365",
    label: "Microsoft 365 / Outlook",
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    hint: "SMTP AUTH must be enabled for the mailbox in the Microsoft 365 admin centre.",
  },
  {
    id: "ses",
    label: "Amazon SES",
    host: "email-smtp.us-east-1.amazonaws.com",
    port: 587,
    secure: false,
    hint: "Change the region in the host to yours; use SES SMTP credentials, not IAM keys.",
  },
  {
    id: "postmark",
    label: "Postmark",
    host: "smtp.postmarkapp.com",
    port: 587,
    secure: false,
    hint: "Username and password are both your Server API token.",
  },
  {
    id: "mailgun",
    label: "Mailgun",
    host: "smtp.mailgun.org",
    port: 587,
    secure: false,
    hint: "Use the SMTP credentials of your sending domain (EU: smtp.eu.mailgun.org).",
  },
  {
    id: "sendgrid",
    label: "SendGrid",
    host: "smtp.sendgrid.net",
    port: 587,
    secure: false,
    user: "apikey",
    hint: "The username is literally “apikey”; the password is an API key.",
  },
  {
    id: "brevo",
    label: "Brevo",
    host: "smtp-relay.brevo.com",
    port: 587,
    secure: false,
    hint: "Use the SMTP key from Brevo › SMTP & API, and your Brevo login as the username.",
  },
  {
    id: "resend",
    label: "Resend",
    host: "smtp.resend.com",
    port: 465,
    secure: true,
    user: "resend",
    hint: "The username is “resend”; the password is an API key.",
  },
] as const;

type FormValues = z.input<typeof emailSettingsForm>;
type Form = UseFormReturn<FormValues, unknown, z.output<typeof emailSettingsForm>>;

function LockedBadge({ field }: { field: EmailField }) {
  return (
    <Badge
      variant="outline"
      className="gap-1 font-mono font-normal text-muted-foreground"
      title="Set by an environment variable"
    >
      <Lock className="size-3" /> {ENV[field]}
    </Badge>
  );
}

const draftOf = (s: EmailSettings): FormValues => ({
  host: s.host ?? "",
  port: s.port,
  user: s.user ?? "",
  secure: s.secure,
  from: s.from ?? "",
  password: "",
  requireTls: s.requireTls,
  allowSelfSigned: s.allowSelfSigned,
});

const str = (v: string) => (v.trim() ? v.trim() : null);

/** The form as an `emailSettingsUpdate`: every unlocked field, the password only when typed. */
function configOf(d: FormValues, locked: EmailSettings["locked"]): EmailSettingsUpdate {
  const out: EmailSettingsUpdate = {};
  if (!locked.host) out.host = str(d.host);
  if (!locked.port) out.port = d.port ?? null;
  if (!locked.user) out.user = str(d.user);
  if (!locked.secure) out.secure = d.secure;
  if (!locked.from) out.from = str(d.from);
  if (!locked.requireTls) out.requireTls = d.requireTls;
  if (!locked.allowSelfSigned) out.allowSelfSigned = d.allowSelfSigned;
  if (!locked.password && d.password) out.password = d.password;
  return out;
}

/**
 * Settings › Email (SMTP), for the instance admin — under the BugPin model the first account, so it's
 * reachable from the start. Env-set fields are read-only and name their variable; the test uses the
 * form as it is, saved or not.
 */
export function EmailSettingsForm() {
  const query = useEmailSettingsQuery(undefined);
  if (query.isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (isForbidden(query.error)) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={Lock}
            title="Instance admins only"
            description="SMTP is configured by whoever runs this Pinwren server: the first account, or an address in PINWREN_ADMIN_EMAILS."
          />
        </CardContent>
      </Card>
    );
  }
  if (!query.data) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  return <SmtpSettings settings={query.data.email} />;
}

function SmtpSettings({ settings: s }: { settings: EmailSettings }) {
  // `values`: the form follows the saved settings whenever they (re)load; the password always starts empty.
  const form = useZodForm(emailSettingsForm, { values: draftOf(s) });
  return (
    <div className="grid gap-4">
      <SmtpCard settings={s} form={form} />
      <TestCard settings={s} form={form} />
      <EmailDeliveries configured={s.configured} />
    </div>
  );
}

function SmtpCard({ settings: s, form }: { settings: EmailSettings; form: Form }) {
  const [updateSettings] = useUpdateEmailSettingsMutation();
  const [preset, setPreset] = useState<string | null>(null);
  // The form is owned by the parent, and the React Compiler memoizes this card on its (stable) props:
  // subscribe here, or validation errors never render.
  const { errors, isSubmitting } = useFormState({ control: form.control });
  const locked = s.locked;
  const allLocked = Object.values(locked).every(Boolean);
  const [port, secure] = useWatch({ control: form.control, name: ["port", "secure"] });
  const hint = PRESETS.find((p) => p.id === preset)?.hint;

  const save = (patch: EmailSettingsUpdate) =>
    updateSettings(patch)
      .unwrap()
      .then(() => toast.success("Email settings saved"))
      .catch((e: unknown) => toast.error("Not saved", { description: errorMessage(e) }));

  const submit = form.handleSubmit(async (d) => {
    const all = configOf(d, locked);
    // Only what changed (the password whenever typed).
    const patch = Object.fromEntries(
      Object.entries(all).filter(([k, v]) => k === "password" || v !== (s as Record<string, unknown>)[k]),
    ) as EmailSettingsUpdate;
    if (!Object.keys(patch).length) {
      toast("Nothing to save");
      return;
    }
    await save(patch);
  });

  const applyPreset = (id: string | null) => {
    setPreset(id);
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    const opts = { shouldDirty: true } as const;
    if (!locked.host) form.setValue("host", p.host, opts);
    if (!locked.port) form.setValue("port", p.port, opts);
    if (!locked.secure) form.setValue("secure", p.secure, opts);
    if (!locked.user && "user" in p) form.setValue("user", p.user, opts);
  };

  const portMismatch =
    port === 465 && !secure
      ? "Port 465 expects TLS from the first byte: turn on “Use TLS”."
      : port === 587 && secure
        ? "Port 587 starts unencrypted and upgrades with STARTTLS: turn off “Use TLS” (and turn on “Require STARTTLS”)."
        : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Outgoing email (SMTP)
          {s.configured ? (
            <Badge variant="secondary" className="ml-auto gap-1.5 font-normal">
              <span className="size-1.5 rounded-full bg-emerald-500" /> Configured
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="ml-auto gap-1.5 font-normal"
              data-testid="smtp-not-configured"
            >
              <span className="size-1.5 rounded-full bg-amber-500" /> Not set up — emails are skipped
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Every email Pinwren sends goes through this server: new-report emails to the team, invitations,
          password resets and emails to reporters. Environment variables override these and lock them.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form noValidate onSubmit={(e) => void submit(e)}>
          <SettingGroup>
            {!allLocked && (
              <SettingRow
                label="Provider"
                description={hint ?? "Fills in the usual host and port for a provider. Nothing is saved yet."}
              >
                <Select
                  items={PRESETS.map((p) => ({ value: p.id, label: p.label }))}
                  value={preset}
                  onValueChange={(v) => applyPreset(v)}
                >
                  <SelectTrigger className="w-full sm:w-72" aria-label="Fill in for a provider">
                    <SelectValue placeholder="Fill in for a provider…" />
                  </SelectTrigger>
                  <SelectContent>
                    {PRESETS.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
            )}
            <SettingRow label="SMTP host" htmlFor="smtp-host">
              <div className="grid w-full gap-1 sm:w-72">
                <Input
                  {...controlProps("smtp-host", errors.host?.message)}
                  {...form.register("host")}
                  disabled={locked.host}
                  placeholder="smtp.example.com"
                />
                {locked.host && <LockedBadge field="host" />}
                <FieldError id="smtp-host" message={errors.host?.message} />
              </div>
            </SettingRow>
            <SettingRow
              label="Port"
              htmlFor="smtp-port"
              description="587 with STARTTLS (most providers) or 465 with TLS from the start."
            >
              <div className="grid w-full gap-1 sm:w-72">
                <Controller
                  control={form.control}
                  name="port"
                  render={({ field }) => (
                    <NumberInput
                      id="smtp-port"
                      className="w-32"
                      value={field.value ?? null}
                      allowEmpty
                      placeholder="587"
                      min={1}
                      max={65535}
                      disabled={locked.port}
                      onChange={field.onChange}
                      onCommit={field.onChange}
                    />
                  )}
                />
                {locked.port && <LockedBadge field="port" />}
              </div>
            </SettingRow>
            <SwitchRow
              form={form}
              name="secure"
              locked={locked.secure}
              label="Use TLS"
              description="Connect with TLS from the start (port 465)."
            />
            <SwitchRow
              form={form}
              name="requireTls"
              locked={locked.requireTls}
              label="Require STARTTLS"
              description="Refuse to send unless the server upgrades the connection to TLS (ports 587 and 25)."
            />
            <SwitchRow
              form={form}
              name="allowSelfSigned"
              locked={locked.allowSelfSigned}
              label="Allow a self-signed certificate"
              description="Only for a mail server on your own network whose certificate can't be verified."
            />
            {portMismatch && (
              <p
                role="status"
                className="flex items-start gap-2 py-3 text-sm text-amber-700 dark:text-amber-400"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {portMismatch}
              </p>
            )}
            <SettingRow label="Username" htmlFor="smtp-user">
              <div className="grid w-full gap-1 sm:w-72">
                <Input id="smtp-user" {...form.register("user")} disabled={locked.user} autoComplete="off" />
                {locked.user && <LockedBadge field="user" />}
              </div>
            </SettingRow>
            <SettingRow
              label="Password"
              htmlFor="smtp-password"
              description={
                s.passwordSet
                  ? "A password is saved. Type a new one to replace it."
                  : "Stored encrypted; never shown again."
              }
            >
              <div className="grid w-full gap-1 sm:w-72">
                <Input
                  id="smtp-password"
                  type="password"
                  autoComplete="new-password"
                  {...form.register("password")}
                  disabled={locked.password}
                  placeholder={s.passwordSet ? "••••••••  (saved)" : ""}
                />
                {locked.password && <LockedBadge field="password" />}
                {s.passwordSet && !locked.password && (
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    className="justify-self-start text-muted-foreground"
                    onClick={() => void save({ password: null })}
                  >
                    Remove saved password
                  </Button>
                )}
              </div>
            </SettingRow>
            <SettingRow
              label="From address"
              htmlFor="smtp-from"
              description="Who the emails come from. Use an address your provider lets you send as."
            >
              <div className="grid w-full gap-1 sm:w-72">
                <Input
                  {...controlProps("smtp-from", errors.from?.message)}
                  {...form.register("from")}
                  disabled={locked.from}
                  placeholder="Pinwren <noreply@example.com>"
                />
                {locked.from && <LockedBadge field="from" />}
                <FieldError id="smtp-from" message={errors.from?.message} />
              </div>
            </SettingRow>
          </SettingGroup>
          {!allLocked && (
            <div className="mt-4 flex justify-end border-t pt-4">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving…" : "Save changes"}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function SwitchRow({
  form,
  name,
  locked,
  label,
  description,
}: {
  form: Form;
  name: "secure" | "requireTls" | "allowSelfSigned";
  locked: boolean;
  label: string;
  description: string;
}) {
  const id = `smtp-${name}`;
  return (
    <SettingRow label={label} htmlFor={id} description={description}>
      <div className="flex items-center gap-2">
        {locked && <LockedBadge field={name} />}
        <Controller
          control={form.control}
          name={name}
          render={({ field }) => (
            <Switch
              id={id}
              checked={field.value}
              disabled={locked}
              onCheckedChange={(v) => field.onChange(v)}
            />
          )}
        />
      </div>
    </SettingRow>
  );
}

// Empty means "send it to me". (A union with "" would hide the message behind a generic "Invalid input".)
const testForm = z.object({
  to: z
    .string()
    .trim()
    .refine((v) => v === "" || z.email().safeParse(v).success, "An email address"),
});

/** Connects, signs in and sends one email with the form as it is now — saved or not. */
function TestCard({ settings: s, form }: { settings: EmailSettings; form: Form }) {
  const [sendTest] = useTestSmtpMutation();
  const [result, setResult] = useState<EmailTestResult | null>(null);
  const test = useZodForm(testForm, { defaultValues: { to: "" } });
  const { errors, isSubmitting } = test.formState;
  const { isDirty: dirty } = useFormState({ control: form.control });
  const submit = test.handleSubmit(async ({ to }) => {
    setResult(null);
    const valid = await form.trigger();
    if (!valid) {
      setResult({ sent: false, skipped: true, reason: "Fix the highlighted fields first" });
      return;
    }
    try {
      const config = configOf(form.getValues(), s.locked);
      setResult(await sendTest({ ...(to ? { to } : {}), config }).unwrap());
    } catch (e) {
      setResult({ sent: false, skipped: false, reason: errorMessage(e) });
    }
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Send a test email</CardTitle>
        <CardDescription>
          Connects, signs in and sends one email{" "}
          {dirty ? "with the values above, before you save them" : "with these settings"}, then shows the
          server&apos;s answer.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <form noValidate className="grid gap-1" onSubmit={(e) => void submit(e)}>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              {...controlProps("test-to", errors.to?.message)}
              {...test.register("to")}
              type="email"
              placeholder="Your own address (default)"
              aria-label="Send the test to"
              className="sm:max-w-xs"
            />
            <Button type="submit" variant="outline" disabled={isSubmitting} data-testid="smtp-test">
              <Send /> {isSubmitting ? "Sending…" : "Send test email"}
            </Button>
          </div>
          <FieldError id="test-to" message={errors.to?.message} />
        </form>
        {result && (
          <p
            role="status"
            data-testid="smtp-test-result"
            className={
              result.sent
                ? "flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-400"
                : "flex items-start gap-2 text-sm text-destructive"
            }
          >
            {result.sent ? (
              <CircleCheck className="mt-0.5 size-4 shrink-0" />
            ) : (
              <CircleX className="mt-0.5 size-4 shrink-0" />
            )}
            {result.sent
              ? `Sent to ${result.to}. Check the inbox (and spam).${dirty ? " Save the settings to use them." : ""}`
              : result.skipped
                ? `Not sent: ${result.reason}`
                : `The SMTP server refused it: ${result.reason}`}
          </p>
        )}
        {!s.configured && !result && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Mail className="size-3.5" /> Fill in at least a host and a from address.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
