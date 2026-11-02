"use client";

import { useState } from "react";
import { Controller } from "react-hook-form";
import { controlProps, Field, FormError, useZodForm } from "@/components/form";
import { ProjectPresetPicker } from "@/components/project-preset-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ProjectDetail } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { onboardingForm } from "@/lib/form-schemas";
import { useT } from "@/lib/i18n/provider";
import { errorMessage } from "@/lib/store/api";
import { useCreateProjectWithPresetMutation } from "@/lib/store/api/onboarding";
import { useRenameWorkspaceMutation } from "@/lib/store/api/people";

/** A unique-enough slug for the new workspace (Better Auth needs one; people never see it). */
const workspaceSlug = (name: string) =>
  `${slugify(name) || "workspace"}-${Math.random().toString(36).slice(2, 6)}`;

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

/**
 * First run: name the workspace (organisation), then the first project and its site. On Cloud the
 * workspace already exists (made with the account), so `workspace` renames it instead, and `onCreated`
 * continues the guided steps rather than leaving for the project page.
 */
export function OnboardingForm({
  workspace,
  onCreated,
}: {
  workspace?: { id: string; name: string };
  onCreated?: (project: ProjectDetail) => void;
}) {
  const t = useT();
  const [createProject] = useCreateProjectWithPresetMutation();
  const [renameWorkspace] = useRenameWorkspaceMutation();
  const form = useZodForm(onboardingForm, {
    defaultValues: { org: workspace?.name ?? "", project: "", site: "", preset: "public-site" },
  });
  // A retry after the project step failed reuses the workspace made on the first try.
  const [createdOrg, setCreatedOrg] = useState<string | null>(workspace?.id ?? null);
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async ({ org, project, site, preset }) => {
    try {
      let orgId = createdOrg;
      if (workspace && org.trim() !== workspace.name) await renameWorkspace({ name: org.trim() }).unwrap();
      if (!orgId) {
        const { data, error } = await authClient.organization.create({
          name: org,
          slug: workspaceSlug(org),
        });
        if (error) throw new Error(error.message ?? t("other1.couldNotCreateWorkspace"));
        orgId = data.id;
        setCreatedOrg(orgId);
      }
      await authClient.organization.setActive({ organizationId: orgId });
      const created = await createProject({
        name: project || site || "My site",
        allowedOrigins: site ? [site] : [],
        preset,
      }).unwrap();
      if (onCreated) {
        onCreated(created.project);
        return;
      }
      // A full load: the app's server components read the new active workspace from the session. The
      // Install tab is the next step: copy the snippet onto the site.
      window.location.assign(
        new URL(`/projects/${created.project.id}?tab=install`, window.location.href).href,
      );
    } catch (e) {
      form.setError("root", { message: errorMessage(e) });
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("other1.setUpYourWorkspace")}</CardTitle>
        <CardDescription>{t("other1.workspaceDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-5">
          <Field id="org" label={t("other1.workspaceName")} error={errors.org?.message}>
            <Input
              {...controlProps("org", errors.org?.message)}
              {...form.register("org")}
              placeholder={t("other1.workspaceNamePlaceholder")}
              // eslint-disable-next-line jsx-a11y/no-autofocus -- onboarding is a single form; start in its first field
              autoFocus
            />
          </Field>
          <Field id="project" label={t("other1.firstProject")} error={errors.project?.message}>
            <Input
              {...controlProps("project", errors.project?.message)}
              {...form.register("project")}
              placeholder={t("other1.firstProjectPlaceholder")}
            />
          </Field>
          <Field
            id="site"
            label={t("other1.websiteDomain")}
            error={errors.site?.message}
            help={t("other1.websiteDomainHelp")}
          >
            <Input
              {...controlProps("site", errors.site?.message, true)}
              {...form.register("site")}
              placeholder="www.example.com"
            />
          </Field>
          <Field id="preset" label={t("other1.whatIsSiteFor")} help={t("other1.siteForHelp")}>
            <Controller
              control={form.control}
              name="preset"
              render={({ field }) => (
                <ProjectPresetPicker id="preset" value={field.value} onChange={field.onChange} />
              )}
            />
          </Field>
          <FormError message={errors.root?.message} />
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? t("other1.settingUp") : t("other1.continue")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
