"use client";

import { controlProps, Field, FormError, useZodForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { onboardingForm } from "@/lib/form-schemas";
import { errorMessage, useCreateProjectMutation } from "@/lib/store/api";

/** A unique-enough slug for the new workspace (Better Auth needs one; people never see it). */
const workspaceSlug = (name: string) =>
  `${slugify(name) || "workspace"}-${Math.random().toString(36).slice(2, 6)}`;

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

/** First run: name the workspace (organisation), then the first project and its site. */
export function OnboardingForm() {
  const [createProject] = useCreateProjectMutation();
  const form = useZodForm(onboardingForm, { defaultValues: { org: "", project: "", site: "" } });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async ({ org, project, site }) => {
    try {
      const { data, error } = await authClient.organization.create({
        name: org,
        slug: workspaceSlug(org),
      });
      if (error) throw new Error(error.message ?? "Could not create the workspace");
      await authClient.organization.setActive({ organizationId: data.id });
      const created = await createProject({
        name: project || site || "My site",
        allowedOrigins: site ? [site] : [],
      }).unwrap();
      // A full load: the app's server components read the new active workspace from the session.
      window.location.assign(new URL(`/projects/${created.project.id}`, window.location.href).href);
    } catch (e) {
      form.setError("root", { message: errorMessage(e) });
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Set up your workspace</CardTitle>
        <CardDescription>
          A workspace holds your team and projects. Each project is one website.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-5">
          <Field id="org" label="Workspace name" error={errors.org?.message}>
            <Input
              {...controlProps("org", errors.org?.message)}
              {...form.register("org")}
              placeholder="Acme Studio"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- onboarding is a single form; start in its first field
              autoFocus
            />
          </Field>
          <Field id="project" label="First project" error={errors.project?.message}>
            <Input
              {...controlProps("project", errors.project?.message)}
              {...form.register("project")}
              placeholder="Marketing site"
            />
          </Field>
          <Field
            id="site"
            label="Website domain"
            error={errors.site?.message}
            help="Only this domain will be allowed to send feedback. You can add more later."
          >
            <Input
              {...controlProps("site", errors.site?.message, true)}
              {...form.register("site")}
              placeholder="www.example.com"
            />
          </Field>
          <FormError message={errors.root?.message} />
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Setting up…" : "Continue"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
