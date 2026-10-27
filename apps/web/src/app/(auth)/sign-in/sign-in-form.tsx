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
import { useT } from "@/lib/i18n/provider";
import { withNext } from "@/lib/next-path";
import { isOriginError, linkClass, useNextParam, useNextPath, useSetupStatus } from "../auth-shared";
import { EmailLinkStep, OtherSignIn, SignInErrorNotice } from "../other-sign-in";

/** Prerendered page; only the submit talks to the server. Asks for a second factor when the account has one. */
export function SignInForm() {
  const t = useT();
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
        message: isOriginError(error.message)
          ? t("other1.originMismatch")
          : (error.message ?? t("other1.couldNotSignIn")),
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
        <CardTitle className="text-xl">{t("other1.welcomeBack")}</CardTitle>
        <CardDescription>{t("other1.signInToTriage")}</CardDescription>
      </CardHeader>
      <CardContent>
        <SignInErrorNotice />
        <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
          <Field id="email" label={t("other1.email")} error={errors.email?.message}>
            <Input
              {...controlProps("email", errors.email?.message)}
              {...form.register("email")}
              type="email"
              autoComplete="email"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the page exists to sign in; its first field is the only sensible start
              autoFocus
            />
          </Field>
          <Field id="password" label={t("other1.password")} error={errors.password?.message}>
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
            {t("other1.forgotPassword")}
          </Link>
          <FormError message={errors.root?.message} />
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? t("other1.signingIn") : t("other1.signIn")}
          </Button>
          <OtherSignIn mode="sign-in" nextParam={nextParam} onEmailLink={() => setStep("link")} />
          {signupOpen ? (
            <p className="text-center text-sm text-muted-foreground">
              {t("other1.newHere")}{" "}
              <Link href={withNext("/sign-up", nextParam) as Route} className={linkClass}>
                {t("other1.createAnAccount")}
              </Link>
            </p>
          ) : (
            <p className="text-center text-sm text-pretty text-muted-foreground">
              {t("other1.newHereInvitationOnly")}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

/** Second step: a code from the authenticator app, or one of the backup codes. */
function TwoFactorStep({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [backup, setBackup] = useState(false);
  const form = useZodForm(twoFactorCodeForm, { defaultValues: { code: "", trustDevice: false } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async ({ code, trustDevice }) => {
    const { error } = backup
      ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
      : await authClient.twoFactor.verifyTotp({ code, trustDevice });
    if (error) {
      form.setError("root", { message: error.message ?? t("other1.thatCodeDidntWork") });
      return;
    }
    onDone();
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("other1.twoFactorTitle")}</CardTitle>
        <CardDescription>
          {backup ? t("other1.twoFactorBackupHint") : t("other1.twoFactorCodeHint")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
          <Field
            id="code"
            label={backup ? t("other1.backupCode") : t("other1.code")}
            error={errors.code?.message}
          >
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
                {t("other1.trustDevice")}
              </label>
            )}
          />
          <FormError message={errors.root?.message} />
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? t("other1.checking") : t("other1.verify")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setBackup((b) => !b);
              form.reset({ code: "", trustDevice: form.getValues("trustDevice") });
            }}
          >
            {backup ? t("other1.useAuthenticatorInstead") : t("other1.useBackupCodeInstead")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
