"use client";

import { MailCheck, MailX } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";
import { controlProps, Field, FormError, useZodForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { forgotPasswordForm } from "@/lib/account-forms";
import { authClient } from "@/lib/auth-client";
import { withNext } from "@/lib/next-path";
import { linkClass, useNextParam, useSetupStatus } from "../auth-shared";

/**
 * Ask for a reset link. Without SMTP nothing could be sent, so the page says who can help instead: an
 * instance administrator copies a reset link from Settings › Users.
 */
export function ForgotPasswordForm() {
  const nextParam = useNextParam();
  const setup = useSetupStatus();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useZodForm(forgotPasswordForm, { defaultValues: { email: "" } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async ({ email }) => {
    const { error } = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    if (error) {
      form.setError("root", { message: error.message ?? "Couldn't send the link. Try again later." });
      return;
    }
    // The answer is the same whether or not the address has an account (no account discovery).
    setSentTo(email);
  });
  const back = (
    <p className="text-center text-sm text-muted-foreground">
      Remembered it?{" "}
      <Link href={withNext("/sign-in", nextParam) as Route} className={linkClass}>
        Sign in
      </Link>
    </p>
  );

  if (setup.isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 py-6">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (setup.data && !setup.data.emailConfigured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <MailX className="size-5 text-muted-foreground" /> Ask your administrator
          </CardTitle>
          <CardDescription className="text-pretty">
            Email isn&apos;t set up on this server, so Pinwren can&apos;t send you a reset link. Your
            administrator can copy one for you from Settings › Users.
          </CardDescription>
        </CardHeader>
        <CardContent>{back}</CardContent>
      </Card>
    );
  }

  if (sentTo) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <MailCheck className="size-5 text-primary" /> Check your email
          </CardTitle>
          <CardDescription className="text-pretty">
            If <span className="font-medium text-foreground">{sentTo}</span> has an account, a link to choose
            a new password is on its way. It works for an hour.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Button variant="outline" onClick={() => setSentTo(null)}>
            Use another address
          </Button>
          {back}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Reset your password</CardTitle>
        <CardDescription>We&apos;ll email you a link to choose a new one.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
          <Field id="email" label="Email" error={errors.email?.message}>
            <Input
              {...controlProps("email", errors.email?.message)}
              {...form.register("email")}
              type="email"
              autoComplete="email"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the page's only field
              autoFocus
            />
          </Field>
          <FormError message={errors.root?.message} />
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? "Sending…" : "Send reset link"}
          </Button>
          {back}
        </form>
      </CardContent>
    </Card>
  );
}
