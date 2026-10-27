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
import type { Key } from "@/lib/i18n/en";
import { useT } from "@/lib/i18n/provider";
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
    hint: "settings3.hintGmail",
  },
  {
    id: "m365",
    label: "Microsoft 365 / Outlook",
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    hint: "settings3.hintM365",
  },
  {
    id: "ses",
    label: "Amazon SES",
    host: "email-smtp.us-east-1.amazonaws.com",
    port: 587,
    secure: false,
    hint: "settings3.hintSes",
  },
  {
    id: "postmark",
    label: "Postmark",
    host: "smtp.postmarkapp.com",
    port: 587,
    secure: false,
    hint: "settings3.hintPostmark",
  },
  {
    id: "mailgun",
    label: "Mailgun",
    host: "smtp.mailgun.org",
    port: 587,
    secure: false,
    hint: "settings3.hintMailgun",
  },
  {
    id: "sendgrid",
    label: "SendGrid",
    host: "smtp.sendgrid.net",
    port: 587,
    secure: false,
    user: "apikey",
    hint: "settings3.hintSendgrid",
  },
  {
    id: "brevo",
    label: "Brevo",
    host: "smtp-relay.brevo.com",
    port: 587,
    secure: false,
    hint: "settings3.hintBrevo",
  },
  {
    id: "resend",
    label: "Resend",
    host: "smtp.resend.com",
    port: 465,
    secure: true,
    user: "resend",
    hint: "settings3.hintResend",
  },
] as const;

type FormValues = z.input<typeof emailSettingsForm>;
type Form = UseFormReturn<FormValues, unknown, z.output<typeof emailSettingsForm>>;

function LockedBadge({ field }: { field: EmailField }) {
  const t = useT();
  return (
    <Badge
      variant="outline"
      className="gap-1 font-mono font-normal text-muted-foreground"
      title={t("settings3.setByEnvVar")}
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
  const t = useT();
  const query = useEmailSettingsQuery(undefined);
  if (query.isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (isForbidden(query.error)) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={Lock}
            title={t("settings3.instanceAdminsOnly")}
            description={t("settings3.smtpConfiguredByInstanceAdmins")}
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
  const t = useT();
  const [updateSettings] = useUpdateEmailSettingsMutation();
  const [preset, setPreset] = useState<string | null>(null);
  // The form is owned by the parent, and the React Compiler memoizes this card on its (stable) props:
  // subscribe here, or validation errors never render.
  const { errors, isSubmitting } = useFormState({ control: form.control });
  const locked = s.locked;
  const allLocked = Object.values(locked).every(Boolean);
  const [port, secure] = useWatch({ control: form.control, name: ["port", "secure"] });
  const hintKey = PRESETS.find((p) => p.id === preset)?.hint;
  const hint = hintKey ? t(hintKey) : undefined;

  const save = (patch: EmailSettingsUpdate) =>
    updateSettings(patch)
      .unwrap()
      .then(() => toast.success(t("settings3.emailSettingsSaved")))
      .catch((e: unknown) => toast.error(t("settings3.notSaved"), { description: errorMessage(e) }));

  const submit = form.handleSubmit(async (d) => {
    const all = configOf(d, locked);
    // Only what changed (the password whenever typed).
    const patch = Object.fromEntries(
      Object.entries(all).filter(([k, v]) => k === "password" || v !== (s as Record<string, unknown>)[k]),
    ) as EmailSettingsUpdate;
    if (!Object.keys(patch).length) {
      toast(t("settings3.nothingToSave"));
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
      ? t("settings3.port465Mismatch")
      : port === 587 && secure
        ? t("settings3.port587Mismatch")
        : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t("settings3.outgoingEmailSmtp")}
          {s.configured ? (
            <Badge variant="secondary" className="ml-auto gap-1.5 font-normal">
              <span className="size-1.5 rounded-full bg-emerald-500" /> {t("settings3.configured")}
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="ml-auto gap-1.5 font-normal"
              data-testid="smtp-not-configured"
            >
              <span className="size-1.5 rounded-full bg-amber-500" /> {t("settings3.notSetUpEmailsSkipped")}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>{t("settings3.smtpCardDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form noValidate onSubmit={(e) => void submit(e)}>
          <SettingGroup>
            {!allLocked && (
              <SettingRow
                label={t("settings3.provider")}
                description={hint ?? t("settings3.providerDescription")}
              >
                <Select
                  items={PRESETS.map((p) => ({ value: p.id, label: p.label }))}
                  value={preset}
                  onValueChange={(v) => applyPreset(v)}
                >
                  <SelectTrigger className="w-full sm:w-72" aria-label={t("settings3.fillInForProvider")}>
                    <SelectValue placeholder={t("settings3.fillInForProviderPlaceholder")} />
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
            <SettingRow label={t("settings3.smtpHost")} htmlFor="smtp-host">
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
              label={t("settings3.port")}
              htmlFor="smtp-port"
              description={t("settings3.portDescription")}
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
              label={t("settings3.useTls")}
              description={t("settings3.useTlsDescription")}
            />
            <SwitchRow
              form={form}
              name="requireTls"
              locked={locked.requireTls}
              label={t("settings3.requireStarttls")}
              description={t("settings3.requireStarttlsDescription")}
            />
            <SwitchRow
              form={form}
              name="allowSelfSigned"
              locked={locked.allowSelfSigned}
              label={t("settings3.allowSelfSigned")}
              description={t("settings3.allowSelfSignedDescription")}
            />
            {portMismatch && (
              <p
                role="status"
                className="flex items-start gap-2 py-3 text-sm text-amber-700 dark:text-amber-400"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {portMismatch}
              </p>
            )}
            <SettingRow label={t("settings3.username")} htmlFor="smtp-user">
              <div className="grid w-full gap-1 sm:w-72">
                <Input id="smtp-user" {...form.register("user")} disabled={locked.user} autoComplete="off" />
                {locked.user && <LockedBadge field="user" />}
              </div>
            </SettingRow>
            <SettingRow
              label={t("settings3.password")}
              htmlFor="smtp-password"
              description={
                s.passwordSet
                  ? t("settings3.passwordSavedDescription")
                  : t("settings3.passwordStoredDescription")
              }
            >
              <div className="grid w-full gap-1 sm:w-72">
                <Input
                  id="smtp-password"
                  type="password"
                  autoComplete="new-password"
                  {...form.register("password")}
                  disabled={locked.password}
                  placeholder={s.passwordSet ? t("settings3.passwordSavedPlaceholder") : ""}
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
                    {t("settings3.removeSavedPassword")}
                  </Button>
                )}
              </div>
            </SettingRow>
            <SettingRow
              label={t("settings3.fromAddress")}
              htmlFor="smtp-from"
              description={t("settings3.fromAddressDescription")}
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
                {isSubmitting ? t("settings3.saving") : t("settings3.saveChanges")}
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
    .refine((v) => v === "" || z.email().safeParse(v).success, "settings3.anEmailAddress" satisfies Key),
});

/** Connects, signs in and sends one email with the form as it is now — saved or not. */
function TestCard({ settings: s, form }: { settings: EmailSettings; form: Form }) {
  const t = useT();
  const [sendTest] = useTestSmtpMutation();
  const [result, setResult] = useState<EmailTestResult | null>(null);
  const test = useZodForm(testForm, { defaultValues: { to: "" } });
  const { errors, isSubmitting } = test.formState;
  const { isDirty: dirty } = useFormState({ control: form.control });
  const submit = test.handleSubmit(async ({ to }) => {
    setResult(null);
    const valid = await form.trigger();
    if (!valid) {
      setResult({ sent: false, skipped: true, reason: t("settings3.fixHighlightedFields") });
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
        <CardTitle>{t("settings3.sendATestEmail")}</CardTitle>
        <CardDescription>
          {dirty ? t("settings3.testDescriptionDirty") : t("settings3.testDescriptionSaved")}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <form noValidate className="grid gap-1" onSubmit={(e) => void submit(e)}>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              {...controlProps("test-to", errors.to?.message)}
              {...test.register("to")}
              type="email"
              placeholder={t("settings3.yourOwnAddressDefault")}
              aria-label={t("settings3.sendTheTestTo")}
              className="sm:max-w-xs"
            />
            <Button type="submit" variant="outline" disabled={isSubmitting} data-testid="smtp-test">
              <Send /> {isSubmitting ? t("settings3.sending") : t("settings3.sendTestEmail")}
            </Button>
          </div>
          <FieldError id="test-to" message={errors.to?.message && t(errors.to.message as Key)} />
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
              ? t(dirty ? "settings3.testSentDirty" : "settings3.testSent", { to: result.to })
              : result.skipped
                ? t("settings3.notSentReason", { reason: result.reason })
                : t("settings3.smtpRefusedReason", { reason: result.reason })}
          </p>
        )}
        {!s.configured && !result && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Mail className="size-3.5" /> {t("settings3.fillInHostAndFrom")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
