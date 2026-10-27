"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { controlProps, Field, FormError, useZodForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { signUp } from "@/lib/auth-client";
import { signUpForm } from "@/lib/form-schemas";
import { useT } from "@/lib/i18n/provider";
import { safeNext, withNext } from "@/lib/next-path";
import { isOriginError, linkClass, useNextParam, useSetupStatus } from "../auth-shared";
import { OtherSignIn, SignInErrorNotice } from "../other-sign-in";

export function SignUpForm() {
  const t = useT();
  const router = useRouter();
  const nextParam = useNextParam();
  const setup = useSetupStatus();
  // The first account on a fresh server administers it (ADR 0021, BugPin model).
  const first = !!setup.data?.needed;
  const invitationOnly = !!setup.data && !setup.data.needed && !setup.data.signupOpen;
  const form = useZodForm(signUpForm, { defaultValues: { name: "", email: "", password: "" } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (v) => {
    const { error } = await signUp.email(v);
    if (error) {
      form.setError("root", {
        message: isOriginError(error.message)
          ? t("other1.originMismatch")
          : (error.message ?? t("other1.couldNotCreateAccount")),
      });
      return;
    }
    // Onboarding offers pending invitations first, then creating a workspace. A deep link (an invitation
    // or an item) goes straight on.
    router.replace(safeNext(nextParam, "/onboarding") as Route);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          {first ? t("other1.createAdminAccount") : t("other1.createYourAccount")}
        </CardTitle>
        <CardDescription className="text-pretty">
          {first ? t("other1.firstAccountDescription") : t("other1.collectFeedbackDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SignInErrorNotice />
        {invitationOnly && (
          <p
            className="mb-4 rounded-lg bg-muted p-3 text-sm text-pretty text-muted-foreground"
            data-testid="invite-only"
          >
            {t("other1.invitationOnlyNotice")}
          </p>
        )}
        <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
          <Field id="name" label={t("other1.name")} error={errors.name?.message}>
            <Input
              {...controlProps("name", errors.name?.message)}
              {...form.register("name")}
              autoComplete="name"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the page exists to sign up; its first field is the only sensible start
              autoFocus
            />
          </Field>
          <Field id="email" label={t("other1.workEmail")} error={errors.email?.message}>
            <Input
              {...controlProps("email", errors.email?.message)}
              {...form.register("email")}
              type="email"
              autoComplete="email"
            />
          </Field>
          <Field
            id="password"
            label={t("other1.password")}
            help={t("other1.atLeast8Chars")}
            error={errors.password?.message}
          >
            <Input
              {...controlProps("password", errors.password?.message, true)}
              {...form.register("password")}
              type="password"
              autoComplete="new-password"
            />
          </Field>
          <FormError message={errors.root?.message} />
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? t("other1.creatingAccount") : t("other1.createAccount")}
          </Button>
          <OtherSignIn mode="sign-up" nextParam={nextParam} />
          {!first && (
            <p className="text-center text-sm text-muted-foreground">
              {t("other1.alreadyHaveAccount")}{" "}
              <Link href={withNext("/sign-in", nextParam) as Route} className={linkClass}>
                {t("other1.signIn")}
              </Link>
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
