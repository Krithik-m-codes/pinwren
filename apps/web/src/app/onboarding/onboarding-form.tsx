"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

/** First run: name the workspace (organisation), then the first project and its site. */
export function OnboardingForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const orgName = String(form.get("org")).trim();
    const site = String(form.get("site")).trim();
    setPending(true);
    setError(null);
    try {
      const { data: org, error } = await authClient.organization.create({
        name: orgName,
        slug: `${slugify(orgName) || "workspace"}-${Math.random().toString(36).slice(2, 6)}`,
      });
      if (error || !org) throw new Error(error?.message ?? "Could not create the workspace");
      await authClient.organization.setActive({ organizationId: org.id });
      const host = site.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      const { project } = await api<{ project: { id: string } }>("/projects", {
        method: "POST",
        json: {
          name: String(form.get("project")).trim() || host || "My site",
          allowedOrigins: host ? [host] : [],
        },
      });
      router.replace(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Set up your workspace</CardTitle>
        <CardDescription>
          A workspace holds your team and projects. Each project is one website.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="org">Workspace name</Label>
            <Input id="org" name="org" placeholder="Acme Studio" required autoFocus />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="project">First project</Label>
            <Input id="project" name="project" placeholder="Marketing site" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="site">Website domain</Label>
            <Input id="site" name="site" placeholder="www.example.com" />
            <p className="text-xs text-muted-foreground">
              Only this domain will be allowed to send feedback. You can add more later.
            </p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Setting up…" : "Continue"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
