"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Segmented } from "@/components/segmented";
import { SettingGroup, SettingRow } from "@/components/setting-row";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { authClient, useSession } from "@/lib/auth-client";

export function ProfileSettings() {
  const { data: session, isPending, refetch } = useSession();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => setName(session?.user.name ?? ""), [session?.user.name]);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    const v = name.trim();
    if (!v || v === session?.user.name) return;
    setSaving(true);
    const { error } = await authClient.updateUser({ name: v });
    setSaving(false);
    if (error) return toast.error(error.message ?? "Couldn't save your name");
    toast.success("Name updated");
    refetch();
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>How you appear to your team in comments and assignments.</CardDescription>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <Skeleton className="h-24" />
          ) : (
            <form onSubmit={saveName} className="grid gap-4">
              <div className="flex items-center gap-3">
                <UserAvatar name={session?.user.name} image={session?.user.image} className="size-11" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{session?.user.name}</p>
                  <p className="truncate text-sm text-muted-foreground">{session?.user.email}</p>
                </div>
              </div>
              <div className="grid gap-2 sm:max-w-sm">
                <Label htmlFor="profile-name">Name</Label>
                <div className="flex gap-2">
                  <Input
                    id="profile-name"
                    value={name}
                    maxLength={120}
                    autoComplete="name"
                    onChange={(e) => setName(e.target.value)}
                    aria-invalid={!name.trim() || undefined}
                  />
                  <Button
                    type="submit"
                    disabled={saving || !name.trim() || name.trim() === session?.user.name}
                  >
                    {saving ? "Saving…" : "Save"}
                  </Button>
                </div>
                {!name.trim() && <p className="text-xs text-destructive">Your name can&apos;t be empty</p>}
              </div>
              <div className="grid gap-2 sm:max-w-sm">
                <Label htmlFor="profile-email">Email</Label>
                <Input id="profile-email" value={session?.user.email ?? ""} readOnly disabled />
              </div>
            </form>
          )}
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
                  value={(theme as "light" | "dark" | "system") ?? "system"}
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

function PasswordCard() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const next = String(data.get("new"));
    if (next.length < 8) return setError("Use at least 8 characters");
    if (next !== String(data.get("confirm"))) return setError("The new passwords don't match");
    setPending(true);
    setError(null);
    const { error } = await authClient.changePassword({
      currentPassword: String(data.get("current")),
      newPassword: next,
      revokeOtherSessions: true,
    });
    setPending(false);
    if (error) return setError(error.message ?? "Couldn't change your password");
    form.reset();
    toast.success("Password changed", { description: "Other devices were signed out." });
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Changing it signs you out everywhere else.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-3 sm:max-w-sm">
          <div className="grid gap-2">
            <Label htmlFor="pw-current">Current password</Label>
            <Input id="pw-current" name="current" type="password" autoComplete="current-password" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pw-new">New password</Label>
            <Input
              id="pw-new"
              name="new"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pw-confirm">Confirm new password</Label>
            <Input id="pw-confirm" name="confirm" type="password" autoComplete="new-password" required />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" variant="outline" className="justify-self-start" disabled={pending}>
            {pending ? "Changing…" : "Change password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
