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
import { errorMessage } from "@/lib/store/api";
import { useChangeEmailWithPasswordMutation, useSaveProfileMutation } from "@/lib/store/api/people";
import { useMounted } from "@/lib/use-synced-state";
import { useViewer } from "@/lib/viewer";
import { DeleteAccountCard, PasswordCard, SessionsCard, TwoFactorCard } from "./account-security";
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
  const { me } = useViewer();
  const { theme, setTheme } = useTheme();
  // The theme is only known on the client; render its control after hydration.
  const mounted = useMounted();

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>How you appear to your team in comments and assignments.</CardDescription>
        </CardHeader>
        <CardContent>{!me ? <Skeleton className="h-40" /> : <ProfileForm me={me} />}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Saved on this device.</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingGroup>
            <SettingRow label="Theme" description="System follows your operating system.">
              {mounted ? (
                <Segmented
                  label="Theme"
                  value={(theme ?? "system") as "light" | "dark" | "system"}
                  onChange={setTheme}
                  options={[
                    {
                      value: "light",
                      label: (
                        <>
                          <Sun /> Light
                        </>
                      ),
                    },
                    {
                      value: "dark",
                      label: (
                        <>
                          <Moon /> Dark
                        </>
                      ),
                    },
                    {
                      value: "system",
                      label: (
                        <>
                          <Monitor /> System
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
  const router = useRouter();
  const [saveProfile] = useSaveProfileMutation();
  const form = useZodForm(profileForm, { defaultValues: { name }, mode: "onChange" });
  const { errors, isSubmitting, isDirty } = form.formState;
  const submit = form.handleSubmit(async (v) => {
    if (v.name === name) return;
    try {
      await saveProfile({ name: v.name }).unwrap();
      toast.success("Name updated");
      await refreshAccount(router);
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't save your name"));
    }
  });
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-2 sm:max-w-sm">
      <Label htmlFor="profile-name">Name</Label>
      <div className="flex gap-2">
        <Input
          {...controlProps("profile-name", errors.name?.message)}
          {...form.register("name")}
          maxLength={120}
          autoComplete="name"
        />
        <Button type="submit" disabled={isSubmitting || !isDirty || !!errors.name}>
          {isSubmitting ? "Saving…" : "Save"}
        </Button>
      </div>
      <FieldError id="profile-name" message={errors.name?.message} />
    </form>
  );
}

/** The address notifications go to: whether it's confirmed, resending the link, and changing it. */
function EmailRow({ me }: { me: MeResponse }) {
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
    if (error) toast.error(error.message ?? "Couldn't send the link");
    else toast.success(`Link sent to ${me.user.email}`, { description: "It works for 24 hours." });
  }

  return (
    <div className="grid gap-2 sm:max-w-sm">
      <Label htmlFor="profile-email">Email</Label>
      <div className="flex gap-2">
        <Input id="profile-email" value={me.user.email} readOnly className="bg-muted/40" />
        <Button type="button" variant="outline" onClick={() => setChanging(true)}>
          Change
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {verified ? (
          <Badge variant="secondary" className="gap-1 font-normal" data-testid="email-verified">
            <BadgeCheck className="size-3.5 text-emerald-600" /> Verified
          </Badge>
        ) : (
          <>
            <Badge variant="outline" className="gap-1 font-normal" data-testid="email-unverified">
              <CircleAlert className="size-3.5 text-amber-600" /> Not verified
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
                {sending ? "Sending…" : "Send the confirmation link again"}
              </Button>
            ) : (
              <span>Email isn&apos;t set up on this server, so there is nothing to confirm yet.</span>
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
  const router = useRouter();
  const [changeWithPassword] = useChangeEmailWithPasswordMutation();
  const byEmail = me.emailConfigured;
  const form = useZodForm(changeEmailForm, { defaultValues: { newEmail: "", password: "" } });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async ({ newEmail, password }) => {
    if (byEmail) {
      const { error } = await authClient.changeEmail({ newEmail, callbackURL: "/settings" });
      if (error) {
        form.setError("root", { message: error.message ?? "Couldn't start the change" });
        return;
      }
      toast.success("Check your email", {
        description: me.user.emailVerified
          ? `Approve the change from the link sent to ${me.user.email}, then confirm ${newEmail}.`
          : `Confirm the change from the link sent to ${newEmail}.`,
      });
    } else {
      if (!password) {
        form.setError("password", { message: "Enter your password" });
        return;
      }
      try {
        await changeWithPassword({ newEmail, password }).unwrap();
        toast.success(`Your email is now ${newEmail.toLowerCase()}`);
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
            <DialogTitle>Change your email</DialogTitle>
            <DialogDescription>
              {byEmail
                ? "We email a confirmation link. Your address changes once it's confirmed."
                : "Email isn't set up on this server, so confirm the change with your password."}
            </DialogDescription>
          </DialogHeader>
          <Field id="new-email" label="New email" error={errors.newEmail?.message}>
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
            <Field id="email-password" label="Current password" error={errors.password?.message}>
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
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : byEmail ? "Send confirmation" : "Change email"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
