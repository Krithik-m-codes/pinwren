"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { controlProps, Field, FormError, useZodForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { signUp } from "@/lib/auth-client";
import { signUpForm } from "@/lib/form-schemas";

export function SignUpForm() {
  const router = useRouter();
  const form = useZodForm(signUpForm, { defaultValues: { name: "", email: "", password: "" } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (v) => {
    const { error } = await signUp.email(v);
    if (error) {
      form.setError("root", { message: error.message ?? "Could not create your account" });
      return;
    }
    router.replace("/onboarding");
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Create your account</CardTitle>
        <CardDescription>Collect pinned feedback and bug reports from any site.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
          <Field id="name" label="Name" error={errors.name?.message}>
            <Input
              {...controlProps("name", errors.name?.message)}
              {...form.register("name")}
              autoComplete="name"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the page exists to sign up; its first field is the only sensible start
              autoFocus
            />
          </Field>
          <Field id="email" label="Work email" error={errors.email?.message}>
            <Input
              {...controlProps("email", errors.email?.message)}
              {...form.register("email")}
              type="email"
              autoComplete="email"
            />
          </Field>
          <Field
            id="password"
            label="Password"
            help="At least 8 characters."
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
            {isSubmitting ? "Creating account…" : "Create account"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/sign-in" className="font-medium text-foreground underline-offset-4 hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
