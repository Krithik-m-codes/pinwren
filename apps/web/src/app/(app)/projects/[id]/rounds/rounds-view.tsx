"use client";

import {
  CalendarClock,
  CircleCheck,
  Download,
  FileText,
  Inbox,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Settings,
  Target,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Controller } from "react-hook-form";
import { toast } from "sonner";
import { ButtonLink } from "@/components/button-link";
import { LocalDate } from "@/components/feedback-meta";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DatePicker } from "@/components/date-picker";
import { controlProps, Field, FormError, useZodForm } from "@/components/form";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { ReviewRound } from "@/lib/api";
import { roundForm } from "@/lib/form-schemas";
import { useT } from "@/lib/i18n/provider";
import {
  errorMessage,
  useCreateRoundMutation,
  useDeleteRoundMutation,
  useProjectQuery,
  useRoundsQuery,
  useUpdateRoundMutation,
} from "@/lib/store/api";
import { cn } from "@/lib/utils";
import { useViewer } from "@/lib/viewer";

/** Due dates are days: stored as the end of that day in the reviewer's time zone. */
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).toISOString();

/**
 * Review rounds (F-055, wave-4 §2): group the feedback of one review, follow its progress, close it and
 * export it as CSV or PDF for the client.
 */
export function RoundsView({ projectId }: { projectId: string }) {
  const t = useT();
  const project = useProjectQuery(projectId);
  const rounds = useRoundsQuery(projectId);
  const { canWrite } = useViewer();
  const [editing, setEditing] = useState<ReviewRound | "new" | null>(null);
  const [removing, setRemoving] = useState<ReviewRound | null>(null);
  const [deleteRound, removal] = useDeleteRoundMutation();
  const name = project.data?.project.name ?? t("projects1.projectFallback");
  const list = rounds.data?.rounds ?? [];

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-1.5">
            <Link href={`/projects/${projectId}`} className="text-muted-foreground hover:text-foreground">
              {name}
            </Link>
            <span className="text-muted-foreground">/</span>
            {t("projects1.rounds")}
          </span>
        }
      >
        <ButtonLink
          href={`/projects/${projectId}`}
          size="sm"
          variant="ghost"
          className="hidden sm:inline-flex"
        >
          <Settings /> {t("projects1.settings")}
        </ButtonLink>
        {canWrite && (
          <Button size="sm" onClick={() => setEditing("new")} data-testid="new-round">
            <Plus /> {t("projects1.newRound")}
          </Button>
        )}
      </PageHeader>
      <div className="mx-auto w-full max-w-5xl p-4 pb-16">
        {rounds.isLoading && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
        )}
        {rounds.isError && <ErrorState error={rounds.error} retry={() => void rounds.refetch()} />}
        {rounds.isSuccess && list.length === 0 && (
          <Card>
            <CardContent>
              <EmptyState
                icon={Target}
                title={t("projects1.noReviewRoundsYet")}
                description={t("projects1.noReviewRoundsDescription")}
                action={
                  canWrite && (
                    <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
                      <Plus /> {t("projects1.newRound")}
                    </Button>
                  )
                }
              />
            </CardContent>
          </Card>
        )}
        {list.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2" aria-label={t("projects1.reviewRounds")}>
            {list.map((r) => (
              <RoundCard
                key={r.id}
                round={r}
                projectId={projectId}
                canWrite={canWrite}
                onEdit={() => setEditing(r)}
                onDelete={() => setRemoving(r)}
              />
            ))}
          </ul>
        )}
      </div>
      <RoundDialog
        projectId={projectId}
        round={editing === "new" ? null : editing}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t("projects1.deleteRoundTitle", { name: removing?.name ?? "" })}
        description={t("projects1.deleteRoundDescription")}
        pending={removal.isLoading}
        onConfirm={() => {
          if (!removing) return;
          deleteRound({ id: removing.id, projectId })
            .unwrap()
            .then(() => {
              toast.success(t("projects1.roundDeleted", { name: removing.name }));
              setRemoving(null);
            })
            .catch((e: unknown) => toast.error(errorMessage(e)));
        }}
      />
    </>
  );
}

function RoundCard({
  round: r,
  projectId,
  canWrite,
  onEdit,
  onDelete,
}: {
  round: ReviewRound;
  projectId: string;
  canWrite: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const [updateRound, update] = useUpdateRoundMutation();
  const { total, open, closed } = r.counts;
  const pct = total ? Math.round((closed / total) * 100) : 0;
  const overdue = r.status === "active" && !!r.dueAt && new Date(r.dueAt) < new Date();
  const setStatus = (status: "active" | "closed") => {
    updateRound({ id: r.id, projectId, patch: { status } })
      .unwrap()
      .then(() =>
        toast.success(
          status === "closed"
            ? t("projects1.roundClosed", { name: r.name })
            : t("projects1.roundReopened", { name: r.name }),
        ),
      )
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };
  const exportUrl = (format: "csv" | "pdf") => `/api/rounds/${r.id}/export?format=${format}`;

  return (
    <li data-round={r.name}>
      <Card className="h-full gap-3">
        <CardHeader>
          <CardTitle className="flex items-start gap-2">
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            {r.status === "active" ? (
              <Badge variant="secondary" className="gap-1 font-normal">
                <span className="size-1.5 rounded-full bg-emerald-500" /> {t("projects1.active")}
              </Badge>
            ) : (
              <Badge variant="outline" className="font-normal text-muted-foreground">
                {t("projects1.closed")}
              </Badge>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("projects1.actionsFor", { name: r.name })}
                    className="-my-1"
                  />
                }
              >
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  render={<a href={exportUrl("csv")} download aria-label={t("projects1.exportCsv")} />}
                >
                  <Download /> {t("projects1.exportCsv")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  render={<a href={exportUrl("pdf")} download aria-label={t("projects1.exportPdf")} />}
                >
                  <FileText /> {t("projects1.exportPdf")}
                </DropdownMenuItem>
                {canWrite && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onEdit}>
                      <Pencil /> {t("projects1.edit")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setStatus(r.status === "active" ? "closed" : "active")}>
                      {r.status === "active" ? <CircleCheck /> : <RotateCcw />}
                      {r.status === "active" ? t("projects1.closeRound") : t("projects1.reopen")}
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onClick={onDelete}>
                      <Trash2 /> {t("projects1.delete")}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </CardTitle>
          <p
            className={cn(
              "flex items-center gap-1.5 text-xs text-muted-foreground",
              overdue && "text-destructive",
            )}
          >
            <CalendarClock className="size-3.5" />
            {r.dueAt ? (
              <span>
                {overdue ? t("projects1.overdueWasDue") : t("projects1.due")} <LocalDate iso={r.dueAt} />
              </span>
            ) : (
              t("projects1.noDueDate")
            )}
            {r.closedAt && (
              <span className="text-muted-foreground">
                · {t("projects1.closedLower")} <LocalDate iso={r.closedAt} />
              </span>
            )}
          </p>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-1.5">
            <div
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label={t("projects1.roundProgress", { name: r.name })}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width]"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p
              className="flex justify-between text-xs text-muted-foreground tabular-nums"
              data-testid="round-counts"
            >
              <span>
                <span className="font-medium text-foreground">{closed}</span>{" "}
                {t("projects1.ofTotalDone", { total })}
              </span>
              <span>{t("projects1.openCount", { n: open })}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/inbox?project=${projectId}&round=${r.id}&status=all`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Inbox /> {t("projects1.viewItems")}
            </Link>
            {canWrite && r.status === "active" && (
              <Button
                size="sm"
                variant="ghost"
                disabled={update.isLoading}
                onClick={() => setStatus("closed")}
              >
                <CircleCheck /> {t("projects1.close")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </li>
  );
}

function RoundDialog({
  projectId,
  round,
  open,
  onOpenChange,
}: {
  projectId: string;
  round: ReviewRound | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && <RoundForm projectId={projectId} round={round} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function RoundForm({
  projectId,
  round,
  onDone,
}: {
  projectId: string;
  round: ReviewRound | null;
  onDone: () => void;
}) {
  const t = useT();
  const [create] = useCreateRoundMutation();
  const [update] = useUpdateRoundMutation();
  const form = useZodForm(roundForm, {
    defaultValues: { name: round?.name ?? "", dueAt: round?.dueAt ? new Date(round.dueAt) : null },
  });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async ({ name, dueAt }) => {
    const due = dueAt ? endOfDay(dueAt) : null;
    try {
      if (round) await update({ id: round.id, projectId, patch: { name, dueAt: due } }).unwrap();
      else await create({ projectId, body: { name, dueAt: due } }).unwrap();
      toast.success(round ? t("projects1.roundSaved", { name }) : t("projects1.roundStarted", { name }));
      onDone();
    } catch (e) {
      form.setError("root", { message: errorMessage(e) });
    }
  });
  return (
    <form noValidate className="grid gap-4" onSubmit={(e) => void submit(e)}>
      <DialogHeader>
        <DialogTitle>{round ? t("projects1.editRound") : t("projects1.newReviewRound")}</DialogTitle>
        <DialogDescription>
          {round ? t("projects1.editRoundDescription") : t("projects1.newRoundDescription")}
        </DialogDescription>
      </DialogHeader>
      <Field id="round-name" label={t("projects1.name")} error={errors.name?.message}>
        <Input
          {...controlProps("round-name", errors.name?.message)}
          {...form.register("name")}
          maxLength={120}
          placeholder={t("projects1.roundNamePlaceholder")}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog's first field; focus moves into a dialog on open
          autoFocus
        />
      </Field>
      <Field id="round-due" label={t("projects1.dueDateOptional")} error={errors.dueAt?.message}>
        <Controller
          control={form.control}
          name="dueAt"
          render={({ field }) => (
            <DatePicker
              {...controlProps("round-due", errors.dueAt?.message)}
              value={field.value}
              onChange={field.onChange}
              placeholder={t("projects1.noDueDate")}
            />
          )}
        />
      </Field>
      <FormError message={errors.root?.message} />
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("projects1.cancel")}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t("projects1.saving") : round ? t("projects1.save") : t("projects1.startRound")}
        </Button>
      </DialogFooter>
    </form>
  );
}
