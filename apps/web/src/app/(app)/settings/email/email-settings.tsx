"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleX, Lock, Mail, Send } from "lucide-react";
import { useEffect, useState } from "react";
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
import { api, type EmailField, type EmailSettings, type EmailTestResult, isForbidden } from "@/lib/api";
import { emailSettingsKey, useEmailSettings } from "../settings-shell";

const ENV: Record<EmailField, string> = {
  host: "SMTP_HOST",
  port: "SMTP_PORT",
  user: "SMTP_USER",
  password: "SMTP_PASSWORD",
  secure: "SMTP_SECURE",
  from: "EMAIL_FROM",
};

type Draft = {
  host: string;
  port: number | null;
  user: string;
  secure: boolean;
  from: string;
  password: string;
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

/** Instance SMTP settings (blueprint 06 §3.7): env-set fields are read-only and name their variable. */
export function EmailSettingsForm() {
  const qc = useQueryClient();
  const query = useEmailSettings();
  const s = query.data?.email;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [testTo, setTestTo] = useState("");
  const [result, setResult] = useState<EmailTestResult | null>(null);
  const [errors, setErrors] = useState<Partial<Record<EmailField, string>>>({});

  useEffect(() => {
    if (s)
      setDraft({
        host: s.host ?? "",
        port: s.port,
        user: s.user ?? "",
        secure: s.secure,
        from: s.from ?? "",
        password: "",
      });
  }, [s]);

  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api<{ email: EmailSettings }>("/admin/settings/email", { method: "PATCH", json: patch }),
    onSuccess: ({ email }) => {
      qc.setQueryData(emailSettingsKey, { email });
      toast.success("Email settings saved");
    },
    onError: (e) => toast.error("Not saved", { description: e.message }),
  });
  const test = useMutation({
    mutationFn: () =>
      api<EmailTestResult>("/admin/settings/email/test", {
        method: "POST",
        json: testTo.trim() ? { to: testTo.trim() } : {},
      }),
    onSuccess: setResult,
    onError: (e) => setResult({ sent: false, skipped: false, reason: e.message }),
  });

  if (query.isPending || (s && !draft)) {
    return <Skeleton className="h-96 rounded-xl" />;
  }
  if (isForbidden(query.error)) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={Lock}
            title="Instance admins only"
            description="SMTP is configured by whoever runs this Annota server (ANNOTA_ADMIN_EMAILS)."
          />
        </CardContent>
      </Card>
    );
  }
  if (query.isError || !s || !draft) return <ErrorState error={query.error} retry={() => query.refetch()} />;

  const locked = s.locked;
  const allLocked = Object.values(locked).every(Boolean);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!s || !draft) return;
    const next: Partial<Record<EmailField, string>> = {};
    if (draft.host && !/^[a-z0-9.-]+$/i.test(draft.host.trim()))
      next.host = "A hostname like smtp.example.com";
    if (draft.from && !/\S+@\S+\.\S+/.test(draft.from))
      next.from = "An address like Annota <noreply@example.com>";
    setErrors(next);
    if (Object.keys(next).length) return;
    const patch: Record<string, unknown> = {};
    const str = (v: string) => (v.trim() ? v.trim() : null);
    if (!locked.host && str(draft.host) !== s.host) patch.host = str(draft.host);
    if (!locked.port && draft.port !== s.port) patch.port = draft.port;
    if (!locked.user && str(draft.user) !== s.user) patch.user = str(draft.user);
    if (!locked.secure && draft.secure !== s.secure) patch.secure = draft.secure;
    if (!locked.from && str(draft.from) !== s.from) patch.from = str(draft.from);
    if (!locked.password && draft.password) patch.password = draft.password;
    if (!Object.keys(patch).length) return toast("Nothing to save");
    save.mutate(patch, { onSuccess: () => setDraft((d) => (d ? { ...d, password: "" } : d)) });
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  return (
    <div className="grid gap-4">
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
          <form onSubmit={submit}>
            <SettingGroup>
              <SettingRow label="SMTP host" htmlFor="smtp-host">
                <div className="grid w-full gap-1 sm:w-72">
                  <Input
                    id="smtp-host"
                    value={draft.host}
                    disabled={locked.host}
                    placeholder="smtp.example.com"
                    aria-invalid={!!errors.host || undefined}
                    onChange={(e) => set("host", e.target.value)}
                  />
                  {locked.host && <LockedBadge field="host" />}
                  {errors.host && <p className="text-xs text-destructive">{errors.host}</p>}
                </div>
              </SettingRow>
              <SettingRow label="Port" htmlFor="smtp-port" description="Usually 587 (STARTTLS) or 465 (TLS).">
                <div className="grid w-full gap-1 sm:w-72">
                  <NumberInput
                    id="smtp-port"
                    className="w-32"
                    value={draft.port}
                    allowEmpty
                    placeholder={draft.secure ? "465" : "587"}
                    min={1}
                    max={65535}
                    disabled={locked.port}
                    onChange={(n) => set("port", n)}
                    onCommit={(n) => set("port", n)}
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
                  <Switch
                    id="smtp-secure"
                    checked={draft.secure}
                    disabled={locked.secure}
                    onCheckedChange={(v) => set("secure", v)}
                  />
                </div>
              </SettingRow>
              <SettingRow label="Username" htmlFor="smtp-user">
                <div className="grid w-full gap-1 sm:w-72">
                  <Input
                    id="smtp-user"
                    value={draft.user}
                    disabled={locked.user}
                    autoComplete="off"
                    onChange={(e) => set("user", e.target.value)}
                  />
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
                    value={draft.password}
                    disabled={locked.password}
                    placeholder={s.passwordSet ? "••••••••  (saved)" : ""}
                    onChange={(e) => set("password", e.target.value)}
                  />
                  {locked.password && <LockedBadge field="password" />}
                  {s.passwordSet && !locked.password && (
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      className="justify-self-start text-muted-foreground"
                      onClick={() => save.mutate({ password: null })}
                    >
                      Remove saved password
                    </Button>
                  )}
                </div>
              </SettingRow>
              <SettingRow label="From address" htmlFor="smtp-from" description="Who the emails come from.">
                <div className="grid w-full gap-1 sm:w-72">
                  <Input
                    id="smtp-from"
                    value={draft.from}
                    disabled={locked.from}
                    placeholder="Annota <noreply@example.com>"
                    aria-invalid={!!errors.from || undefined}
                    onChange={(e) => set("from", e.target.value)}
                  />
                  {locked.from && <LockedBadge field="from" />}
                  {errors.from && <p className="text-xs text-destructive">{errors.from}</p>}
                </div>
              </SettingRow>
            </SettingGroup>
            {!allLocked && (
              <div className="mt-4 flex justify-end border-t pt-4">
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? "Saving…" : "Save changes"}
                </Button>
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Send a test email</CardTitle>
          <CardDescription>
            Sends now with the saved settings and shows the server&apos;s answer.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <form
            noValidate
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              setResult(null);
              test.mutate();
            }}
          >
            <Input
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="Your own address (default)"
              aria-label="Send the test to"
              className="sm:max-w-xs"
            />
            <Button type="submit" variant="outline" disabled={test.isPending}>
              <Send /> {test.isPending ? "Sending…" : "Send test email"}
            </Button>
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
          {!s.configured && !result && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Mail className="size-3.5" /> Set a host and a from address first.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
