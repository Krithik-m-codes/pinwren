"use client";

import { Download, FileArchive, Loader2, UserX } from "lucide-react";
import { useState } from "react";
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
      .then(() => toast.success("Export started", { description: "It's ready in a minute or two." }))
      .catch((e: unknown) => toast.error("Export not started", { description: errorMessage(e) }));

  return (
    <Card data-testid="data-export">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileArchive className="size-4 text-muted-foreground" /> Export this project
        </CardTitle>
        <CardDescription>
          Everything in one zip: every report with its comments and activity as JSON, plus screenshots,
          attachments and replays.
        </CardDescription>
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
                <Loader2 className="size-4 animate-spin" /> Preparing the export… you can leave this page.
              </p>
            )}
            {exp?.status === "ready" && exp.downloadUrl && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  {exp.items ?? 0} reports, {exp.assets ?? 0} files
                  {exp.bytes !== null && ` · ${formatBytes(exp.bytes)}`}
                  {!!exp.skippedAssets && ` · ${exp.skippedAssets} files left out (see README.txt)`}
                  {exp.expiresAt && (
                    <span className="text-muted-foreground">
                      {" "}
                      · available until <LocalDate iso={exp.expiresAt} />
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
                  <Download /> Download
                </a>
              </div>
            )}
            {exp?.status === "failed" && (
              <p className="text-sm text-destructive" role="alert">
                The last export failed{exp.error ? `: ${exp.error}` : ""}. Try again.
              </p>
            )}
            <Button
              variant="outline"
              className="w-fit"
              disabled={busy || requesting.isLoading}
              onClick={() => void start()}
            >
              {exp?.status === "ready" ? "Export again" : "Export project data"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const eraseForm = z.object({ email: z.email("Enter the reporter's email address").max(254) });

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * "Erase everything from a reporter" (GDPR): every report they filed, every reply they wrote and the
 * email log for their address, in the whole workspace. A dry run counts first; the confirm shows it.
 */
export function EraseReporterCard() {
  const [erase, erasure] = useEraseReporterMutation();
  const erasures = useErasuresQuery(undefined);
  const members = useMembers();
  const [preview, setPreview] = useState<{ email: string; result: EraseResult } | null>(null);
  const [erasing, setErasing] = useState(false);
  const form = useZodForm(eraseForm, { defaultValues: { email: "" } });
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
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "A former member";

  return (
    <Card data-testid="erase-reporter">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserX className="size-4 text-muted-foreground" /> Erase a reporter&apos;s data
        </CardTitle>
        <CardDescription>
          For a deletion request: removes every report and reply sent with this email address, across all
          projects of the workspace, with their files. This can&apos;t be undone.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form className="grid gap-2" noValidate onSubmit={(e) => void check(e)}>
          <Field id="erase-email" label="Reporter's email" error={errors.email?.message}>
            <div className="flex gap-2">
              <Input
                {...controlProps("erase-email", errors.email?.message)}
                {...form.register("email")}
                type="email"
                autoComplete="off"
                placeholder="visitor@example.com"
              />
              <Button type="submit" variant="outline" disabled={isSubmitting}>
                {isSubmitting ? "Checking…" : "Find data"}
              </Button>
            </div>
          </Field>
          <FormError message={errors.root?.message} />
        </form>
        {nothing && (
          <p className="text-sm text-muted-foreground" data-testid="erase-nothing">
            Nothing was sent with {preview.email}.
          </p>
        )}
        {preview && !nothing && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1" data-testid="erase-preview">
              {preview.email}: {plural(preview.result.feedback, "report")},{" "}
              {plural(preview.result.comments, "reply", "replies")} on other reports,{" "}
              {plural(preview.result.emails, "logged email")}.
            </span>
            <Button size="sm" variant="destructive" onClick={() => setErasing(true)}>
              Erase…
            </Button>
          </div>
        )}
        {!!erasures.data?.erasures.length && (
          <div className="grid gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">Recent erasures</p>
            <ul className="grid gap-1 text-xs text-muted-foreground" data-testid="erasure-log">
              {erasures.data.erasures.map((r) => (
                <li key={`${r.at}-${r.emailSha256}`}>
                  <RelativeTime iso={r.at} /> · {nameOf(r.by)} erased {plural(r.feedback, "report")} and{" "}
                  {plural(r.comments, "reply", "replies")}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
      <ConfirmDialog
        open={erasing}
        onOpenChange={setErasing}
        title={`Erase everything from ${preview?.email ?? ""}?`}
        description="The reports, replies, screenshots and files go for good, in every project. A record that an erasure happened is kept, without the address."
        confirmLabel="Erase"
        pending={erasure.isLoading}
        onConfirm={() => {
          if (!preview) return;
          erase({ email: preview.email })
            .unwrap()
            .then(({ result }) => {
              toast.success("Reporter data erased", {
                description: `${plural(result.feedback, "report")} and ${plural(result.comments, "reply", "replies")} removed.`,
              });
              setErasing(false);
              setPreview(null);
              form.reset({ email: "" });
            })
            .catch((e: unknown) => toast.error("Not erased", { description: errorMessage(e) }));
        }}
      />
    </Card>
  );
}
