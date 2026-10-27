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
import { useT } from "@/lib/i18n/provider";
import { errorMessage } from "@/lib/store/api";
import { useSignInSettingsQuery, useUpdateSignInSettingsMutation } from "@/lib/store/api/sign-in";

/**
 * Settings › Security › Sign-in methods (instance admins). Email links and passkeys are switched here;
 * Google / GitHub are configured with environment variables (their secrets stay out of the database), so
 * this shows whether each is on and the callback URL to register with the provider.
 */
export function SignInMethodsCard() {
  const t = useT();
  const q = useSignInSettingsQuery(undefined);
  const [update, updating] = useUpdateSignInSettingsMutation();
  const save = (patch: { magicLink?: boolean; passkeys?: boolean }, message: string) => {
    update(patch)
      .unwrap()
      .then(() => toast.success(message))
      .catch((e: unknown) => toast.error(t("settings1.notSaved"), { description: errorMessage(e) }));
  };

  return (
    <Card data-testid="sign-in-methods">
      <CardHeader>
        <CardTitle>{t("settings1.signInMethods")}</CardTitle>
        <CardDescription className="text-pretty">{t("settings1.signInMethodsDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        {q.isLoading && <Skeleton className="h-56" />}
        {q.isError && <ErrorState error={q.error} retry={() => void q.refetch()} className="py-6" />}
        {q.data && (
          <SettingGroup>
            <SettingRow
              label={t("settings1.emailSignInLinks")}
              htmlFor="signin-magic-link"
              description={
                q.data.signIn.emailConfigured ? (
                  t("settings1.emailLinkDescription")
                ) : (
                  <>
                    {t("settings1.needsEmailBefore")}
                    <Link href="/settings/email" className="underline underline-offset-4">
                      {t("settings1.setUpSmtp")}
                    </Link>
                    {t("settings1.needsEmailAfter")}
                  </>
                )
              }
            >
              <Switch
                id="signin-magic-link"
                checked={q.data.signIn.magicLink}
                disabled={updating.isLoading}
                onCheckedChange={(magicLink) =>
                  save(
                    { magicLink },
                    magicLink ? t("settings1.emailSignInLinksOn") : t("settings1.emailSignInLinksOff"),
                  )
                }
              />
            </SettingRow>
            <SettingRow
              label={t("settings1.passkeys")}
              htmlFor="signin-passkeys"
              description={t("settings1.passkeysDescription")}
            >
              <Switch
                id="signin-passkeys"
                checked={q.data.signIn.passkeys}
                disabled={updating.isLoading}
                onCheckedChange={(passkeys) =>
                  save({ passkeys }, passkeys ? t("settings1.passkeysOn") : t("settings1.passkeysOff"))
                }
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
                        <CircleCheck className="size-3.5 text-emerald-600" /> {t("settings1.on")}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                        <CircleDashed className="size-3.5" /> {t("settings1.notConfigured")}
                      </Badge>
                    )}
                  </span>
                }
                description={
                  p.configured
                    ? t("settings1.providerSetBy", { a: p.envVars[0], b: p.envVars[1] })
                    : t("settings1.providerCreateOauth", {
                        name: p.name,
                        a: p.envVars[0],
                        b: p.envVars[1],
                      })
                }
              >
                <div className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/40 px-2 py-1">
                  <code className="min-w-0 flex-1 truncate font-mono text-xs" title={p.callbackUrl}>
                    {p.callbackUrl}
                  </code>
                  <CopyButton
                    value={p.callbackUrl}
                    label={t("settings1.copyCallbackUrl", { name: p.name })}
                  />
                </div>
              </SettingRow>
            ))}
          </SettingGroup>
        )}
      </CardContent>
    </Card>
  );
}
