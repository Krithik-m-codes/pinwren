"use client";

import { CircleCheck, CircleDashed } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { CopyButton } from "@/components/copy-button";
import { ProviderIcon } from "@/components/provider-icon";
import { SettingGroup, SettingRow } from "@/components/setting-row";
import { ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/store/api";
import { useSignInSettingsQuery, useUpdateSignInSettingsMutation } from "@/lib/store/api/sign-in";

/**
 * Settings › Security › Sign-in methods (instance admins). Email links and passkeys are switched here;
 * Google / GitHub are configured with environment variables (their secrets stay out of the database), so
 * this shows whether each is on and the callback URL to register with the provider.
 */
export function SignInMethodsCard() {
  const q = useSignInSettingsQuery(undefined);
  const [update, updating] = useUpdateSignInSettingsMutation();
  const save = (patch: { magicLink?: boolean; passkeys?: boolean }, message: string) => {
    update(patch)
      .unwrap()
      .then(() => toast.success(message))
      .catch((e: unknown) => toast.error("Not saved", { description: errorMessage(e) }));
  };

  return (
    <Card data-testid="sign-in-methods">
      <CardHeader>
        <CardTitle>Sign-in methods</CardTitle>
        <CardDescription className="text-pretty">
          Everyone can sign in with a password. Offer these as well; sign-up rules still apply, so Google or
          GitHub never let in someone an invitation-only server wouldn&apos;t.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {q.isLoading && <Skeleton className="h-56" />}
        {q.isError && <ErrorState error={q.error} retry={() => void q.refetch()} className="py-6" />}
        {q.data && (
          <SettingGroup>
            <SettingRow
              label="Email sign-in links"
              htmlFor="signin-magic-link"
              description={
                q.data.signIn.emailConfigured ? (
                  "A one-time link by email, valid for 10 minutes."
                ) : (
                  <>
                    Needs email:{" "}
                    <Link href="/settings/email" className="underline underline-offset-4">
                      set up SMTP
                    </Link>{" "}
                    first. Until then the sign-in page doesn&apos;t offer it.
                  </>
                )
              }
            >
              <Switch
                id="signin-magic-link"
                checked={q.data.signIn.magicLink}
                disabled={updating.isLoading}
                onCheckedChange={(magicLink) =>
                  save({ magicLink }, magicLink ? "Email sign-in links on" : "Email sign-in links off")
                }
              />
            </SettingRow>
            <SettingRow
              label="Passkeys"
              htmlFor="signin-passkeys"
              description="Fingerprint, face, screen lock or a security key; each person adds theirs in Settings › Profile."
            >
              <Switch
                id="signin-passkeys"
                checked={q.data.signIn.passkeys}
                disabled={updating.isLoading}
                onCheckedChange={(passkeys) => save({ passkeys }, passkeys ? "Passkeys on" : "Passkeys off")}
              />
            </SettingRow>
            {q.data.signIn.providers.map((p) => (
              <SettingRow
                key={p.id}
                stack
                label={
                  <span className="inline-flex items-center gap-2">
                    <ProviderIcon provider={p.id} className="size-4" /> {p.name}
                    {p.configured ? (
                      <Badge variant="secondary" className="gap-1 font-normal">
                        <CircleCheck className="size-3.5 text-emerald-600" /> On
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                        <CircleDashed className="size-3.5" /> Not configured
                      </Badge>
                    )}
                  </span>
                }
                description={
                  p.configured
                    ? `Set by ${p.envVars[0]} and ${p.envVars[1]}.`
                    : `Create an OAuth app at ${p.name}, register this callback URL, then set ${p.envVars[0]} and ${p.envVars[1]} and restart.`
                }
              >
                <div className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/40 px-2 py-1">
                  <code className="min-w-0 flex-1 truncate font-mono text-xs" title={p.callbackUrl}>
                    {p.callbackUrl}
                  </code>
                  <CopyButton value={p.callbackUrl} label={`Copy the ${p.name} callback URL`} />
                </div>
              </SettingRow>
            ))}
          </SettingGroup>
        )}
      </CardContent>
    </Card>
  );
}
