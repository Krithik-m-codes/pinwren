"use client";

import { FolderPlus, Globe } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RelativeTime } from "@/components/feedback-meta";
import { PageHeader } from "@/components/page-header";
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
import { Skeleton } from "@/components/ui/skeleton";
import { controlProps, Field, FormError, useZodForm } from "@/components/form";
import { createProjectForm } from "@/lib/form-schemas";
import { Controller } from "react-hook-form";
import { ProjectPresetPicker } from "@/components/project-preset-picker";
import { errorMessage, useProjectsQuery } from "@/lib/store/api";
import { useCreateProjectWithPresetMutation } from "@/lib/store/api/onboarding";
import { useViewer } from "@/lib/viewer";
import { here } from "@/lib/routes";
import { useT } from "@/lib/i18n/provider";

export function ProjectsView() {
  const t = useT();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const projects = useProjectsQuery(undefined);
  // Creating projects is an Admin permission (projects.manage, wave-5 §3.7).
  const { isAdmin: canCreate } = useViewer();
  const creating = canCreate && params.get("new") === "1";
  const setCreating = (open: boolean) => router.replace(here(pathname, open ? "new=1" : undefined));

  return (
    <>
      <PageHeader title={t("projects2.projects")}>
        {canCreate && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <FolderPlus /> {t("projects2.newProject")}
          </Button>
        )}
      </PageHeader>
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {projects.isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-36" />)}
        {projects.data?.projects.map((p) => (
          <Link key={p.id} href={`/projects/${p.id}`} className="group">
            <Card className="h-full transition-colors group-hover:border-foreground/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {p.name}
                  {p.lastSeenAt ? (
                    <Badge variant="secondary" className="ml-auto gap-1 font-normal">
                      <span className="size-1.5 rounded-full bg-emerald-500" /> {t("projects2.installed")}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="ml-auto font-normal">
                      {t("projects2.notInstalled")}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="flex items-center gap-1.5 truncate">
                  <Globe className="size-3.5 shrink-0" />
                  {p.allowedOrigins.join(", ") || t("projects2.noAllowedSites")}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  <span className="font-medium text-foreground tabular-nums">{p.openCount ?? 0}</span>{" "}
                  {t("projects2.openSuffix")}
                </span>
                <span>
                  {p.lastSeenAt ? t("projects2.seen") : t("projects2.created")}{" "}
                  <RelativeTime iso={p.lastSeenAt ?? p.createdAt} />
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
        {projects.data?.projects.length === 0 && (
          <Card className="sm:col-span-2 xl:col-span-3">
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <FolderPlus className="size-6 text-muted-foreground" />
              <p className="font-medium">{t("projects2.createFirstProject")}</p>
              <p className="max-w-sm text-sm text-muted-foreground">{t("projects2.projectIsOneWebsite")}</p>
              {canCreate && (
                <Button size="sm" onClick={() => setCreating(true)}>
                  {t("projects2.newProject")}
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>
      <CreateProjectDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

function CreateProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open && <CreateProjectForm onCancel={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function CreateProjectForm({ onCancel }: { onCancel: () => void }) {
  const t = useT();
  const router = useRouter();
  const [create] = useCreateProjectWithPresetMutation();
  const form = useZodForm(createProjectForm, {
    defaultValues: { name: "", site: "", preset: "public-site" },
  });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async ({ name, site, preset }) => {
    try {
      const { project } = await create({ name, allowedOrigins: site ? [site] : [], preset }).unwrap();
      // Straight to the Install tab: the snippet is the next thing to do.
      router.push(`/projects/${project.id}?tab=install`);
    } catch (e) {
      form.setError("root", { message: errorMessage(e) });
    }
  });

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t("projects2.newProject")}</DialogTitle>
        <DialogDescription>{t("projects2.oneProjectPerWebsite")}</DialogDescription>
      </DialogHeader>
      <Field id="p-name" label={t("projects2.name")} error={errors.name?.message}>
        <Input
          {...controlProps("p-name", errors.name?.message)}
          {...form.register("name")}
          placeholder={t("projects2.marketingSite")}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog's first field; focus moves into a dialog on open
          autoFocus
        />
      </Field>
      <Field id="p-site" label={t("projects2.websiteDomain")} error={errors.site?.message}>
        <Input
          {...controlProps("p-site", errors.site?.message)}
          {...form.register("site")}
          placeholder="www.example.com"
        />
      </Field>
      <Field id="p-preset" label={t("projects2.whatIsSiteFor")} help={t("projects2.changeLaterPrivacy")}>
        <Controller
          control={form.control}
          name="preset"
          render={({ field }) => (
            <ProjectPresetPicker id="p-preset" value={field.value} onChange={field.onChange} />
          )}
        />
      </Field>
      <FormError message={errors.root?.message} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("projects2.cancel")}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t("projects2.creating") : t("projects2.createProject")}
        </Button>
      </DialogFooter>
    </form>
  );
}
