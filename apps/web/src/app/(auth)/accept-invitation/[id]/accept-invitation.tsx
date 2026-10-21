"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleAlert, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient, signIn, signOut, signUp, useSession } from "@/lib/auth-client";
import { formText } from "@/lib/form";

/**
 * Invitation emails link here (wave-1 §8). Signed out: sign in or create an account with the invited
 * address. Signed in: show the workspace, accept → make it active → inbox.
 */
export function AcceptInvitation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <Card>
        <CardContent className="space-y-3 py-6">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (!session) return <AuthFirst />;
  return <Accept id={id} email={session.user.email} />;
}

function AuthFirst() {
  const [tab, setTab] = useState<"sign-up" | "sign-in">("sign-up");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = formText(form, "email");
    const password = formText(form, "password");
    setPending(true);
    setError(null);
    const { error } =
      tab === "sign-in"
        ? await signIn.email({ email, password })
        : await signUp.email({
            email,
            password,
            name: formText(form, "name") || email.split("@")[0] || email,
          });
    setPending(false);
    // On success the session store updates and this page re-renders into the accept step.
    if (error) setError(error.message ?? "That didn't work");
  }

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
          {(["sign-up", "sign-in"] as const).map((t) => (
            <TabsContent key={t} value={t}>
              <form onSubmit={onSubmit} className="grid gap-4">
                {t === "sign-up" && (
                  <div className="grid gap-2">
                    <Label htmlFor={`${t}-name`}>Name</Label>
                    <Input id={`${t}-name`} name="name" autoComplete="name" required />
                  </div>
                )}
                <div className="grid gap-2">
                  <Label htmlFor={`${t}-email`}>Email</Label>
                  <Input id={`${t}-email`} name="email" type="email" autoComplete="email" required />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`${t}-password`}>Password</Label>
                  <Input
                    id={`${t}-password`}
                    name="password"
                    type="password"
                    autoComplete={t === "sign-in" ? "current-password" : "new-password"}
                    minLength={8}
                    required
                  />
                  {t === "sign-up" && <p className="text-xs text-muted-foreground">At least 8 characters.</p>}
                </div>
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
                <Button type="submit" disabled={pending}>
                  {pending
                    ? "One moment…"
                    : t === "sign-in"
                      ? "Sign in and continue"
                      : "Create account and continue"}
                </Button>
              </form>
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}

function Accept({ id, email }: { id: string; email: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const invitation = useQuery({
    queryKey: ["invitation", id],
    queryFn: async () => {
      const { data, error } = await authClient.organization.getInvitation({ query: { id } });
      if (error) throw new Error(error.message ?? "Invitation not found");
      return data;
    },
    retry: false,
  });

  async function accept() {
    setPending("accept");
    setError(null);
    const { data, error } = await authClient.organization.acceptInvitation({ invitationId: id });
    if (error) {
      setPending(null);
      setError(error.message ?? "Couldn't accept the invitation");
      return;
    }
    const orgId =
      invitation.data?.organizationId ??
      (data as { invitation?: { organizationId?: string } }).invitation?.organizationId;
    if (orgId) await authClient.organization.setActive({ organizationId: orgId });
    router.replace("/inbox");
  }

  async function decline() {
    setPending("decline");
    await authClient.organization.rejectInvitation({ invitationId: id });
    router.replace("/inbox");
  }

  if (invitation.isPending) {
    return (
      <Card>
        <CardContent className="space-y-3 py-6">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (invitation.isError) {
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
          <p className="text-sm text-muted-foreground">{invitation.error.message}</p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button variant="outline" onClick={() => void signOut()}>
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

  const inv = invitation.data;
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
        <Button onClick={accept} disabled={!!pending}>
          {pending === "accept" ? "Joining…" : `Join ${inv.organizationName}`}
        </Button>
        <Button variant="ghost" onClick={decline} disabled={!!pending}>
          {pending === "decline" ? "Declining…" : "Decline"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">Signed in as {email}</p>
      </CardContent>
    </Card>
  );
}
