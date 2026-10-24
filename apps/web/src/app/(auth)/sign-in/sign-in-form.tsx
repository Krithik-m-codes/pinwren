"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Controller } from "react-hook-form";
import { controlProps, Field, FormError, useZodForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { twoFactorCodeForm } from "@/lib/account-forms";
import { authClient, signIn } from "@/lib/auth-client";
import { signInForm } from "@/lib/form-schemas";
import { withNext } from "@/lib/next-path";
import { isOriginError, linkClass, useNextParam, useNextPath, useSetupStatus } from "../auth-shared";
import { EmailLinkStep, OtherSignIn, SignInErrorNotice } from "../other-sign-in";

const ORIGIN_MESSAGE = "This page isn't open on the address the server expects. See the note above.";

/** Prerendered page; only the submit talks to the server. Asks for a second factor when the account has one. */
export function SignInForm() {
  const router = useRouter();
  const next = useNextPath();
  const nextParam = useNextParam();
  const setup = useSetupStatus();
  const [step, setStep] = useState<"password" | "code" | "link">("password");
  const form = useZodForm(signInForm, { defaultValues: { email: "", password: "" } });
  const { errors, isSubmitting } = form.formState;

  // A fresh server has no account yet: the first one is created on the sign-up page (and administers it).
  useEffect(() => {
    if (setup.data?.needed) router.replace(withNext("/sign-up", nextParam) as Route);
  }, [setup.data?.needed, nextParam, router]);

  const submit = form.handleSubmit(async (v) => {
    const { data, error } = await signIn.email(v);
    if (error) {
      form.setError("root", {
        message: isOriginError(error.message) ? ORIGIN_MESSAGE : (error.message ?? "Could not sign in"),
      });
      return;
    }
    if ("twoFactorRedirect" in data && data.twoFactorRedirect) {
      setStep("code");
      return;
    }
    router.replace(next as Route);
  });

  if (step === "code") return <TwoFactorStep onDone={() => router.replace(next as Route)} />;
  if (step === "link") return <EmailLinkStep nextParam={nextParam} onBack={() => setStep("password")} />;

  const signupOpen = setup.data?.signupOpen ?? true;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Welcome back</CardTitle>
        <CardDescription>Sign in to triage your feedback.</CardDescription>
      </CardHeader>
      <CardContent>
        <SignInErrorNotice />
        <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
          <Field id="email" label="Email" error={errors.email?.message}>
            <Input
              {...controlProps("email", errors.email?.message)}
              {...form.register("email")}
              type="email"
              autoComplete="email"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the page exists to sign in; its first field is the only sensible start
              autoFocus
            />
          </Field>
          <Field id="password" label="Password" error={errors.password?.message}>
            <Input
              {...controlProps("password", errors.password?.message)}
              {...form.register("password")}
              type="password"
              autoComplete="current-password"
            />
          </Field>
          <Link
            href={withNext("/forgot-password", nextParam) as Route}
            className="-mt-2 justify-self-end text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Forgot password?
          </Link>
          <FormError message={errors.root?.message} />
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? "Signing in…" : "Sign in"}
          </Button>
          <OtherSignIn mode="sign-in" nextParam={nextParam} onEmailLink={() => setStep("link")} />
          {signupOpen ? (
            <p className="text-center text-sm text-muted-foreground">
              New here?{" "}
              <Link href={withNext("/sign-up", nextParam) as Route} className={linkClass}>
                Create an account
              </Link>
            </p>
          ) : (
            <p className="text-center text-sm text-pretty text-muted-foreground">
              New here? Accounts on this server are by invitation: use the link in your invitation email, or
              ask an administrator to add you.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

/** Second step: a code from the authenticator app, or one of the backup codes. */
function TwoFactorStep({ onDone }: { onDone: () => void }) {
  const [backup, setBackup] = useState(false);
  const form = useZodForm(twoFactorCodeForm, { defaultValues: { code: "", trustDevice: false } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async ({ code, trustDevice }) => {
    const { error } = backup
      ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
      : await authClient.twoFactor.verifyTotp({ code, trustDevice });
    if (error) {
      form.setError("root", { message: error.message ?? "That code didn't work" });
      return;
    }
    onDone();
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Two-factor authentication</CardTitle>
        <CardDescription>
          {backup
            ? "Enter one of the backup codes you saved when you turned on two-factor authentication."
            : "Enter the 6-digit code from your authenticator app."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
          <Field id="code" label={backup ? "Backup code" : "Code"} error={errors.code?.message}>
            <Input
              {...controlProps("code", errors.code?.message)}
              {...form.register("code")}
              key={backup ? "backup" : "totp"}
              autoComplete="one-time-code"
              inputMode={backup ? "text" : "numeric"}
              spellCheck={false}
              className="font-mono tracking-widest"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the step exists to take this one code
              autoFocus
            />
          </Field>
          <Controller
            control={form.control}
            name="trustDevice"
            render={({ field }) => (
              <label htmlFor="trust-device" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  id="trust-device"
                  checked={field.value}
                  onCheckedChange={(v) => field.onChange(v)}
                />
                Trust this device for 30 days
              </label>
            )}
          />
          <FormError message={errors.root?.message} />
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? "Checking…" : "Verify"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setBackup((b) => !b);
              form.reset({ code: "", trustDevice: form.getValues("trustDevice") });
            }}
          >
            {backup ? "Use the authenticator app instead" : "Use a backup code instead"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
