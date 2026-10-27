"use client";

import { Download, FileArchive, Loader2, UserX } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LocalDate, RelativeTime } from "@/components/feedback-meta";
import { controlProps, Field, FormError, useZodForm } from "@/components/form";
import { ErrorState } from "@/components/states";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes, type ProjectDetail } from "@/lib/api";
import type { TFn } from "@/lib/i18n/english";
import { useI18n, useT } from "@/lib/i18n/provider";
import { errorMessage } from "@/lib/store/api";
import {
  type EraseResult,
  useEraseReporterMutation,
  useErasuresQuery,
  useProjectExportQuery,
  useRequestProjectExportMutation,
} from "@/lib/store/api/onboarding";
import { useMembers } from "@/lib/viewer";

/**
 * Project data export (F-095): a background job builds one zip (feedback JSON + every file); the card polls
 * until it is ready and then offers the download for 7 days. Admins only (the API refuses others).
 */
export function DataExportCard({ project }: { project: ProjectDetail }) {
  const t = useT();
  const [poll, setPoll] = useState(false);
  const query = useProjectExportQuery(project.id, { pollingInterval: poll ? 3000 : 0 });
  const [request, requesting] = useRequestProjectExportMutation();
  const exp = query.data?.export ?? null;
  const busy = exp?.status === "pending" || exp?.status === "running";
  // Poll only while the job runs; the state is derived from the last answer, never set from an effect.
  if (busy !== poll) setPoll(busy);

  const start = () =>
    request(project.id)
      .unwrap()
      .then(() =>
        toast.success(t("projects1.exportStarted"), { description: t("projects1.exportReadySoon") }),
      )
      .catch((e: unknown) => toast.error(t("projects1.exportNotStarted"), { description: errorMessage(e) }));

  return (
    <Card data-testid="data-export">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileArchive className="size-4 text-muted-foreground" /> {t("projects1.exportThisProject")}
        </CardTitle>
        <CardDescription>{t("projects1.exportDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {query.isLoading && <Skeleton className="h-10 w-full" />}
        {query.isError && <ErrorState error={query.error} retry={() => void query.refetch()} />}
        {query.isSuccess && (
          <>
            {busy && (
              <p
                className="flex items-center gap-2 text-sm text-muted-foreground"
                data-testid="export-running"
              >
                <Loader2 className="size-4 animate-spin" /> {t("projects1.preparingExport")}
              </p>
            )}
            {exp?.status === "ready" && exp.downloadUrl && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  {t("projects1.exportCounts", { items: exp.items ?? 0, assets: exp.assets ?? 0 })}
                  {exp.bytes !== null && ` · ${formatBytes(exp.bytes)}`}
                  {!!exp.skippedAssets && ` · ${t("projects1.filesLeftOut", { n: exp.skippedAssets })}`}
                  {exp.expiresAt && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {t("projects1.availableUntil")} <LocalDate iso={exp.expiresAt} />
                    </span>
                  )}
                </span>
                {/* A real link: the browser downloads the zip with the session cookie. */}
                <a
                  href={exp.downloadUrl}
                  download
                  className={buttonVariants({ size: "sm" })}
                  data-testid="export-download"
                >
                  <Download /> {t("projects1.download")}
                </a>
              </div>
            )}
            {exp?.status === "failed" && (
              <p className="text-sm text-destructive" role="alert">
                {t("projects1.lastExportFailed", { detail: exp.error ? `: ${exp.error}` : "" })}
              </p>
            )}
            <Button
              variant="outline"
              className="w-fit"
              disabled={busy || requesting.isLoading}
              onClick={() => void start()}
            >
              {exp?.status === "ready" ? t("projects1.exportAgain") : t("projects1.exportProjectData")}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const eraseForm = (t: TFn) => z.object({ email: z.email(t("projects1.enterReporterEmail")).max(254) });

/**
 * "Erase everything from a reporter" (GDPR): every report they filed, every reply they wrote and the
 * email log for their address, in the whole workspace. A dry run counts first; the confirm shows it.
 */
export function EraseReporterCard() {
  const { t, tn } = useI18n();
  const schema = useMemo(() => eraseForm(t), [t]);
  const [erase, erasure] = useEraseReporterMutation();
  const erasures = useErasuresQuery(undefined);
  const members = useMembers();
  const [preview, setPreview] = useState<{ email: string; result: EraseResult } | null>(null);
  const [erasing, setErasing] = useState(false);
  const form = useZodForm(schema, { defaultValues: { email: "" } });
  const { errors, isSubmitting } = form.formState;

  const check = form.handleSubmit(async ({ email }) => {
    try {
      const { result } = await erase({ email, dryRun: true }).unwrap();
      setPreview({ email, result });
    } catch (e) {
      form.setError("root", { message: errorMessage(e) });
    }
  });

  const nothing = preview && !preview.result.feedback && !preview.result.comments && !preview.result.emails;
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? t("projects1.formerMember");

  return (
    <Card data-testid="erase-reporter">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserX className="size-4 text-muted-foreground" /> {t("projects1.eraseReporterData")}
        </CardTitle>
        <CardDescription>{t("projects1.eraseReporterDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form className="grid gap-2" noValidate onSubmit={(e) => void check(e)}>
          <Field id="erase-email" label={t("projects1.reporterEmail")} error={errors.email?.message}>
            <div className="flex gap-2">
              <Input
                {...controlProps("erase-email", errors.email?.message)}
                {...form.register("email")}
                type="email"
                autoComplete="off"
                placeholder="visitor@example.com"
              />
              <Button type="submit" variant="outline" disabled={isSubmitting}>
                {isSubmitting ? t("projects1.checking") : t("projects1.findData")}
              </Button>
            </div>
          </Field>
          <FormError message={errors.root?.message} />
        </form>
        {nothing && (
          <p className="text-sm text-muted-foreground" data-testid="erase-nothing">
            {t("projects1.nothingSentWith", { email: preview.email })}
          </p>
        )}
        {preview && !nothing && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1" data-testid="erase-preview">
              {t("projects1.erasePreview", {
                email: preview.email,
                reports: tn("projects1.reportCount", preview.result.feedback),
                replies: tn("projects1.replyCount", preview.result.comments),
                emails: tn("projects1.loggedEmailCount", preview.result.emails),
              })}
            </span>
            <Button size="sm" variant="destructive" onClick={() => setErasing(true)}>
              {t("projects1.eraseEllipsis")}
            </Button>
          </div>
        )}
        {!!erasures.data?.erasures.length && (
          <div className="grid gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">{t("projects1.recentErasures")}</p>
            <ul className="grid gap-1 text-xs text-muted-foreground" data-testid="erasure-log">
              {erasures.data.erasures.map((r) => (
                <li key={`${r.at}-${r.emailSha256}`}>
                  <RelativeTime iso={r.at} /> ·{" "}
                  {t("projects1.erasureLogEntry", {
                    name: nameOf(r.by),
                    reports: tn("projects1.reportCount", r.feedback),
                    replies: tn("projects1.replyCount", r.comments),
                  })}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
      <ConfirmDialog
        open={erasing}
        onOpenChange={setErasing}
        title={t("projects1.eraseEverythingTitle", { email: preview?.email ?? "" })}
        description={t("projects1.eraseEverythingDescription")}
        confirmLabel={t("projects1.erase")}
        pending={erasure.isLoading}
        onConfirm={() => {
          if (!preview) return;
          erase({ email: preview.email })
            .unwrap()
            .then(({ result }) => {
              toast.success(t("projects1.reporterDataErased"), {
                description: t("projects1.erasedRemoved", {
                  reports: tn("projects1.reportCount", result.feedback),
                  replies: tn("projects1.replyCount", result.comments),
                }),
              });
              setErasing(false);
              setPreview(null);
              form.reset({ email: "" });
            })
            .catch((e: unknown) => toast.error(t("projects1.notErased"), { description: errorMessage(e) }));
        }}
      />
    </Card>
  );
}
