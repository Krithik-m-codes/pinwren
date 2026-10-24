"use client";

import { Download, KeyRound, Laptop, LogOut, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CopyButton } from "@/components/copy-button";
import { QrCode } from "@/components/qr-code";
import { timeAgo } from "@/components/feedback-meta";
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
  const form = useZodForm(changePasswordForm, { defaultValues: { current: "", next: "", confirm: "" } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async ({ current, next }) => {
    const { error } = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    });
    if (error) {
      form.setError("root", { message: error.message ?? "Couldn't change your password" });
      return;
    }
    form.reset();
    toast.success("Password changed", { description: "Other devices were signed out." });
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Changing it signs you out everywhere else.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-3 sm:max-w-sm">
          <Field id="pw-current" label="Current password" error={errors.current?.message}>
            <Input
              {...controlProps("pw-current", errors.current?.message)}
              {...form.register("current")}
              type="password"
              autoComplete="current-password"
            />
          </Field>
          <Field id="pw-new" label="New password" error={errors.next?.message}>
            <Input
              {...controlProps("pw-new", errors.next?.message)}
              {...form.register("next")}
              type="password"
              autoComplete="new-password"
            />
          </Field>
          <Field id="pw-confirm" label="Confirm new password" error={errors.confirm?.message}>
            <Input
              {...controlProps("pw-confirm", errors.confirm?.message)}
              {...form.register("confirm")}
              type="password"
              autoComplete="new-password"
            />
          </Field>
          <FormError message={errors.root?.message} />
          <Button type="submit" variant="outline" className="justify-self-start" disabled={isSubmitting}>
            {isSubmitting ? "Changing…" : "Change password"}
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
  return (
    <div className="grid gap-3">
      <ul
        aria-label="Backup codes"
        className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border bg-muted/40 p-3 font-mono text-sm"
      >
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <CopyButton value={codes.join("\n")} label="Copy codes" size="sm" variant="outline" />
        <Button type="button" variant="outline" size="sm" onClick={() => downloadCodes(codes)}>
          <Download /> Download
        </Button>
      </div>
    </div>
  );
}

type Dialogs = "enable" | "disable" | "codes" | null;

export function TwoFactorCard({ enabled }: { enabled: boolean }) {
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
          Two-factor authentication
          {enabled ? (
            <Badge variant="secondary" className="gap-1 font-normal" data-testid="two-factor-on">
              <ShieldCheck className="size-3.5 text-emerald-600" /> On
            </Badge>
          ) : (
            <Badge variant="outline" className="font-normal">
              Off
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Ask for a code from an authenticator app (1Password, Google Authenticator, Authy…) when you sign in.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {enabled ? (
          <>
            <Button variant="outline" onClick={() => setOpen("codes")}>
              <KeyRound /> New backup codes
            </Button>
            <Button variant="ghost" onClick={() => setOpen("disable")}>
              Turn off
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={() => setOpen("enable")}>
            <ShieldCheck /> Turn on
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
  const [setup, setSetup] = useState<{ uri: string; codes: string[] } | null>(null);
  const [verified, setVerified] = useState(false);
  const pw = useZodForm(passwordConfirmForm, { defaultValues: { password: "" } });
  const code = useZodForm(twoFactorCodeForm, { defaultValues: { code: "", trustDevice: false } });

  const start = pw.handleSubmit(async ({ password }) => {
    const { data, error } = await authClient.twoFactor.enable({ password });
    // TOTP is the only method configured (auth.ts), so the answer carries the URI and backup codes.
    if (error || !("totpURI" in data)) {
      pw.setError("root", { message: error?.message ?? "Couldn't start two-factor setup" });
      return;
    }
    setSetup({ uri: data.totpURI, codes: data.backupCodes });
  });
  const confirm = code.handleSubmit(async ({ code: value }) => {
    const { error } = await authClient.twoFactor.verifyTotp({ code: value });
    if (error) {
      code.setError("root", { message: error.message ?? "That code didn't work. Try the next one." });
      return;
    }
    setVerified(true);
  });

  if (!setup) {
    return (
      <form onSubmit={(e) => void start(e)} noValidate className="grid gap-4">
        <DialogHeader>
          <DialogTitle>Turn on two-factor authentication</DialogTitle>
          <DialogDescription>Confirm it&apos;s you first.</DialogDescription>
        </DialogHeader>
        <Field id="tfa-password" label="Password" error={pw.formState.errors.password?.message}>
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
            Cancel
          </Button>
          <Button type="submit" disabled={pw.formState.isSubmitting}>
            {pw.formState.isSubmitting ? "Checking…" : "Continue"}
          </Button>
        </DialogFooter>
      </form>
    );
  }

  if (verified) {
    return (
      <div className="grid gap-4">
        <DialogHeader>
          <DialogTitle>Save your backup codes</DialogTitle>
          <DialogDescription>
            Each code signs you in once if you lose your phone. Keep them somewhere safe: they won&apos;t be
            shown again.
          </DialogDescription>
        </DialogHeader>
        <BackupCodes codes={setup.codes} />
        <DialogFooter>
          <Button
            type="button"
            onClick={() => {
              toast.success("Two-factor authentication is on");
              onDone();
            }}
          >
            Done
          </Button>
        </DialogFooter>
      </div>
    );
  }

  const secret = totpSecret(setup.uri);
  return (
    <form onSubmit={(e) => void confirm(e)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Add Pinwren to your authenticator</DialogTitle>
        <DialogDescription>
          Scan the code with your authenticator app, or add the account by hand with the key below. Then enter
          the code it shows.
        </DialogDescription>
      </DialogHeader>
      <QrCode value={setup.uri} label="QR code for your authenticator app" className="justify-self-center" />
      {secret && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
          <code className="min-w-0 flex-1 font-mono text-sm break-all" data-testid="totp-secret">
            {grouped(secret)}
          </code>
          <CopyButton value={secret} label="Copy key" />
        </div>
      )}
      <a
        href={setup.uri}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        <Smartphone className="size-4" /> Open in an authenticator app
      </a>
      <Field id="tfa-code" label="Code from the app" error={code.formState.errors.code?.message}>
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
          Cancel
        </Button>
        <Button type="submit" disabled={code.formState.isSubmitting}>
          {code.formState.isSubmitting ? "Checking…" : "Turn on"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function DisableTwoFactor({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const form = useZodForm(passwordConfirmForm, { defaultValues: { password: "" } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async ({ password }) => {
    const { error } = await authClient.twoFactor.disable({ password });
    if (error) {
      form.setError("root", { message: error.message ?? "Couldn't turn it off" });
      return;
    }
    toast.success("Two-factor authentication is off");
    onDone();
  });
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Turn off two-factor authentication?</DialogTitle>
        <DialogDescription>Signing in will only need your password again.</DialogDescription>
      </DialogHeader>
      <Field id="tfa-off-password" label="Password" error={errors.password?.message}>
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
          Cancel
        </Button>
        <Button type="submit" variant="destructive" disabled={isSubmitting}>
          {isSubmitting ? "Turning off…" : "Turn off"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function RegenerateCodes({ onDone }: { onDone: () => void }) {
  const [codes, setCodes] = useState<string[] | null>(null);
  const form = useZodForm(passwordConfirmForm, { defaultValues: { password: "" } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async ({ password }) => {
    const { data, error } = await authClient.twoFactor.generateBackupCodes({ password });
    if (error) {
      form.setError("root", { message: error.message ?? "Couldn't make new codes" });
      return;
    }
    setCodes(data.backupCodes);
  });
  if (codes) {
    return (
      <div className="grid gap-4">
        <DialogHeader>
          <DialogTitle>Your new backup codes</DialogTitle>
          <DialogDescription>The old ones no longer work. Keep these somewhere safe.</DialogDescription>
        </DialogHeader>
        <BackupCodes codes={codes} />
        <DialogFooter>
          <Button type="button" onClick={onDone}>
            Done
          </Button>
        </DialogFooter>
      </div>
    );
  }
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Make new backup codes</DialogTitle>
        <DialogDescription>The codes you have now stop working.</DialogDescription>
      </DialogHeader>
      <Field id="codes-password" label="Password" error={errors.password?.message}>
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
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Working…" : "Make new codes"}
        </Button>
      </DialogFooter>
    </form>
  );
}

// --- Signed-in devices -------------------------------------------------------------------------------

/** "Chrome on Windows" from a user agent (best effort; unknown parts are left out). */
export function describeAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
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
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? "Unknown device";
}

const isMobile = (ua: string | null | undefined) =>
  !!ua && ["Mobile", "iPhone", "Android"].some((p) => ua.includes(p));

export function SessionsCard() {
  const q = useSessionsQuery(undefined);
  const [revoke] = useRevokeSessionMutation();
  const [revokeOthers, othersState] = useRevokeOtherSessionsMutation();
  const sessions = q.data?.sessions ?? [];
  const others = sessions.filter((s) => s.id !== q.data?.currentId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Where you&apos;re signed in</CardTitle>
        <CardDescription>
          Sign out a device you don&apos;t recognise, or every other one at once.
        </CardDescription>
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
          <EmptyState icon={Laptop} title="No active sessions" className="py-6" />
        )}
        {sessions.length > 0 && (
          <ul className="-my-1 divide-y" aria-label="Sessions">
            {sessions.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                current={s.id === q.data?.currentId}
                onRevoke={() =>
                  revoke(s.token)
                    .unwrap()
                    .then(() => toast.success("Signed out that device"))
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
                .then(() => toast.success("Signed out everywhere else"))
                .catch((e: unknown) => toast.error(errorMessage(e)))
            }
          >
            <LogOut /> {othersState.isLoading ? "Signing out…" : "Sign out all other devices"}
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
  const Icon = isMobile(s.userAgent) ? Smartphone : Laptop;
  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5" data-session={current ? "current" : "other"}>
      <span className="grid size-8 place-items-center rounded-full bg-muted">
        <Icon className="size-4 text-muted-foreground" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {describeAgent(s.userAgent)}{" "}
          {current && (
            <Badge variant="secondary" className="ml-1 font-normal">
              This device
            </Badge>
          )}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {s.ipAddress ? `${s.ipAddress} · ` : ""}signed in {timeAgo(s.createdAt)}
        </p>
      </div>
      {!current && (
        <Button variant="ghost" size="sm" onClick={onRevoke}>
          Sign out
        </Button>
      )}
    </li>
  );
}

// --- Delete account ----------------------------------------------------------------------------------

export function DeleteAccountCard() {
  const [open, setOpen] = useState(false);
  const form = useZodForm(passwordConfirmForm, { defaultValues: { password: "" } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async ({ password }) => {
    const { error } = await authClient.deleteUser({ password });
    if (error) {
      form.setError("root", { message: error.message ?? "Couldn't delete your account" });
      return;
    }
    // A full load: the store and the router cache belong to the account that's gone.
    window.location.assign(new URL("/sign-in", window.location.href).href);
  });
  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle>Delete account</CardTitle>
        <CardDescription className="text-pretty">
          Removes your account and signs you out everywhere. Your comments stay, without your name. A
          workspace only you are in is deleted with it; one you own with others has to be handed over first
          (Settings › Workspace).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          <Trash2 /> Delete my account
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
              <DialogTitle>Delete your account?</DialogTitle>
              <DialogDescription>
                This can&apos;t be undone. Enter your password to confirm.
              </DialogDescription>
            </DialogHeader>
            <Field id="delete-password" label="Password" error={errors.password?.message}>
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
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={isSubmitting}>
                {isSubmitting ? "Deleting…" : "Delete account"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
