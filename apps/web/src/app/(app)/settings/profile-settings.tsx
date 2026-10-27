"use client";

import { BadgeCheck, CircleAlert, Monitor, Moon, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useState } from "react";
import { toast } from "sonner";
import { AvatarUpload } from "@/components/avatar-upload";
import { controlProps, Field, FieldError, FormError, useZodForm } from "@/components/form";
import { Segmented } from "@/components/segmented";
import { SettingGroup, SettingRow } from "@/components/setting-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { MeResponse } from "@/lib/api";
import { changeEmailForm } from "@/lib/account-forms";
import { authClient } from "@/lib/auth-client";
import { profileForm } from "@/lib/form-schemas";
import { useT } from "@/lib/i18n/provider";
import { errorMessage } from "@/lib/store/api";
import { useChangeEmailWithPasswordMutation, useSaveProfileMutation } from "@/lib/store/api/people";
import { useMounted } from "@/lib/use-synced-state";
import { useViewer } from "@/lib/viewer";
import { DeleteAccountCard, PasswordCard, SessionsCard, TwoFactorCard } from "./account-security";
import { LanguageRow } from "./language-row";
import { ConnectedAccountsCard, PasskeysCard } from "./sign-in-methods";

/**
 * The session cookie caches the user for a minute (auth.ts); after changing the account, re-read it so
 * the next server render (sidebar, account menu) shows the new name, picture or address.
 */
export async function refreshAccount(router: ReturnType<typeof useRouter>) {
  await authClient.getSession({ query: { disableCookieCache: true } });
  router.refresh();
}

/** Settings › Profile: who you are to your team, how the app looks, and how you sign in. */
export function ProfileSettings() {
  const t = useT();
  const { me } = useViewer();
  const { theme, setTheme } = useTheme();
  // The theme is only known on the client; render its control after hydration.
  const mounted = useMounted();

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings3.profile")}</CardTitle>
          <CardDescription>{t("settings3.profileDescription")}</CardDescription>
        </CardHeader>
        <CardContent>{!me ? <Skeleton className="h-40" /> : <ProfileForm me={me} />}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings3.appearance")}</CardTitle>
          <CardDescription>{t("settings3.savedOnThisDevice")}</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingGroup>
            <LanguageRow />
            <SettingRow label={t("settings3.theme")} description={t("settings3.themeDescription")}>
              {mounted ? (
                <Segmented
                  label={t("settings3.theme")}
                  value={(theme ?? "system") as "light" | "dark" | "system"}
                  onChange={setTheme}
                  options={[
                    {
                      value: "light",
                      label: (
                        <>
                          <Sun /> {t("settings3.themeLight")}
                        </>
                      ),
                    },
                    {
                      value: "dark",
                      label: (
                        <>
                          <Moon /> {t("settings3.themeDark")}
                        </>
                      ),
                    },
                    {
                      value: "system",
                      label: (
                        <>
                          <Monitor /> {t("settings3.themeSystem")}
                        </>
                      ),
                    },
                  ]}
                />
              ) : (
                <Skeleton className="h-8 w-56" />
              )}
            </SettingRow>
          </SettingGroup>
        </CardContent>
      </Card>

      <PasswordCard />
      {me && <TwoFactorCard enabled={!!me.user.twoFactorEnabled} />}
      <PasskeysCard />
      <ConnectedAccountsCard />
      <SessionsCard />
      <DeleteAccountCard />
    </div>
  );
}

function ProfileForm({ me }: { me: MeResponse }) {
  const router = useRouter();
  const { user } = me;
  return (
    <div className="grid gap-5">
      <AvatarUpload name={user.name} image={user.image} onChanged={() => void refreshAccount(router)} />
      <NameForm key={user.name} name={user.name} />
      <EmailRow me={me} />
    </div>
  );
}

function NameForm({ name }: { name: string }) {
  const t = useT();
  const router = useRouter();
  const [saveProfile] = useSaveProfileMutation();
  const form = useZodForm(profileForm, { defaultValues: { name }, mode: "onChange" });
  const { errors, isSubmitting, isDirty } = form.formState;
  const submit = form.handleSubmit(async (v) => {
    if (v.name === name) return;
    try {
      await saveProfile({ name: v.name }).unwrap();
      toast.success(t("settings3.nameUpdated"));
      await refreshAccount(router);
    } catch (e) {
      toast.error(errorMessage(e, t("settings3.couldntSaveName")));
    }
  });
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-2 sm:max-w-sm">
      <Label htmlFor="profile-name">{t("settings3.name")}</Label>
      <div className="flex gap-2">
        <Input
          {...controlProps("profile-name", errors.name?.message)}
          {...form.register("name")}
          maxLength={120}
          autoComplete="name"
        />
        <Button type="submit" disabled={isSubmitting || !isDirty || !!errors.name}>
          {isSubmitting ? t("settings3.saving") : t("settings3.save")}
        </Button>
      </div>
      <FieldError id="profile-name" message={errors.name?.message} />
    </form>
  );
}

/** The address notifications go to: whether it's confirmed, resending the link, and changing it. */
function EmailRow({ me }: { me: MeResponse }) {
  const t = useT();
  const [changing, setChanging] = useState(false);
  const [sending, setSending] = useState(false);
  const verified = !!me.user.emailVerified;

  async function resend() {
    setSending(true);
    const { error } = await authClient.sendVerificationEmail({
      email: me.user.email,
      callbackURL: "/settings",
    });
    setSending(false);
    if (error) toast.error(error.message ?? t("settings3.couldntSendLink"));
    else
      toast.success(t("settings3.linkSentTo", { email: me.user.email }), {
        description: t("settings3.linkWorks24Hours"),
      });
  }

  return (
    <div className="grid gap-2 sm:max-w-sm">
      <Label htmlFor="profile-email">{t("settings3.colEmail")}</Label>
      <div className="flex gap-2">
        <Input id="profile-email" value={me.user.email} readOnly className="bg-muted/40" />
        <Button type="button" variant="outline" onClick={() => setChanging(true)}>
          {t("settings3.change")}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {verified ? (
          <Badge variant="secondary" className="gap-1 font-normal" data-testid="email-verified">
            <BadgeCheck className="size-3.5 text-emerald-600" /> {t("settings3.verified")}
          </Badge>
        ) : (
          <>
            <Badge variant="outline" className="gap-1 font-normal" data-testid="email-unverified">
              <CircleAlert className="size-3.5 text-amber-600" /> {t("settings3.notVerified")}
            </Badge>
            {me.emailConfigured ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto px-0 text-xs"
                disabled={sending}
                onClick={() => void resend()}
              >
                {sending ? t("settings3.sending") : t("settings3.sendConfirmationLinkAgain")}
              </Button>
            ) : (
              <span>{t("settings3.emailNotSetUpNothingToConfirm")}</span>
            )}
          </>
        )}
      </div>
      <ChangeEmailDialog open={changing} onOpenChange={setChanging} me={me} />
    </div>
  );
}

/**
 * With SMTP: Better Auth's change-email flow (a verified address approves the change first, then the new
 * one confirms). Without: the password confirms it, and the new address starts unverified.
 */
function ChangeEmailDialog({
  open,
  onOpenChange,
  me,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  me: MeResponse;
}) {
  const t = useT();
  const router = useRouter();
  const [changeWithPassword] = useChangeEmailWithPasswordMutation();
  const byEmail = me.emailConfigured;
  const form = useZodForm(changeEmailForm, { defaultValues: { newEmail: "", password: "" } });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async ({ newEmail, password }) => {
    if (byEmail) {
      const { error } = await authClient.changeEmail({ newEmail, callbackURL: "/settings" });
      if (error) {
        form.setError("root", { message: error.message ?? t("settings3.couldntStartChange") });
        return;
      }
      toast.success(t("settings3.checkYourEmail"), {
        description: me.user.emailVerified
          ? t("settings3.approveChangeFromLink", { current: me.user.email, next: newEmail })
          : t("settings3.confirmChangeFromLink", { next: newEmail }),
      });
    } else {
      if (!password) {
        form.setError("password", { message: t("settings3.enterYourPassword") });
        return;
      }
      try {
        await changeWithPassword({ newEmail, password }).unwrap();
        toast.success(t("settings3.yourEmailIsNow", { email: newEmail.toLowerCase() }));
        await refreshAccount(router);
      } catch (e) {
        form.setError("root", { message: errorMessage(e) });
        return;
      }
    }
    form.reset();
    onOpenChange(false);
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) form.reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("settings3.changeYourEmail")}</DialogTitle>
            <DialogDescription>
              {byEmail
                ? t("settings3.changeEmailByLinkDescription")
                : t("settings3.changeEmailByPasswordDescription")}
            </DialogDescription>
          </DialogHeader>
          <Field id="new-email" label={t("settings3.newEmail")} error={errors.newEmail?.message}>
            <Input
              {...controlProps("new-email", errors.newEmail?.message)}
              {...form.register("newEmail")}
              type="email"
              autoComplete="email"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog's first field; focus moves into a dialog on open
              autoFocus
            />
          </Field>
          {!byEmail && (
            <Field
              id="email-password"
              label={t("settings3.currentPassword")}
              error={errors.password?.message}
            >
              <Input
                {...controlProps("email-password", errors.password?.message)}
                {...form.register("password")}
                type="password"
                autoComplete="current-password"
              />
            </Field>
          )}
          <FormError message={errors.root?.message} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("settings3.cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? t("settings3.saving")
                : byEmail
                  ? t("settings3.sendConfirmation")
                  : t("settings3.changeEmail")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
