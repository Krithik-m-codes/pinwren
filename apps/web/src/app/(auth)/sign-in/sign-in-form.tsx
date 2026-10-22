"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { controlProps, Field, FormError, useZodForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { signIn } from "@/lib/auth-client";
import { signInForm } from "@/lib/form-schemas";

/** Prerendered page; only the submit talks to the server. */
export function SignInForm() {
  const router = useRouter();
  const form = useZodForm(signInForm, { defaultValues: { email: "", password: "" } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (v) => {
    const { error } = await signIn.email(v);
    if (error) {
      form.setError("root", { message: error.message ?? "Could not sign in" });
      return;
    }
    router.replace("/inbox");
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Welcome back</CardTitle>
        <CardDescription>Sign in to triage your feedback.</CardDescription>
      </CardHeader>
      <CardContent>
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
          <FormError message={errors.root?.message} />
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? "Signing in…" : "Sign in"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            New here?{" "}
            <Link href="/sign-up" className="font-medium text-foreground underline-offset-4 hover:underline">
              Create an account
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
