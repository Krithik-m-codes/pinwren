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
  const project = useProjectQuery(projectId);
  const rounds = useRoundsQuery(projectId);
  const { canWrite } = useViewer();
  const [editing, setEditing] = useState<ReviewRound | "new" | null>(null);
  const [removing, setRemoving] = useState<ReviewRound | null>(null);
  const [deleteRound, removal] = useDeleteRoundMutation();
  const name = project.data?.project.name ?? "Project";
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
            Rounds
          </span>
        }
      >
        <ButtonLink
          href={`/projects/${projectId}`}
          size="sm"
          variant="ghost"
          className="hidden sm:inline-flex"
        >
          <Settings /> Settings
        </ButtonLink>
        {canWrite && (
          <Button size="sm" onClick={() => setEditing("new")} data-testid="new-round">
            <Plus /> New round
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
                title="No review rounds yet"
                description="Start a round for each review — “Homepage v2”, “Sprint 14” — and new feedback from the widget joins it. Close it when the review is done and export it for the client."
                action={
                  canWrite && (
                    <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
                      <Plus /> New round
                    </Button>
                  )
                }
              />
            </CardContent>
          </Card>
        )}
        {list.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2" aria-label="Review rounds">
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
        title={`Delete “${removing?.name ?? ""}”?`}
        description="Its feedback stays in the inbox, no longer in a round."
        pending={removal.isLoading}
        onConfirm={() => {
          if (!removing) return;
          deleteRound({ id: removing.id, projectId })
            .unwrap()
            .then(() => {
              toast.success(`Round “${removing.name}” deleted`);
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
  const [updateRound, update] = useUpdateRoundMutation();
  const { total, open, closed } = r.counts;
  const pct = total ? Math.round((closed / total) * 100) : 0;
  const overdue = r.status === "active" && !!r.dueAt && new Date(r.dueAt) < new Date();
  const setStatus = (status: "active" | "closed") => {
    updateRound({ id: r.id, projectId, patch: { status } })
      .unwrap()
      .then(() => toast.success(status === "closed" ? `“${r.name}” closed` : `“${r.name}” reopened`))
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
                <span className="size-1.5 rounded-full bg-emerald-500" /> Active
              </Badge>
            ) : (
              <Badge variant="outline" className="font-normal text-muted-foreground">
                Closed
              </Badge>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Actions for ${r.name}`}
                    className="-my-1"
                  />
                }
              >
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem render={<a href={exportUrl("csv")} download aria-label="Export CSV" />}>
                  <Download /> Export CSV
                </DropdownMenuItem>
                <DropdownMenuItem render={<a href={exportUrl("pdf")} download aria-label="Export PDF" />}>
                  <FileText /> Export PDF
                </DropdownMenuItem>
                {canWrite && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onEdit}>
                      <Pencil /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setStatus(r.status === "active" ? "closed" : "active")}>
                      {r.status === "active" ? <CircleCheck /> : <RotateCcw />}
                      {r.status === "active" ? "Close round" : "Reopen"}
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onClick={onDelete}>
                      <Trash2 /> Delete
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
                {overdue ? "Overdue · was due" : "Due"} <LocalDate iso={r.dueAt} />
              </span>
            ) : (
              "No due date"
            )}
            {r.closedAt && (
              <span className="text-muted-foreground">
                · closed <LocalDate iso={r.closedAt} />
              </span>
            )}
          </p>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-1.5">
            <div
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label={`${r.name} progress`}
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
                <span className="font-medium text-foreground">{closed}</span> of {total} done
              </span>
              <span>{open} open</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/inbox?project=${projectId}&round=${r.id}&status=all`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Inbox /> View items
            </Link>
            {canWrite && r.status === "active" && (
              <Button
                size="sm"
                variant="ghost"
                disabled={update.isLoading}
                onClick={() => setStatus("closed")}
              >
                <CircleCheck /> Close
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
      toast.success(round ? `“${name}” saved` : `Round “${name}” started`);
      onDone();
    } catch (e) {
      form.setError("root", { message: errorMessage(e) });
    }
  });
  return (
    <form noValidate className="grid gap-4" onSubmit={(e) => void submit(e)}>
      <DialogHeader>
        <DialogTitle>{round ? "Edit round" : "New review round"}</DialogTitle>
        <DialogDescription>
          {round
            ? "Rename it or move its due date."
            : "New feedback joins it while it is the project's only active round."}
        </DialogDescription>
      </DialogHeader>
      <Field id="round-name" label="Name" error={errors.name?.message}>
        <Input
          {...controlProps("round-name", errors.name?.message)}
          {...form.register("name")}
          maxLength={120}
          placeholder="Homepage review"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog's first field; focus moves into a dialog on open
          autoFocus
        />
      </Field>
      <Field id="round-due" label="Due date (optional)" error={errors.dueAt?.message}>
        <Controller
          control={form.control}
          name="dueAt"
          render={({ field }) => (
            <DatePicker
              {...controlProps("round-due", errors.dueAt?.message)}
              value={field.value}
              onChange={field.onChange}
              placeholder="No due date"
            />
          )}
        />
      </Field>
      <FormError message={errors.root?.message} />
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : round ? "Save" : "Start round"}
        </Button>
      </DialogFooter>
    </form>
  );
}
