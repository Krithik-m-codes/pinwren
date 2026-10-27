"use client";

import { Download, KeyRound, Laptop, LogOut, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CopyButton } from "@/components/copy-button";
import { QrCode } from "@/components/qr-code";
import { useTimeAgo } from "@/components/feedback-meta";
import { controlProps, Field, FormError, useZodForm } from "@/components/form";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { passwordConfirmForm, twoFactorCodeForm } from "@/lib/account-forms";
import { authClient } from "@/lib/auth-client";
import { changePasswordForm } from "@/lib/form-schemas";
import type { TFn } from "@/lib/i18n/english";
import { useT } from "@/lib/i18n/provider";
import { errorMessage, useMeQuery } from "@/lib/store/api";
import {
  type AccountSession,
  useRevokeOtherSessionsMutation,
  useRevokeSessionMutation,
  useSessionsQuery,
} from "@/lib/store/api/people";

// How you sign in (Settings › Profile): password, two-factor authentication, signed-in devices and
// deleting the account. Every action goes through Better Auth's own endpoints.

export function PasswordCard() {
  const t = useT();
  const form = useZodForm(changePasswordForm, { defaultValues: { current: "", next: "", confirm: "" } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async ({ current, next }) => {
    const { error } = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    });
    if (error) {
      form.setError("root", { message: error.message ?? t("settings2.couldntChangePassword") });
      return;
    }
    form.reset();
    toast.success(t("settings2.passwordChanged"), { description: t("settings2.otherDevicesSignedOut") });
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings2.password")}</CardTitle>
        <CardDescription>{t("settings2.changingSignsOut")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-3 sm:max-w-sm">
          <Field id="pw-current" label={t("settings2.currentPassword")} error={errors.current?.message}>
            <Input
              {...controlProps("pw-current", errors.current?.message)}
              {...form.register("current")}
              type="password"
              autoComplete="current-password"
            />
          </Field>
          <Field id="pw-new" label={t("settings2.newPassword")} error={errors.next?.message}>
            <Input
              {...controlProps("pw-new", errors.next?.message)}
              {...form.register("next")}
              type="password"
              autoComplete="new-password"
            />
          </Field>
          <Field id="pw-confirm" label={t("settings2.confirmNewPassword")} error={errors.confirm?.message}>
            <Input
              {...controlProps("pw-confirm", errors.confirm?.message)}
              {...form.register("confirm")}
              type="password"
              autoComplete="new-password"
            />
          </Field>
          <FormError message={errors.root?.message} />
          <Button type="submit" variant="outline" className="justify-self-start" disabled={isSubmitting}>
            {isSubmitting ? t("settings2.changing") : t("settings2.changePassword")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// --- Two-factor authentication ----------------------------------------------------------------------

/** The base32 secret inside an `otpauth://` URI, for typing into an authenticator app by hand. */
export function totpSecret(uri: string): string | null {
  try {
    return new URL(uri).searchParams.get("secret");
  } catch {
    return null;
  }
}

/** Groups of four, as authenticator apps show them. */
const grouped = (secret: string) => secret.replace(/(.{4})(?=.)/g, "$1 ");

function downloadCodes(codes: string[]) {
  const blob = new Blob([`Pinwren backup codes\n\n${codes.join("\n")}\n`], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "pinwren-backup-codes.txt";
  a.click();
  URL.revokeObjectURL(a.href);
}

function BackupCodes({ codes }: { codes: string[] }) {
  const t = useT();
  return (
    <div className="grid gap-3">
      <ul
        aria-label={t("settings2.backupCodes")}
        className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border bg-muted/40 p-3 font-mono text-sm"
      >
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <CopyButton value={codes.join("\n")} label={t("settings2.copyCodes")} size="sm" variant="outline" />
        <Button type="button" variant="outline" size="sm" onClick={() => downloadCodes(codes)}>
          <Download /> {t("settings2.download")}
        </Button>
      </div>
    </div>
  );
}

type Dialogs = "enable" | "disable" | "codes" | null;

export function TwoFactorCard({ enabled }: { enabled: boolean }) {
  const t = useT();
  const me = useMeQuery(undefined);
  const [open, setOpen] = useState<Dialogs>(null);
  const done = () => {
    setOpen(null);
    void authClient.getSession({ query: { disableCookieCache: true } }).then(() => me.refetch());
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t("settings2.twoFactorAuth")}
          {enabled ? (
            <Badge variant="secondary" className="gap-1 font-normal" data-testid="two-factor-on">
              <ShieldCheck className="size-3.5 text-emerald-600" /> {t("settings2.on")}
            </Badge>
          ) : (
            <Badge variant="outline" className="font-normal">
              {t("settings2.off")}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>{t("settings2.twoFactorDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {enabled ? (
          <>
            <Button variant="outline" onClick={() => setOpen("codes")}>
              <KeyRound /> {t("settings2.newBackupCodes")}
            </Button>
            <Button variant="ghost" onClick={() => setOpen("disable")}>
              {t("settings2.turnOff")}
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={() => setOpen("enable")}>
            <ShieldCheck /> {t("settings2.turnOn")}
          </Button>
        )}
      </CardContent>
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-md">
          {open === "enable" && <EnableTwoFactor onDone={done} onCancel={() => setOpen(null)} />}
          {open === "disable" && <DisableTwoFactor onDone={done} onCancel={() => setOpen(null)} />}
          {open === "codes" && <RegenerateCodes onDone={() => setOpen(null)} />}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** Password → scan (or type) the secret and confirm a code → save the backup codes. */
function EnableTwoFactor({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const [setup, setSetup] = useState<{ uri: string; codes: string[] } | null>(null);
  const [verified, setVerified] = useState(false);
  const pw = useZodForm(passwordConfirmForm, { defaultValues: { password: "" } });
  const code = useZodForm(twoFactorCodeForm, { defaultValues: { code: "", trustDevice: false } });

  const start = pw.handleSubmit(async ({ password }) => {
    const { data, error } = await authClient.twoFactor.enable({ password });
    // TOTP is the only method configured (auth.ts), so the answer carries the URI and backup codes.
    if (error || !("totpURI" in data)) {
      pw.setError("root", { message: error?.message ?? t("settings2.couldntStartTwoFactor") });
      return;
    }
    setSetup({ uri: data.totpURI, codes: data.backupCodes });
  });
  const confirm = code.handleSubmit(async ({ code: value }) => {
    const { error } = await authClient.twoFactor.verifyTotp({ code: value });
    if (error) {
      code.setError("root", { message: error.message ?? t("settings2.codeDidntWork") });
      return;
    }
    setVerified(true);
  });

  if (!setup) {
    return (
      <form onSubmit={(e) => void start(e)} noValidate className="grid gap-4">
        <DialogHeader>
          <DialogTitle>{t("settings2.turnOnTwoFactor")}</DialogTitle>
          <DialogDescription>{t("settings2.confirmItsYou")}</DialogDescription>
        </DialogHeader>
        <Field
          id="tfa-password"
          label={t("settings2.password")}
          error={pw.formState.errors.password?.message}
        >
          <Input
            {...controlProps("tfa-password", pw.formState.errors.password?.message)}
            {...pw.register("password")}
            type="password"
            autoComplete="current-password"
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog's only field
            autoFocus
          />
        </Field>
        <FormError message={pw.formState.errors.root?.message} />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("settings2.cancel")}
          </Button>
          <Button type="submit" disabled={pw.formState.isSubmitting}>
            {pw.formState.isSubmitting ? t("settings2.checking") : t("settings2.continue")}
          </Button>
        </DialogFooter>
      </form>
    );
  }

  if (verified) {
    return (
      <div className="grid gap-4">
        <DialogHeader>
          <DialogTitle>{t("settings2.saveBackupCodes")}</DialogTitle>
          <DialogDescription>{t("settings2.saveBackupCodesDesc")}</DialogDescription>
        </DialogHeader>
        <BackupCodes codes={setup.codes} />
        <DialogFooter>
          <Button
            type="button"
            onClick={() => {
              toast.success(t("settings2.twoFactorIsOn"));
              onDone();
            }}
          >
            {t("settings2.done")}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  const secret = totpSecret(setup.uri);
  return (
    <form onSubmit={(e) => void confirm(e)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t("settings2.addToAuthenticator")}</DialogTitle>
        <DialogDescription>{t("settings2.addToAuthenticatorDesc")}</DialogDescription>
      </DialogHeader>
      <QrCode value={setup.uri} label={t("settings2.qrLabel")} className="justify-self-center" />
      {secret && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
          <code className="min-w-0 flex-1 font-mono text-sm break-all" data-testid="totp-secret">
            {grouped(secret)}
          </code>
          <CopyButton value={secret} label={t("settings2.copyKey")} />
        </div>
      )}
      <a
        href={setup.uri}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        <Smartphone className="size-4" /> {t("settings2.openInAuthenticator")}
      </a>
      <Field id="tfa-code" label={t("settings2.codeFromApp")} error={code.formState.errors.code?.message}>
        <Input
          {...controlProps("tfa-code", code.formState.errors.code?.message)}
          {...code.register("code")}
          autoComplete="one-time-code"
          inputMode="numeric"
          className="font-mono tracking-widest"
        />
      </Field>
      <FormError message={code.formState.errors.root?.message} />
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("settings2.cancel")}
        </Button>
        <Button type="submit" disabled={code.formState.isSubmitting}>
          {code.formState.isSubmitting ? t("settings2.checking") : t("settings2.turnOn")}
        </Button>
      </DialogFooter>
    </form>
  );
}

function DisableTwoFactor({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const form = useZodForm(passwordConfirmForm, { defaultValues: { password: "" } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async ({ password }) => {
    const { error } = await authClient.twoFactor.disable({ password });
    if (error) {
      form.setError("root", { message: error.message ?? t("settings2.couldntTurnOff") });
      return;
    }
    toast.success(t("settings2.twoFactorIsOff"));
    onDone();
  });
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t("settings2.turnOffTwoFactorQ")}</DialogTitle>
        <DialogDescription>{t("settings2.turnOffDesc")}</DialogDescription>
      </DialogHeader>
      <Field id="tfa-off-password" label={t("settings2.password")} error={errors.password?.message}>
        <Input
          {...controlProps("tfa-off-password", errors.password?.message)}
          {...form.register("password")}
          type="password"
          autoComplete="current-password"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog's only field
          autoFocus
        />
      </Field>
      <FormError message={errors.root?.message} />
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("settings2.cancel")}
        </Button>
        <Button type="submit" variant="destructive" disabled={isSubmitting}>
          {isSubmitting ? t("settings2.turningOff") : t("settings2.turnOff")}
        </Button>
      </DialogFooter>
    </form>
  );
}

function RegenerateCodes({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [codes, setCodes] = useState<string[] | null>(null);
  const form = useZodForm(passwordConfirmForm, { defaultValues: { password: "" } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async ({ password }) => {
    const { data, error } = await authClient.twoFactor.generateBackupCodes({ password });
    if (error) {
      form.setError("root", { message: error.message ?? t("settings2.couldntMakeCodes") });
      return;
    }
    setCodes(data.backupCodes);
  });
  if (codes) {
    return (
      <div className="grid gap-4">
        <DialogHeader>
          <DialogTitle>{t("settings2.yourNewBackupCodes")}</DialogTitle>
          <DialogDescription>{t("settings2.oldCodesNoLonger")}</DialogDescription>
        </DialogHeader>
        <BackupCodes codes={codes} />
        <DialogFooter>
          <Button type="button" onClick={onDone}>
            {t("settings2.done")}
          </Button>
        </DialogFooter>
      </div>
    );
  }
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t("settings2.makeNewBackupCodes")}</DialogTitle>
        <DialogDescription>{t("settings2.codesStopWorking")}</DialogDescription>
      </DialogHeader>
      <Field id="codes-password" label={t("settings2.password")} error={errors.password?.message}>
        <Input
          {...controlProps("codes-password", errors.password?.message)}
          {...form.register("password")}
          type="password"
          autoComplete="current-password"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog's only field
          autoFocus
        />
      </Field>
      <FormError message={errors.root?.message} />
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("settings2.cancel")}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t("settings2.working") : t("settings2.makeNewCodes")}
        </Button>
      </DialogFooter>
    </form>
  );
}

// --- Signed-in devices -------------------------------------------------------------------------------

/** "Chrome on Windows" from a user agent (best effort; unknown parts are left out). */
export function describeAgent(ua: string | null | undefined, t: TFn): string {
  if (!ua) return t("settings2.unknownDevice");
  const has = (...parts: string[]) => parts.some((p) => ua.includes(p));
  // Order matters: Edge and Opera also say Chrome, Chrome also says Safari, Android also says Linux.
  const browser = has("Edg/")
    ? "Edge"
    : has("OPR/", "Opera")
      ? "Opera"
      : has("Firefox/")
        ? "Firefox"
        : has("Chrome/")
          ? "Chrome"
          : has("Safari/")
            ? "Safari"
            : null;
  const os = has("iPhone", "iPad", "iPod")
    ? "iOS"
    : has("Android")
      ? "Android"
      : has("Windows")
        ? "Windows"
        : has("Mac OS X", "Macintosh")
          ? "macOS"
          : has("Linux")
            ? "Linux"
            : null;
  if (browser && os) return t("settings2.browserOnOs", { browser, os });
  return browser ?? os ?? t("settings2.unknownDevice");
}

const isMobile = (ua: string | null | undefined) =>
  !!ua && ["Mobile", "iPhone", "Android"].some((p) => ua.includes(p));

export function SessionsCard() {
  const t = useT();
  const q = useSessionsQuery(undefined);
  const [revoke] = useRevokeSessionMutation();
  const [revokeOthers, othersState] = useRevokeOtherSessionsMutation();
  const sessions = q.data?.sessions ?? [];
  const others = sessions.filter((s) => s.id !== q.data?.currentId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings2.whereSignedIn")}</CardTitle>
        <CardDescription>{t("settings2.whereSignedInDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {q.isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
          </div>
        )}
        {q.isError && <ErrorState error={q.error} retry={() => void q.refetch()} className="py-6" />}
        {q.data && sessions.length === 0 && (
          <EmptyState icon={Laptop} title={t("settings2.noActiveSessions")} className="py-6" />
        )}
        {sessions.length > 0 && (
          <ul className="-my-1 divide-y" aria-label={t("settings2.sessions")}>
            {sessions.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                current={s.id === q.data?.currentId}
                onRevoke={() =>
                  revoke(s.token)
                    .unwrap()
                    .then(() => toast.success(t("settings2.signedOutThatDevice")))
                    .catch((e: unknown) => toast.error(errorMessage(e)))
                }
              />
            ))}
          </ul>
        )}
        {others.length > 0 && (
          <Button
            variant="outline"
            className="justify-self-start"
            disabled={othersState.isLoading}
            onClick={() =>
              revokeOthers(undefined)
                .unwrap()
                .then(() => toast.success(t("settings2.signedOutElsewhere")))
                .catch((e: unknown) => toast.error(errorMessage(e)))
            }
          >
            <LogOut /> {othersState.isLoading ? t("settings2.signingOut") : t("settings2.signOutAllOther")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function SessionRow({
  session: s,
  current,
  onRevoke,
}: {
  session: AccountSession;
  current: boolean;
  onRevoke: () => void;
}) {
  const t = useT();
  const timeAgo = useTimeAgo();
  const Icon = isMobile(s.userAgent) ? Smartphone : Laptop;
  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5" data-session={current ? "current" : "other"}>
      <span className="grid size-8 place-items-center rounded-full bg-muted">
        <Icon className="size-4 text-muted-foreground" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {describeAgent(s.userAgent, t)}{" "}
          {current && (
            <Badge variant="secondary" className="ml-1 font-normal">
              {t("settings2.thisDevice")}
            </Badge>
          )}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {s.ipAddress
            ? t("settings2.ipSignedIn", { ip: s.ipAddress, time: timeAgo(s.createdAt) })
            : t("settings2.signedInAgo", { time: timeAgo(s.createdAt) })}
        </p>
      </div>
      {!current && (
        <Button variant="ghost" size="sm" onClick={onRevoke}>
          {t("settings2.signOut")}
        </Button>
      )}
    </li>
  );
}

// --- Delete account ----------------------------------------------------------------------------------

export function DeleteAccountCard() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const form = useZodForm(passwordConfirmForm, { defaultValues: { password: "" } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async ({ password }) => {
    const { error } = await authClient.deleteUser({ password });
    if (error) {
      form.setError("root", { message: error.message ?? t("settings2.couldntDeleteAccount") });
      return;
    }
    // A full load: the store and the router cache belong to the account that's gone.
    window.location.assign(new URL("/sign-in", window.location.href).href);
  });
  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle>{t("settings2.deleteAccount")}</CardTitle>
        <CardDescription className="text-pretty">{t("settings2.deleteAccountDesc")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          <Trash2 /> {t("settings2.deleteMyAccount")}
        </Button>
      </CardContent>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) form.reset();
          setOpen(o);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t("settings2.deleteYourAccountQ")}</DialogTitle>
              <DialogDescription>{t("settings2.cantBeUndonePassword")}</DialogDescription>
            </DialogHeader>
            <Field id="delete-password" label={t("settings2.password")} error={errors.password?.message}>
              <Input
                {...controlProps("delete-password", errors.password?.message)}
                {...form.register("password")}
                type="password"
                autoComplete="current-password"
                // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog's only field
                autoFocus
              />
            </Field>
            <FormError message={errors.root?.message} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t("settings2.cancel")}
              </Button>
              <Button type="submit" variant="destructive" disabled={isSubmitting}>
                {isSubmitting ? t("settings2.deleting") : t("settings2.deleteAccount")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
