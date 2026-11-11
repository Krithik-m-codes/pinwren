"use client";

import { MAX_RELEASE_NOTES, releaseCommit, releaseVersion } from "@pinwren/core";
import { Loader2, Plus, Rocket, Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useWatch } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton } from "@/components/copy-button";
import { controlProps, Field, useZodForm } from "@/components/form";
import { SettingGroup, SettingRow } from "@/components/setting-row";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ProjectDetail } from "@/lib/api";
import { useI18n, useT } from "@/lib/i18n/provider";
import {
  errorMessage,
  type Release,
  useDeleteReleaseMutation,
  useRecordReleaseMutation,
  useReleasesQuery,
} from "@/lib/store/api";
import { LocalDate } from "@/components/feedback-meta";
import { useViewer } from "@/lib/viewer";
import { useProjectPatch } from "./use-project";

/** The record form: blank commit and notes are left out of the request. */
const releaseForm = z.object({
  version: releaseVersion,
  commit: z.union([z.literal(""), releaseCommit]),
  notes: z.string().trim().max(MAX_RELEASE_NOTES),
});

/**
 * Settings › Releases (ADR 0033): the project's releases with the items fixed in each and the regressions
 * reported from it, the two regression switches, and how CI records a release. Admins record and delete;
 * everyone else reads.
 */
export function ReleasesTab({ project }: { project: ProjectDetail }) {
  const t = useT();
  const { isAdmin } = useViewer();
  const releases = useReleasesQuery(project.id);
  // A fresh form after each record: the live list re-renders around it, and a remount is the one clear that sticks.
  const [formKey, setFormKey] = useState(0);
  const list = releases.data?.releases ?? [];

  return (
    <div className="grid max-w-4xl gap-4">
      <RegressionSettings project={project} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Rocket className="size-4" /> {t("releases.title")}
          </CardTitle>
          <CardDescription>{t("releases.intro")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isAdmin && (
            <NewRelease key={formKey} projectId={project.id} onRecorded={() => setFormKey((k) => k + 1)} />
          )}
          {releases.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : releases.isError ? (
            <ErrorState error={releases.error} retry={() => void releases.refetch()} />
          ) : list.length === 0 ? (
            <EmptyState
              icon={Rocket}
              title={t("releases.empty")}
              description={t("releases.emptyHint")}
              className="py-8"
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[34rem] text-sm" data-testid="release-table">
                <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t("releases.colVersion")}</th>
                    <th className="px-3 py-2 font-medium">{t("releases.colDeployed")}</th>
                    <th className="px-3 py-2 font-medium">{t("releases.colCommit")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("releases.colFixed")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("releases.colRegressions")}</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {list.map((r) => (
                    <ReleaseRow key={r.id} release={r} projectId={project.id} canWrite={isAdmin} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      <CiCard project={project} />
    </div>
  );
}

function RegressionSettings({ project: p }: { project: ProjectDetail }) {
  const t = useT();
  const save = useProjectPatch(p.id);
  const detect = p.detectRegressions ?? true;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TriangleAlert className="size-4" /> {t("releases.detectTitle")}
        </CardTitle>
        <CardDescription>{t("releases.detectBody")}</CardDescription>
      </CardHeader>
      <CardContent>
        <SettingGroup>
          <SettingRow label={t("releases.detectSwitch")} htmlFor="detect-regressions">
            <Switch
              id="detect-regressions"
              checked={detect}
              disabled={save.isPending}
              onCheckedChange={(detectRegressions) => save.mutate({ patch: { detectRegressions } })}
            />
          </SettingRow>
          <SettingRow
            label={t("releases.reopenSwitch")}
            htmlFor="reopen-regressions"
            description={t("releases.reopenHint")}
          >
            <Switch
              id="reopen-regressions"
              checked={p.autoReopenRegressions ?? false}
              disabled={!detect || save.isPending}
              onCheckedChange={(autoReopenRegressions) => save.mutate({ patch: { autoReopenRegressions } })}
            />
          </SettingRow>
        </SettingGroup>
      </CardContent>
    </Card>
  );
}

function NewRelease({ projectId, onRecorded }: { projectId: string; onRecorded: () => void }) {
  const { t, tn } = useI18n();
  const [record] = useRecordReleaseMutation();
  const form = useZodForm(releaseForm, {
    defaultValues: { version: "", commit: "", notes: "" },
  });
  const { isSubmitting, errors } = form.formState;
  const version = useWatch({ control: form.control, name: "version" });
  const submit = form.handleSubmit(async (v) => {
    try {
      const out = await record({
        projectId,
        release: {
          version: v.version,
          ...(v.commit ? { commit: v.commit } : {}),
          ...(v.notes ? { notes: v.notes } : {}),
        },
      }).unwrap();
      toast.success(
        t(out.created ? "releases.recorded" : "releases.updated", { version: out.release.version }),
        {
          ...(out.adopted
            ? { description: tn("releases.adopted", out.adopted, { version: out.release.version }) }
            : {}),
        },
      );
      onRecorded();
    } catch (e) {
      toast.error(t("releases.recordFailed"), { description: errorMessage(e) });
    }
  });
  return (
    <form className="grid gap-3 sm:grid-cols-[1fr_1fr]" noValidate onSubmit={(e) => void submit(e)}>
      <Field id="release-version" label={t("releases.versionLabel")} error={errors.version?.message}>
        <Input
          {...form.register("version")}
          {...controlProps("release-version", errors.version?.message)}
          placeholder={t("releases.versionPlaceholder")}
          maxLength={100}
          autoComplete="off"
        />
      </Field>
      <Field id="release-commit" label={t("releases.commitLabel")} error={errors.commit?.message}>
        <Input
          {...form.register("commit")}
          {...controlProps("release-commit", errors.commit?.message)}
          placeholder={t("releases.commitPlaceholder")}
          maxLength={64}
          autoComplete="off"
        />
      </Field>
      <Field
        id="release-notes"
        label={t("releases.notesLabel")}
        error={errors.notes?.message}
        className="sm:col-span-2"
      >
        <Textarea
          {...form.register("notes")}
          {...controlProps("release-notes", errors.notes?.message)}
          placeholder={t("releases.notesPlaceholder")}
          maxLength={MAX_RELEASE_NOTES}
          rows={2}
        />
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={!version.trim() || isSubmitting}>
          {isSubmitting ? <Loader2 className="animate-spin" /> : <Plus />} {t("releases.add")}
        </Button>
      </div>
    </form>
  );
}

function ReleaseRow({
  release: r,
  projectId,
  canWrite,
}: {
  release: Release;
  projectId: string;
  canWrite: boolean;
}) {
  const t = useT();
  const [remove, removing] = useDeleteReleaseMutation();
  const [confirming, setConfirming] = useState(false);
  return (
    <tr data-release={r.version}>
      <td className="px-3 py-2 font-medium">{r.version}</td>
      <td className="px-3 py-2 text-muted-foreground">
        <LocalDate iso={r.deployedAt} />
      </td>
      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.commit?.slice(0, 10) ?? ""}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {r.fixedCount > 0 ? (
          <Link
            href={`/inbox?project=${projectId}&fixedIn=${r.id}&status=all`}
            className="underline-offset-4 hover:underline"
            aria-label={t("releases.openFixed", { version: r.version })}
          >
            {r.fixedCount}
          </Link>
        ) : (
          r.fixedCount
        )}
      </td>
      <td
        className={
          r.regressionCount > 0
            ? "px-3 py-2 text-right text-amber-700 tabular-nums dark:text-amber-400"
            : "px-3 py-2 text-right text-muted-foreground tabular-nums"
        }
      >
        {r.regressionCount}
      </td>
      <td className="px-1 py-1 text-right">
        {canWrite && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("releases.delete", { version: r.version })}
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setConfirming(true)}
            >
              <Trash2 />
            </Button>
            <ConfirmDialog
              open={confirming}
              onOpenChange={setConfirming}
              title={t("releases.deleteTitle", { version: r.version })}
              description={t("releases.deleteBody")}
              pending={removing.isLoading}
              onConfirm={() =>
                remove(r.id)
                  .unwrap()
                  .then(() => {
                    setConfirming(false);
                    toast.success(t("releases.deleted", { version: r.version }));
                  })
                  .catch((e: unknown) =>
                    toast.error(t("releases.deleteFailed"), { description: errorMessage(e) }),
                  )
              }
            />
          </>
        )}
      </td>
    </tr>
  );
}

/** How CI records a release, and how the widget says which release a report came from. */
function CiCard({ project }: { project: ProjectDetail }) {
  const t = useT();
  const url = project.publicUrl;
  const curl = `curl -X POST ${url}/api/v1/projects/${project.id}/releases \\
  -H "Authorization: Bearer $PINWREN_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"version":"'"$VERSION"'","commit":"'"$GIT_SHA"'"}'`;
  const cli = `npx @pinwren/cli release create "$VERSION" --project ${project.slug} --commit "$GIT_SHA" --url ${url}`;
  const widget = `<script src="${url}/widget.js" data-project="${project.publicKey}" data-release="1.4.0" async></script>`;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("releases.ciTitle")}</CardTitle>
        <CardDescription>{t("releases.ciBody")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {[
          { label: t("releases.ciCurl"), code: curl },
          { label: t("releases.ciCli"), code: cli },
        ].map((s) => (
          <div key={s.label} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{s.label}</span>
              <CopyButton value={s.code} label={t("releases.copy")} />
            </div>
            <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 text-xs">
              <code>{s.code}</code>
            </pre>
          </div>
        ))}
        <div className="space-y-1 border-t pt-4">
          <p className="text-sm font-medium">{t("releases.widgetTitle")}</p>
          <p className="text-sm text-muted-foreground">{t("releases.widgetBody")}</p>
          <div className="flex items-start gap-2">
            <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg border bg-muted/40 p-3 text-xs">
              <code>{widget}</code>
            </pre>
            <CopyButton value={widget} label={t("releases.copy")} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
