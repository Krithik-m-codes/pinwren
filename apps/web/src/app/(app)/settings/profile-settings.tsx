"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { controlProps, Field, FieldError, FormError, useZodForm } from "@/components/form";
import { Segmented } from "@/components/segmented";
import { SettingGroup, SettingRow } from "@/components/setting-row";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { authClient } from "@/lib/auth-client";
import { changePasswordForm, profileForm } from "@/lib/form-schemas";
import { errorMessage, useUpdateProfileMutation } from "@/lib/store/api";
import { useMounted } from "@/lib/use-synced-state";
import { useViewer } from "@/lib/viewer";

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
        <CardContent>
          {!me ? <Skeleton className="h-24" /> : <NameForm key={me.user.name} user={me.user} />}
        </CardContent>
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
    </div>
  );
}

function NameForm({ user }: { user: { name: string; email: string; image: string | null } }) {
  const router = useRouter();
  const [updateProfile] = useUpdateProfileMutation();
  const form = useZodForm(profileForm, { defaultValues: { name: user.name }, mode: "onChange" });
  const { errors, isSubmitting, isDirty } = form.formState;
  const submit = form.handleSubmit(async ({ name }) => {
    if (name === user.name) return;
    try {
      await updateProfile({ name }).unwrap();
      toast.success("Name updated");
      // The sidebar's account menu is rendered on the server from the session.
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't save your name"));
    }
  });
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
      <div className="flex items-center gap-3">
        <UserAvatar name={user.name} image={user.image} className="size-11" />
        <div className="min-w-0">
          <p className="truncate font-medium">{user.name}</p>
          <p className="truncate text-sm text-muted-foreground">{user.email}</p>
        </div>
      </div>
      <div className="grid gap-2 sm:max-w-sm">
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
      </div>
      <div className="grid gap-2 sm:max-w-sm">
        <Label htmlFor="profile-email">Email</Label>
        <Input id="profile-email" value={user.email} readOnly disabled />
      </div>
    </form>
  );
}

function PasswordCard() {
  const form = useZodForm(changePasswordForm, { defaultValues: { current: "", next: "", confirm: "" } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async ({ current, next }) => {
    const { error } = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    });
    if (error) {
      form.setError("root", { message: error.message ?? "Couldn't change your password" });
      return;
    }
    form.reset();
    toast.success("Password changed", { description: "Other devices were signed out." });
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Changing it signs you out everywhere else.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-3 sm:max-w-sm">
          <Field id="pw-current" label="Current password" error={errors.current?.message}>
            <Input
              {...controlProps("pw-current", errors.current?.message)}
              {...form.register("current")}
              type="password"
              autoComplete="current-password"
            />
          </Field>
          <Field id="pw-new" label="New password" error={errors.next?.message}>
            <Input
              {...controlProps("pw-new", errors.next?.message)}
              {...form.register("next")}
              type="password"
              autoComplete="new-password"
            />
          </Field>
          <Field id="pw-confirm" label="Confirm new password" error={errors.confirm?.message}>
            <Input
              {...controlProps("pw-confirm", errors.confirm?.message)}
              {...form.register("confirm")}
              type="password"
              autoComplete="new-password"
            />
          </Field>
          <FormError message={errors.root?.message} />
          <Button type="submit" variant="outline" className="justify-self-start" disabled={isSubmitting}>
            {isSubmitting ? "Changing…" : "Change password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
