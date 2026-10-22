"use client";

import { CircleCheck, CircleX, Lock, Mail, Send } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { NumberInput } from "@/components/number-input";
import { SettingGroup, SettingRow } from "@/components/setting-row";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { emailTest } from "@pinwren/core";
import { Controller } from "react-hook-form";
import { controlProps, FieldError, useZodForm } from "@/components/form";
import type { EmailField, EmailSettings, EmailTestResult } from "@/lib/api";
import { emailSettingsForm } from "@/lib/form-schemas";
import {
  errorMessage,
  isForbidden,
  useEmailSettingsQuery,
  useSendTestEmailMutation,
  useUpdateEmailSettingsMutation,
} from "@/lib/store/api";

const ENV: Record<EmailField, string> = {
  host: "SMTP_HOST",
  port: "SMTP_PORT",
  user: "SMTP_USER",
  password: "SMTP_PASSWORD",
  secure: "SMTP_SECURE",
  from: "EMAIL_FROM",
};

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

const draftOf = (s: EmailSettings) => ({
  host: s.host ?? "",
  port: s.port,
  user: s.user ?? "",
  secure: s.secure,
  from: s.from ?? "",
  password: "",
});

/** Instance SMTP settings (blueprint 06 §3.7): env-set fields are read-only and name their variable. */
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
            description="SMTP is configured by whoever runs this Pinwren server (PINWREN_ADMIN_EMAILS)."
          />
        </CardContent>
      </Card>
    );
  }
  if (!query.data) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  return (
    <div className="grid gap-4">
      <SmtpCard settings={query.data.email} />
      <TestCard configured={query.data.email.configured} />
    </div>
  );
}

function SmtpCard({ settings: s }: { settings: EmailSettings }) {
  const [updateSettings] = useUpdateEmailSettingsMutation();
  // `values`: the form follows the saved settings whenever they (re)load; the password always starts empty.
  const form = useZodForm(emailSettingsForm, { values: draftOf(s) });
  const { errors, isSubmitting } = form.formState;
  const locked = s.locked;
  const allLocked = Object.values(locked).every(Boolean);

  const save = (patch: Record<string, unknown>) =>
    updateSettings(patch)
      .unwrap()
      .then(() => toast.success("Email settings saved"))
      .catch((e: unknown) => toast.error("Not saved", { description: errorMessage(e) }));

  const submit = form.handleSubmit(async (d) => {
    const patch: Record<string, unknown> = {};
    const str = (v: string) => (v.trim() ? v.trim() : null);
    if (!locked.host && str(d.host) !== s.host) patch.host = str(d.host);
    if (!locked.port && (d.port ?? null) !== s.port) patch.port = d.port ?? null;
    if (!locked.user && str(d.user) !== s.user) patch.user = str(d.user);
    if (!locked.secure && d.secure !== s.secure) patch.secure = d.secure;
    if (!locked.from && str(d.from) !== s.from) patch.from = str(d.from);
    if (!locked.password && d.password) patch.password = d.password;
    if (!Object.keys(patch).length) {
      toast("Nothing to save");
      return;
    }
    await save(patch);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Outgoing email
          {s.configured ? (
            <Badge variant="secondary" className="ml-auto gap-1.5 font-normal">
              <span className="size-1.5 rounded-full bg-emerald-500" /> Configured
            </Badge>
          ) : (
            <Badge variant="outline" className="ml-auto gap-1.5 font-normal">
              <span className="size-1.5 rounded-full bg-amber-500" /> Not set up — emails are skipped
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Used for invitations, assignments and reporter replies. Environment variables override these and
          lock them.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form noValidate onSubmit={(e) => void submit(e)}>
          <SettingGroup>
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
            <SettingRow label="Port" htmlFor="smtp-port" description="Usually 587 (STARTTLS) or 465 (TLS).">
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
            <SettingRow
              label="Use TLS"
              htmlFor="smtp-secure"
              description="Connect with TLS from the start (port 465)."
            >
              <div className="flex items-center gap-2">
                {locked.secure && <LockedBadge field="secure" />}
                <Controller
                  control={form.control}
                  name="secure"
                  render={({ field }) => (
                    <Switch
                      id="smtp-secure"
                      checked={field.value}
                      disabled={locked.secure}
                      onCheckedChange={(v) => field.onChange(v)}
                    />
                  )}
                />
              </div>
            </SettingRow>
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
            <SettingRow label="From address" htmlFor="smtp-from" description="Who the emails come from.">
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

function TestCard({ configured }: { configured: boolean }) {
  const [sendTest] = useSendTestEmailMutation();
  const [result, setResult] = useState<EmailTestResult | null>(null);
  const form = useZodForm(emailTest.extend({ to: emailTest.shape.to.or(z.literal("")) }), {
    defaultValues: { to: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async ({ to }) => {
    setResult(null);
    try {
      setResult(await sendTest(to ? { to } : {}).unwrap());
    } catch (e) {
      setResult({ sent: false, skipped: false, reason: errorMessage(e) });
    }
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Send a test email</CardTitle>
        <CardDescription>
          Sends now with the saved settings and shows the server&apos;s answer.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <form noValidate className="grid gap-1" onSubmit={(e) => void submit(e)}>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              {...controlProps("test-to", errors.to?.message)}
              {...form.register("to")}
              type="email"
              placeholder="Your own address (default)"
              aria-label="Send the test to"
              className="sm:max-w-xs"
            />
            <Button type="submit" variant="outline" disabled={isSubmitting}>
              <Send /> {isSubmitting ? "Sending…" : "Send test email"}
            </Button>
          </div>
          <FieldError id="test-to" message={errors.to?.message} />
        </form>
        {result && (
          <p
            role="status"
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
              ? `Sent to ${result.to}. Check the inbox (and spam).`
              : result.skipped
                ? `Not sent: ${result.reason}`
                : `The SMTP server refused it: ${result.reason}`}
          </p>
        )}
        {!configured && !result && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Mail className="size-3.5" /> Set a host and a from address first.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
