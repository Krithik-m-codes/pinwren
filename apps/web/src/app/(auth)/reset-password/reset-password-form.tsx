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
import { useMounted } from "@/lib/use-synced-state";
import { linkClass, useSearchParam } from "../auth-shared";

/**
 * Choose a new password from a reset link: an emailed one (Better Auth checks the token, then lands here
 * with `?token=`, or `?error=INVALID_TOKEN`) or one an administrator copied from Settings › Users.
 * Every device is signed out afterwards.
 */
export function ResetPasswordForm() {
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
          ? "This link has expired or was already used. Ask for a new one."
          : (error.message ?? "Couldn't change your password"),
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
            <CircleAlert className="size-5 text-destructive" /> This link can&apos;t be used
          </CardTitle>
          <CardDescription className="text-pretty">
            Reset links work once, for a limited time. Ask for a new one, or ask your administrator.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <ButtonLink href="/forgot-password">Get a new link</ButtonLink>
          <p className="text-center text-sm text-muted-foreground">
            <Link href="/sign-in" className={linkClass}>
              Back to sign in
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
            <CircleCheck className="size-5 text-primary" /> Password changed
          </CardTitle>
          <CardDescription>You were signed out everywhere. Sign in with the new password.</CardDescription>
        </CardHeader>
        <CardContent>
          <ButtonLink href="/sign-in" className="w-full">
            Sign in
          </ButtonLink>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Choose a new password</CardTitle>
        <CardDescription>At least 8 characters. Every device is signed out afterwards.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
          <Field id="new-password" label="New password" error={errors.password?.message}>
            <Input
              {...controlProps("new-password", errors.password?.message)}
              {...form.register("password")}
              type="password"
              autoComplete="new-password"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the page exists to set this one password
              autoFocus
            />
          </Field>
          <Field id="confirm-password" label="Confirm new password" error={errors.confirm?.message}>
            <Input
              {...controlProps("confirm-password", errors.confirm?.message)}
              {...form.register("confirm")}
              type="password"
              autoComplete="new-password"
            />
          </Field>
          <FormError message={errors.root?.message} />
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? "Saving…" : "Set new password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
