"use client";

import type { Route } from "next";
import { CircleAlert, Fingerprint, MailCheck, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { controlProps, Field, FormError, useZodForm } from "@/components/form";
import { ProviderIcon } from "@/components/provider-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient, signIn } from "@/lib/auth-client";
import { safeNext } from "@/lib/next-path";
import { magicLinkForm, PROVIDER_NAMES, signInErrorMessage } from "@/lib/sign-in-forms";
import type { OAuthProvider } from "@/lib/store/api/sign-in";
import { useSearchParam, useSignInMethods } from "./auth-shared";

// Sign-in methods besides the password (wave 5), shown under the password form: Google / GitHub when the
// server has them configured, a passkey, and an email link (only with SMTP). Each is offered only when
// `GET /api/sign-in-methods` says so; the server refuses the rest anyway.

/** Where Better Auth sends people back to: the destination, or onboarding for a brand-new account. */
function callbacks(nextParam: string | null, errorPage: "/sign-in" | "/sign-up") {
  return {
    callbackURL: safeNext(nextParam),
    // A new account picks or joins a workspace first (pending invitations are offered there).
    newUserCallbackURL: safeNext(nextParam, "/onboarding"),
    errorCallbackURL: errorPage,
  };
}

/** The `?error=` Better Auth adds when Google / GitHub or an email link fails, in words. */
export function SignInErrorNotice() {
  const message = signInErrorMessage(useSearchParam("error"));
  if (!message) return null;
  return (
    <div
      role="alert"
      data-testid="sign-in-error"
      className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0 text-pretty">{message}</p>
    </div>
  );
}

function Divider() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * Buttons for the other sign-in methods. On sign-up only Google / GitHub (they create the account);
 * on sign-in also the passkey and the email link (`onEmailLink` switches the card to that form).
 */
export function OtherSignIn({
  mode,
  nextParam,
  onEmailLink,
}: {
  mode: "sign-in" | "sign-up";
  nextParam: string | null;
  onEmailLink?: () => void;
}) {
  const router = useRouter();
  const methods = useSignInMethods();
  const [pending, setPending] = useState<OAuthProvider | "passkey" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (methods.isLoading) return <Skeleton className="h-9" />;
  // Unreachable server: the password form above still works (and reports the problem itself).
  const m = methods.data;
  if (!m) return null;
  const providers = (["google", "github"] as const).filter((p) => m[p]);
  const passkey = mode === "sign-in" && m.passkey;
  const emailLink = mode === "sign-in" && m.magicLink && !!onEmailLink;
  if (!providers.length && !passkey && !emailLink) return null;

  const social = async (provider: OAuthProvider) => {
    setError(null);
    setPending(provider);
    // On success the browser leaves for the provider; only a failure to start comes back here.
    const { error: err } = await signIn.social({
      provider,
      ...callbacks(nextParam, mode === "sign-up" ? "/sign-up" : "/sign-in"),
    });
    if (err) {
      setError(err.message ?? `Couldn't reach ${PROVIDER_NAMES[provider]}`);
      setPending(null);
    }
  };

  const withPasskey = async () => {
    setError(null);
    setPending("passkey");
    const { error: err } = await authClient.signIn.passkey();
    setPending(null);
    if (err) {
      setError(
        /cancel|not allowed|abort/i.test(err.message ?? "")
          ? "No passkey was used. Try again, or sign in another way."
          : (err.message ?? "That passkey didn't work"),
      );
      return;
    }
    router.replace(safeNext(nextParam) as Route);
  };

  return (
    <div className="grid gap-3" data-testid="other-sign-in">
      <Divider />
      {providers.map((p) => (
        <Button
          key={p}
          type="button"
          variant="outline"
          className="w-full"
          disabled={pending !== null}
          onClick={() => void social(p)}
        >
          <ProviderIcon provider={p} className="size-4" />
          {pending === p ? "Redirecting…" : `Continue with ${PROVIDER_NAMES[p]}`}
        </Button>
      ))}
      {passkey && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={pending !== null}
          onClick={() => void withPasskey()}
        >
          <Fingerprint /> {pending === "passkey" ? "Waiting for your passkey…" : "Sign in with a passkey"}
        </Button>
      )}
      {emailLink && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={pending !== null}
          onClick={onEmailLink}
        >
          <Mail /> Email me a sign-in link
        </Button>
      )}
      <FormError message={error ?? undefined} />
    </div>
  );
}

/** The email-link form, then "check your inbox". */
export function EmailLinkStep({ nextParam, onBack }: { nextParam: string | null; onBack: () => void }) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useZodForm(magicLinkForm, { defaultValues: { email: "" } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async ({ email }) => {
    const { error } = await signIn.magicLink({ email, ...callbacks(nextParam, "/sign-in") });
    if (error) {
      form.setError("root", { message: error.message ?? "Couldn't send the link" });
      return;
    }
    setSentTo(email);
  });

  if (sentTo) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <MailCheck className="size-5 text-primary" /> Check your inbox
          </CardTitle>
          <CardDescription className="text-pretty">
            If {sentTo} can sign in here, a link is on its way. It works once, for 10 minutes. Open it in this
            browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          <Button type="button" variant="outline" onClick={() => setSentTo(null)}>
            Send another link
          </Button>
          <Button type="button" variant="ghost" onClick={onBack}>
            Sign in another way
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Sign in with an email link</CardTitle>
        <CardDescription>We&apos;ll email you a link that signs you in, no password needed.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
          <Field id="link-email" label="Email" error={errors.email?.message}>
            <Input
              {...controlProps("link-email", errors.email?.message)}
              {...form.register("email")}
              type="email"
              autoComplete="email"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the step exists to take this one address
              autoFocus
            />
          </Field>
          <FormError message={errors.root?.message} />
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? "Sending…" : "Email me a link"}
          </Button>
          <Button type="button" variant="ghost" onClick={onBack}>
            Use my password instead
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
