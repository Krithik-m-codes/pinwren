"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ButtonLink } from "@/components/button-link";
import { controlProps, Field, FormError, useZodForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { resetPasswordForm } from "@/lib/account-forms";
import { authClient } from "@/lib/auth-client";
import { useT } from "@/lib/i18n/provider";
import { useMounted } from "@/lib/use-synced-state";
import { linkClass, useSearchParam } from "../auth-shared";

/**
 * Choose a new password from a reset link: an emailed one (Better Auth checks the token, then lands here
 * with `?token=`, or `?error=INVALID_TOKEN`) or one an administrator copied from Settings › Users.
 * Every device is signed out afterwards.
 */
export function ResetPasswordForm() {
  const t = useT();
  const mounted = useMounted();
  const token = useSearchParam("token");
  const linkError = useSearchParam("error");
  const [done, setDone] = useState(false);
  const form = useZodForm(resetPasswordForm, { defaultValues: { password: "", confirm: "" } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async ({ password }) => {
    if (!token) return;
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    if (error) {
      form.setError("root", {
        message: /token/i.test(error.message ?? "")
          ? t("other1.resetLinkExpired")
          : (error.message ?? t("other1.couldntChangePassword")),
      });
      return;
    }
    setDone(true);
  });

  if (!mounted) {
    return (
      <Card>
        <CardContent className="space-y-3 py-6">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!token || linkError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <CircleAlert className="size-5 text-destructive" /> {t("other1.linkCantBeUsed")}
          </CardTitle>
          <CardDescription className="text-pretty">{t("other1.resetLinksWorkOnce")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <ButtonLink href="/forgot-password">{t("other1.getNewLink")}</ButtonLink>
          <p className="text-center text-sm text-muted-foreground">
            <Link href="/sign-in" className={linkClass}>
              {t("other1.backToSignIn")}
            </Link>
          </p>
        </CardContent>
      </Card>
    );
  }

  if (done) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <CircleCheck className="size-5 text-primary" /> {t("other1.passwordChanged")}
          </CardTitle>
          <CardDescription>{t("other1.signedOutEverywhere")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ButtonLink href="/sign-in" className="w-full">
            {t("other1.signIn")}
          </ButtonLink>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("other1.chooseNewPassword")}</CardTitle>
        <CardDescription>{t("other1.chooseNewPasswordHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
          <Field id="new-password" label={t("other1.newPassword")} error={errors.password?.message}>
            <Input
              {...controlProps("new-password", errors.password?.message)}
              {...form.register("password")}
              type="password"
              autoComplete="new-password"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the page exists to set this one password
              autoFocus
            />
          </Field>
          <Field id="confirm-password" label={t("other1.confirmNewPassword")} error={errors.confirm?.message}>
            <Input
              {...controlProps("confirm-password", errors.confirm?.message)}
              {...form.register("confirm")}
              type="password"
              autoComplete="new-password"
            />
          </Field>
          <FormError message={errors.root?.message} />
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? t("other1.saving") : t("other1.setNewPassword")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
