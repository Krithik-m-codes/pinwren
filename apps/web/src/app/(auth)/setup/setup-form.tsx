"use client";

import { setupClaim } from "@pinwren/core";
import { CircleCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { controlProps, Field, FormError, useZodForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { errorMessage, isApiError, useClaimSetupMutation } from "@/lib/store/api";

export function SetupForm() {
  const router = useRouter();
  const [claim] = useClaimSetupMutation();
  const [done, setDone] = useState(false);
  const form = useZodForm(setupClaim, { defaultValues: { token: "" } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async ({ token }) => {
    try {
      await claim(token).unwrap();
      setDone(true);
    } catch (e) {
      const message =
        isApiError(e) && e.status === 401 ? "Sign in first — then come back to this page." : errorMessage(e);
      form.setError("root", { message });
    }
  });

  if (done) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <CircleCheck className="size-5 text-primary" /> You administer this instance
          </CardTitle>
          <CardDescription>Email, security and licence settings are now open to you.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" onClick={() => router.replace("/settings")}>
            Open settings
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Set up this instance</CardTitle>
        <CardDescription>
          Paste the one-time setup token from the server log to become the instance administrator.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
          <Field
            id="token"
            label="Setup token"
            help="Printed on start while no administrator exists. It starts with pws_."
            error={errors.token?.message}
          >
            <Input
              {...controlProps("token", errors.token?.message, true)}
              {...form.register("token")}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </Field>
          <FormError message={errors.root?.message} />
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? "Checking…" : "Claim administration"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Not signed in?{" "}
            <Link href="/sign-in" className="font-medium text-foreground underline-offset-4 hover:underline">
              Sign in
            </Link>{" "}
            or{" "}
            <Link href="/sign-up" className="font-medium text-foreground underline-offset-4 hover:underline">
              create the first account
            </Link>
            .
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
