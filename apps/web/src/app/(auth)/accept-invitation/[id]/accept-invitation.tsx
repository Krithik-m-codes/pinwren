"use client";

import { CircleAlert, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { controlProps, Field, FormError, useZodForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient, signIn, signOut, signUp } from "@/lib/auth-client";
import { signInForm, signUpForm } from "@/lib/form-schemas";

/** Signed out: sign in or create an account with the invited address; the server then renders the next step. */
export function AuthFirst() {
  const [tab, setTab] = useState<"sign-up" | "sign-in">("sign-up");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Users className="size-5 text-muted-foreground" /> You&apos;re invited
        </CardTitle>
        <CardDescription>
          Sign in or create an account with the address the invitation was sent to, then join the workspace.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="mb-3 w-full">
            <TabsTrigger value="sign-up">Create account</TabsTrigger>
            <TabsTrigger value="sign-in">Sign in</TabsTrigger>
          </TabsList>
          <TabsContent value="sign-up">
            <SignUpStep />
          </TabsContent>
          <TabsContent value="sign-in">
            <SignInStep />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function SignUpStep() {
  const router = useRouter();
  const form = useZodForm(signUpForm, { defaultValues: { name: "", email: "", password: "" } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (v) => {
    const { error } = await signUp.email(v);
    if (error) {
      form.setError("root", { message: error.message ?? "That didn't work" });
      return;
    }
    // Signed in now: the server renders the invitation.
    router.refresh();
  });
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
      <Field id="sign-up-name" label="Name" error={errors.name?.message}>
        <Input
          {...controlProps("sign-up-name", errors.name?.message)}
          {...form.register("name")}
          autoComplete="name"
        />
      </Field>
      <Field id="sign-up-email" label="Email" error={errors.email?.message}>
        <Input
          {...controlProps("sign-up-email", errors.email?.message)}
          {...form.register("email")}
          type="email"
          autoComplete="email"
        />
      </Field>
      <Field
        id="sign-up-password"
        label="Password"
        help="At least 8 characters."
        error={errors.password?.message}
      >
        <Input
          {...controlProps("sign-up-password", errors.password?.message, true)}
          {...form.register("password")}
          type="password"
          autoComplete="new-password"
        />
      </Field>
      <FormError message={errors.root?.message} />
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "One moment…" : "Create account and continue"}
      </Button>
    </form>
  );
}

function SignInStep() {
  const router = useRouter();
  const form = useZodForm(signInForm, { defaultValues: { email: "", password: "" } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (v) => {
    const { error } = await signIn.email(v);
    if (error) {
      form.setError("root", { message: error.message ?? "That didn't work" });
      return;
    }
    router.refresh();
  });
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
      <Field id="sign-in-email" label="Email" error={errors.email?.message}>
        <Input
          {...controlProps("sign-in-email", errors.email?.message)}
          {...form.register("email")}
          type="email"
          autoComplete="email"
        />
      </Field>
      <Field id="sign-in-password" label="Password" error={errors.password?.message}>
        <Input
          {...controlProps("sign-in-password", errors.password?.message)}
          {...form.register("password")}
          type="password"
          autoComplete="current-password"
        />
      </Field>
      <FormError message={errors.root?.message} />
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "One moment…" : "Sign in and continue"}
      </Button>
    </form>
  );
}

export type InvitationSummary = {
  organizationId: string;
  organizationName: string;
  inviterEmail: string;
  email: string;
  role: string;
};

/** Signed in with the invited address: join (accept + make the workspace active) or decline. */
export function Accept({
  id,
  email,
  invitation: inv,
}: {
  id: string;
  email: string;
  invitation: InvitationSummary;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setPending("accept");
    setError(null);
    const { error } = await authClient.organization.acceptInvitation({ invitationId: id });
    if (error) {
      setPending(null);
      setError(error.message ?? "Couldn't accept the invitation");
      return;
    }
    await authClient.organization.setActive({ organizationId: inv.organizationId });
    router.replace("/inbox");
  }

  async function decline() {
    setPending("decline");
    await authClient.organization.rejectInvitation({ invitationId: id });
    router.replace("/inbox");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Join {inv.organizationName}</CardTitle>
        <CardDescription>
          {inv.inviterEmail} invited <span className="font-medium text-foreground">{inv.email}</span> as{" "}
          {inv.role === "admin" ? "an admin" : `a ${inv.role}`}.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button onClick={() => void accept()} disabled={!!pending}>
          {pending === "accept" ? "Joining…" : `Join ${inv.organizationName}`}
        </Button>
        <Button variant="ghost" onClick={() => void decline()} disabled={!!pending}>
          {pending === "decline" ? "Declining…" : "Decline"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">Signed in as {email}</p>
      </CardContent>
    </Card>
  );
}

export function InvitationProblem({ email, message }: { email: string; message: string }) {
  const router = useRouter();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <CircleAlert className="size-5 text-destructive" /> This invitation can&apos;t be used
        </CardTitle>
        <CardDescription>
          It may have expired or been revoked, or it was sent to a different address than{" "}
          <span className="font-medium text-foreground">{email}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        <p className="text-sm text-muted-foreground">{message}</p>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button
            variant="outline"
            onClick={async () => {
              await signOut();
              router.refresh();
            }}
          >
            Use another account
          </Button>
          <Button variant="ghost" onClick={() => router.replace("/inbox")}>
            Go to my inbox
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
