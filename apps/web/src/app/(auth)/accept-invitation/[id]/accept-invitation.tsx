"use client";

import { appRoleOf } from "@pinwren/core";
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
import type { Key } from "@/lib/i18n/en";
import { useT } from "@/lib/i18n/provider";
import { useNextPath } from "../../auth-shared";

/** Signed out: sign in or create an account with the invited address; the server then renders the next step. */
export function AuthFirst() {
  const t = useT();
  const [tab, setTab] = useState<"sign-up" | "sign-in">("sign-up");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Users className="size-5 text-muted-foreground" /> {t("other1.youreInvited")}
        </CardTitle>
        <CardDescription>{t("other1.inviteSignInDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="mb-3 w-full">
            <TabsTrigger value="sign-up">{t("other1.createAccount")}</TabsTrigger>
            <TabsTrigger value="sign-in">{t("other1.signIn")}</TabsTrigger>
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
  const t = useT();
  const router = useRouter();
  const form = useZodForm(signUpForm, { defaultValues: { name: "", email: "", password: "" } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (v) => {
    const { error } = await signUp.email(v);
    if (error) {
      form.setError("root", { message: error.message ?? t("other1.thatDidntWork") });
      return;
    }
    // Signed in now: the server renders the invitation.
    router.refresh();
  });
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
      <Field id="sign-up-name" label={t("other1.name")} error={errors.name?.message}>
        <Input
          {...controlProps("sign-up-name", errors.name?.message)}
          {...form.register("name")}
          autoComplete="name"
        />
      </Field>
      <Field id="sign-up-email" label={t("other1.email")} error={errors.email?.message}>
        <Input
          {...controlProps("sign-up-email", errors.email?.message)}
          {...form.register("email")}
          type="email"
          autoComplete="email"
        />
      </Field>
      <Field
        id="sign-up-password"
        label={t("other1.password")}
        help={t("other1.atLeast8Chars")}
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
        {isSubmitting ? t("other1.oneMoment") : t("other1.createAccountAndContinue")}
      </Button>
    </form>
  );
}

function SignInStep() {
  const t = useT();
  const router = useRouter();
  const form = useZodForm(signInForm, { defaultValues: { email: "", password: "" } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (v) => {
    const { error } = await signIn.email(v);
    if (error) {
      form.setError("root", { message: error.message ?? t("other1.thatDidntWork") });
      return;
    }
    router.refresh();
  });
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
      <Field id="sign-in-email" label={t("other1.email")} error={errors.email?.message}>
        <Input
          {...controlProps("sign-in-email", errors.email?.message)}
          {...form.register("email")}
          type="email"
          autoComplete="email"
        />
      </Field>
      <Field id="sign-in-password" label={t("other1.password")} error={errors.password?.message}>
        <Input
          {...controlProps("sign-in-password", errors.password?.message)}
          {...form.register("password")}
          type="password"
          autoComplete="current-password"
        />
      </Field>
      <FormError message={errors.root?.message} />
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? t("other1.oneMoment") : t("other1.signInAndContinue")}
      </Button>
    </form>
  );
}

const ROLE_PHRASE = {
  admin: "other1.roleAnAdmin",
  editor: "other1.roleAnEditor",
  viewer: "other1.roleAViewer",
} as const satisfies Record<string, Key>;

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
  const t = useT();
  const router = useRouter();
  const next = useNextPath();
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setPending("accept");
    setError(null);
    const { error } = await authClient.organization.acceptInvitation({ invitationId: id });
    if (error) {
      setPending(null);
      setError(error.message ?? t("other1.couldntAcceptInvitation"));
      return;
    }
    await authClient.organization.setActive({ organizationId: inv.organizationId });
    // A full load: the app's server components read the new active workspace from the session.
    window.location.assign(new URL(next, window.location.href).href);
  }

  async function decline() {
    setPending("decline");
    await authClient.organization.rejectInvitation({ invitationId: id });
    router.replace("/inbox");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("other1.joinOrg", { org: inv.organizationName })}</CardTitle>
        <CardDescription>
          {t("other1.invitationInvited", { inviter: inv.inviterEmail })}{" "}
          <span className="font-medium text-foreground">{inv.email}</span>{" "}
          {t("other1.invitationAsRole", { role: t(ROLE_PHRASE[appRoleOf(inv.role)]) })}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button onClick={() => void accept()} disabled={!!pending}>
          {pending === "accept" ? t("other1.joining") : t("other1.joinOrg", { org: inv.organizationName })}
        </Button>
        <Button variant="ghost" onClick={() => void decline()} disabled={!!pending}>
          {pending === "decline" ? t("other1.declining") : t("other1.decline")}
        </Button>
        <p className="text-center text-xs text-muted-foreground">{t("other1.signedInAs", { email })}</p>
      </CardContent>
    </Card>
  );
}

export function InvitationProblem({ email, message }: { email: string; message: string }) {
  const t = useT();
  const router = useRouter();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <CircleAlert className="size-5 text-destructive" /> {t("other1.invitationCantBeUsed")}
        </CardTitle>
        <CardDescription>
          {t("other1.invitationProblemBefore")} <span className="font-medium text-foreground">{email}</span>
          {t("other1.invitationProblemAfter")}
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
            {t("other1.useAnotherAccount")}
          </Button>
          <Button variant="ghost" onClick={() => router.replace("/inbox")}>
            {t("other1.goToMyInbox")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
