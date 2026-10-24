"use client";

import { type FeedbackKind, type FeedbackStatus, type Priority, safeHref } from "@pinwren/core";
import {
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  CircleDot,
  Eye,
  Mail,
  RotateCcw,
  Tag,
  TriangleAlert,
  ExternalLink,
  Flag,
  Lock,
  MapPin,
  MoreHorizontal,
  Pencil,
  PencilLine,
  Trash2,
  UserRound,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { commentCreate, commentUpdate } from "@pinwren/core";
import { Controller, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { useZodForm } from "@/components/form";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  KIND_META,
  LocalDate,
  PRIORITY_META,
  PriorityIcon,
  STATUS_META,
  StatusIcon,
  timeAgo,
} from "@/components/feedback-meta";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/user-avatar";
import type { ActivityEvent, Comment, FeedbackDetail } from "@/lib/api";
import {
  errorMessage,
  useAddCommentMutation,
  useDeleteCommentMutation,
  useEditCommentMutation,
} from "@/lib/store/api";
import { insertMention, matchMembers, mentionParts, mentionQuery, mentionsIn } from "@/lib/mentions";
import { useMembers, useViewer } from "@/lib/viewer";
import { cn } from "@/lib/utils";
import { issueRef, trackerName } from "@/components/tracker-icon";

type Entry =
  | { kind: "comment"; at: string; comment: Comment }
  | { kind: "event"; at: string; event: ActivityEvent }
  | { kind: "created"; at: string; who: string; via: string | null };

const absolute = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function Time({ iso }: { iso: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<time dateTime={iso} className="shrink-0 text-muted-foreground" suppressHydrationWarning />}
      >
        {timeAgo(iso)}
      </TooltipTrigger>
      <TooltipContent>{absolute(iso)}</TooltipContent>
    </Tooltip>
  );
}

const isStatus = (v: unknown): v is FeedbackStatus => typeof v === "string" && v in STATUS_META;
const isKind = (v: unknown): v is FeedbackKind => typeof v === "string" && v in KIND_META;

/** `added` / `removed` of a labels change (the API resolves names; a deleted label has none). */
function labelNames(v: unknown): string {
  if (!Array.isArray(v) || !v.length) return "";
  return v
    .map((l: unknown) =>
      l && typeof l === "object" && "name" in l && typeof l.name === "string"
        ? `“${l.name}”`
        : "a deleted label",
    )
    .join(", ");
}
const isPriority = (v: unknown): v is Priority => typeof v === "string" && v in PRIORITY_META;

function actorOf(e: ActivityEvent): string {
  if (e.actorName) return e.actorName;
  if (e.actorKind === "guest") return e.data.via === "reporter" ? "The reporter" : "A visitor";
  if (e.actorKind === "integration") return trackerName(e.data.via) ?? "An integration";
  return "Someone";
}

/** Event data is JSON from the API: show strings and numbers, anything else as `fallback`. */
function str(v: unknown, fallback = ""): string {
  return typeof v === "string" || typeof v === "number" ? String(v) : fallback;
}

function names(v: unknown): string {
  if (!Array.isArray(v) || !v.length) return "";
  return v
    .map((u: unknown) => (u && typeof u === "object" && "name" in u ? str(u.name, "a former member") : "?"))
    .join(", ");
}

/** One line per activity row: who did what, with the before → after values. */
function EventLine({ event: e }: { event: ActivityEvent }) {
  const who = <span className="font-medium text-foreground">{actorOf(e)}</span>;
  const { from, to } = e.data;
  let icon = <CircleDot className="size-3.5" />;
  let body: React.ReactNode;
  if (e.type === "status_changed" && isStatus(to)) {
    icon = <StatusIcon status={to} className="size-3.5" />;
    body = (
      <>
        {who} changed status{" "}
        {isStatus(from) && <span className="text-foreground">{STATUS_META[from].label}</span>}
        {isStatus(from) && (
          <>
            <ArrowRight aria-hidden className="mx-1 inline size-3" />
            <span className="sr-only"> to </span>
          </>
        )}
        <span className="text-foreground">{STATUS_META[to].label}</span>
        {e.data.via === "api" && " via API"}
        {typeof e.data.issue === "number" && ` (issue #${e.data.issue})`}
      </>
    );
  } else if (e.type === "priority_changed" && isPriority(to)) {
    icon = <PriorityIcon priority={to} className="size-3.5" />;
    body = (
      <>
        {who} set priority to <span className="text-foreground">{PRIORITY_META[to].label}</span>
        {isPriority(from) && from !== "none" && <> (was {PRIORITY_META[from].label})</>}
      </>
    );
  } else if (e.type === "assigneeIds_changed") {
    icon = <UserRound className="size-3.5" />;
    const added = names(e.data.toUsers);
    body = added ? (
      <>
        {who} assigned <span className="text-foreground">{added}</span>
      </>
    ) : (
      <>
        {who} removed the assignee{names(e.data.fromUsers) && ` (${names(e.data.fromUsers)})`}
      </>
    );
  } else if (e.type === "title_changed") {
    icon = <PencilLine className="size-3.5" />;
    body = (
      <>
        {who} renamed this to <span className="text-foreground">“{str(to)}”</span>
      </>
    );
  } else if (e.type === "action_run") {
    icon = <Zap className="size-3.5" />;
    body = (
      <>
        {who} ran{" "}
        <span className="text-foreground">“{str(e.data.label ?? e.data.actionId, "an action")}”</span>
        {e.data.ok === true ? (
          typeof e.data.message === "string" && e.data.message ? (
            <> — {e.data.message}</>
          ) : null
        ) : (
          <span className="text-destructive"> — failed ({str(e.data.error ?? e.data.status, "error")})</span>
        )}
      </>
    );
  } else if (e.type === "issue_linked") {
    icon = <ExternalLink className="size-3.5" />;
    const url = safeHref(e.data.url);
    const label = `${trackerName(e.data.provider) ?? "Tracker"} issue ${issueRef({
      provider: str(e.data.provider),
      number: Number(e.data.number),
      url: str(e.data.url),
      key: e.data.key,
    })}`;
    body = (
      <>
        Linked{" "}
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline-offset-4 hover:underline"
          >
            {label}
          </a>
        ) : (
          <span className="text-foreground">{label}</span>
        )}
      </>
    );
  } else if (e.type === "comment_deleted") {
    icon = <Trash2 className="size-3.5" />;
    body = (
      <>
        {who} deleted {e.data.visibility === "internal" ? "an internal note" : "a reply"}
      </>
    );
  } else if (e.type === "kind_changed" && isKind(to)) {
    const Icon = KIND_META[to].icon;
    icon = <Icon className="size-3.5" />;
    body = (
      <>
        {who} changed the type to <span className="text-foreground">{KIND_META[to].label}</span>
        {isKind(from) && <> (was {KIND_META[from].label})</>}
      </>
    );
  } else if (e.type === "anchor_changed") {
    icon = <MapPin className="size-3.5" />;
    body = (
      <>
        {who} re-pinned this{e.data.via === "widget" ? " on the page" : ""}
      </>
    );
  } else if (e.type === "dueAt_changed") {
    icon = <CalendarClock className="size-3.5" />;
    body =
      typeof to === "string" ? (
        <>
          {who} set the due date to{" "}
          <span className="text-foreground">
            <LocalDate iso={to} />
          </span>
        </>
      ) : (
        <>{who} removed the due date</>
      );
  } else if (e.type === "labelIds_changed") {
    icon = <Tag className="size-3.5" />;
    const added = labelNames(e.data.added);
    const removed = labelNames(e.data.removed);
    body = (
      <>
        {who} {added && <>added {added}</>}
        {added && removed && " and "}
        {removed && <>removed {removed}</>}
        {!added && !removed && "changed the labels"}
      </>
    );
  } else if (e.type === "duplicateOfId_changed") {
    icon = <StatusIcon status="duplicate" className="size-3.5" />;
    body =
      typeof to === "string" ? (
        <>
          {who} marked this as a duplicate of{" "}
          <span className="text-foreground">
            {typeof e.data.toNumber === "number" ? `#${e.data.toNumber}` : "another item"}
          </span>
        </>
      ) : (
        <>{who} marked this as not a duplicate</>
      );
  } else if (e.type === "deleted") {
    icon = <Trash2 className="size-3.5" />;
    body = <>{who} moved this to the trash</>;
  } else if (e.type === "restored") {
    icon = <RotateCcw className="size-3.5" />;
    body = <>{who} restored this from the trash</>;
  } else {
    icon = <Flag className="size-3.5" />;
    body = (
      <>
        {who} {e.type.replace(/_/g, " ")}
      </>
    );
  }
  return (
    <li className="relative flex items-start gap-2.5 py-1.5 pl-0.5 text-xs text-muted-foreground">
      <span className="z-[1] grid size-5 shrink-0 place-items-center rounded-full bg-background text-muted-foreground ring-1 ring-border">
        {icon}
      </span>
      <span className="min-w-0 flex-1 pt-0.5 leading-relaxed">{body}</span>
      <span className="pt-0.5">
        <Time iso={e.createdAt} />
      </span>
    </li>
  );
}

function CommentCard({ comment: c, feedbackId }: { comment: Comment; feedbackId: string }) {
  const { userId, isAdmin, canWrite } = useViewer();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const own = canWrite && !!c.author && c.author.id === userId;
  const canDelete = canWrite && (own || isAdmin);
  const name =
    c.author?.name ?? c.authorGuest?.name ?? (c.authorGuest?.email ? c.authorGuest.email : "Visitor");

  const [deleteComment, remove] = useDeleteCommentMutation();

  return (
    <li
      className={cn(
        "relative rounded-lg border bg-card p-3",
        c.visibility === "internal" && "border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/[0.06]",
      )}
      data-comment={c.id}
      data-feedback={feedbackId}
    >
      <div className="mb-1.5 flex items-center gap-2 text-xs">
        <UserAvatar name={name} image={c.author?.image} className="size-5" />
        <span className="min-w-0 truncate font-medium">{name}</span>
        {!c.author && <span className="text-muted-foreground">· visitor</span>}
        {!c.author && c.authorGuest?.verified && (
          <BadgeCheck className="size-3.5 text-emerald-600" aria-label="Verified reporter" />
        )}
        {c.visibility === "internal" ? (
          <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
            <Lock className="size-3" /> Internal
          </span>
        ) : (
          c.author && <span className="text-muted-foreground">· public reply</span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <Time iso={c.createdAt} />
          {c.editedAt && (
            <Tooltip>
              <TooltipTrigger render={<span className="text-muted-foreground" />}>· edited</TooltipTrigger>
              <TooltipContent>{absolute(c.editedAt)}</TooltipContent>
            </Tooltip>
          )}
          {(own || canDelete) && !editing && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="-my-1 -mr-1"
                    aria-label="Comment actions"
                  />
                }
              >
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36">
                {own && (
                  <DropdownMenuItem onClick={() => setEditing(true)}>
                    <Pencil /> Edit
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <DropdownMenuItem variant="destructive" onClick={() => setConfirming(true)}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </span>
      </div>
      {editing ? (
        <EditComment comment={c} feedbackId={feedbackId} onDone={() => setEditing(false)} />
      ) : (
        <p className="text-sm break-words whitespace-pre-wrap">
          <CommentBody body={c.body} mentions={c.mentions} />
        </p>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete this comment?"
        description="It's removed for everyone, including the reporter if it was a public reply. The timeline keeps a note that it was deleted."
        pending={remove.isLoading}
        onConfirm={() => {
          deleteComment({ id: c.id, feedbackId })
            .unwrap()
            .then(() => {
              setConfirming(false);
              toast.success("Comment deleted");
            })
            .catch((e: unknown) => toast.error(errorMessage(e)));
        }}
      />
    </li>
  );
}

/** Edit your own comment (core's commentUpdate: 1–10 000 characters). */
/** Comment text with the @mentioned teammates highlighted (only real mentions, not any `@word`). */
function CommentBody({ body, mentions }: { body: string; mentions: string[] | undefined }) {
  const members = useMembers();
  if (!mentions?.length) return body;
  const names = members.filter((m) => mentions.includes(m.id)).map((m) => m.name);
  return mentionParts(body, names).map((p, i) =>
    p.mention ? (
      <span key={i} className="rounded bg-primary/10 px-0.5 font-medium text-primary">
        {p.text}
      </span>
    ) : (
      p.text
    ),
  );
}

function EditComment({
  comment: c,
  feedbackId,
  onDone,
}: {
  comment: Comment;
  feedbackId: string;
  onDone: () => void;
}) {
  const [saveComment] = useEditCommentMutation();
  const form = useZodForm(commentUpdate, { defaultValues: { body: c.body } });
  const { isSubmitting, isDirty } = form.formState;
  const body = useWatch({ control: form.control, name: "body" });
  const submit = form.handleSubmit(async (v) => {
    try {
      await saveComment({ id: c.id, feedbackId, body: v.body }).unwrap();
      toast.success("Comment updated");
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });
  return (
    <form className="space-y-2" noValidate onSubmit={(e) => void submit(e)}>
      <Textarea
        {...form.register("body")}
        // Also as the initial DOM content, so the text is there before react-hook-form fills the field.
        defaultValue={c.body}
        rows={3}
        maxLength={10_000}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- opened by the Edit action, which hands focus to the field
        autoFocus
        aria-label="Edit comment"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          if (e.key === "Escape") {
            e.stopPropagation();
            onDone();
          }
        }}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!body.trim() || !isDirty || isSubmitting}>
          {isSubmitting ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

/** Comments and activity in one chronological thread (blueprint 06 §3.2 "Timeline"). */
export function Timeline({ data }: { data: FeedbackDetail }) {
  const f = data.feedback;
  const reporter = f.reporterGuest?.name ?? f.reporterGuest?.email ?? "A visitor";
  // The API writes its own "created" row; it becomes the "reported this" line (named after the reporter).
  const created = data.activity.find((e) => e.type === "created");
  const entries: Entry[] = [
    {
      kind: "created" as const,
      at: created?.createdAt ?? f.createdAt,
      who: created?.actorName ?? reporter,
      // Sent through a review link (F-012): the link's name as it is now, else as it was when sent.
      via:
        f.reviewLink?.label ??
        (typeof created?.data.reviewLink === "string" ? created.data.reviewLink : null),
    },
    ...data.comments.map((c) => ({ kind: "comment" as const, at: c.createdAt, comment: c })),
    ...data.activity
      .filter((e) => e.type !== "created")
      .map((e) => ({ kind: "event" as const, at: e.createdAt, event: e })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <ol className="relative space-y-2 before:absolute before:top-3 before:bottom-3 before:left-[12px] before:w-px before:bg-border">
      {entries.map((entry) => {
        if (entry.kind === "created") {
          return (
            <li
              key="created"
              className="relative flex items-start gap-2.5 py-1.5 pl-0.5 text-xs text-muted-foreground"
            >
              <span className="z-[1] grid size-5 shrink-0 place-items-center rounded-full bg-background ring-1 ring-border">
                <CircleDot className="size-3.5 text-blue-500" />
              </span>
              <span className="min-w-0 flex-1 pt-0.5">
                <span className="font-medium text-foreground">{entry.who}</span> reported this
                {entry.via && (
                  <>
                    {" "}
                    via review link <span className="font-medium text-foreground">{entry.via}</span>
                  </>
                )}
              </span>
              <span className="pt-0.5">
                <Time iso={entry.at} />
              </span>
            </li>
          );
        }
        if (entry.kind === "event") return <EventLine key={entry.event.id} event={entry.event} />;
        return <CommentCard key={entry.comment.id} comment={entry.comment} feedbackId={f.id} />;
      })}
    </ol>
  );
}

/** Reply publicly or leave an internal note (default) — blueprint 06 §3.2. */
export function CommentComposer({
  feedbackId,
  projectId,
  reach,
}: {
  feedbackId: string;
  projectId: string;
  reach: FeedbackDetail["replyReach"];
}) {
  const [addComment] = useAddCommentMutation();
  const { userId } = useViewer();
  const members = useMembers().filter((m) => m.id !== userId);
  const form = useZodForm(commentCreate, { defaultValues: { body: "", visibility: "internal" } });
  const { isSubmitting } = form.formState;
  const body = useWatch({ control: form.control, name: "body" });
  const visibility = useWatch({ control: form.control, name: "visibility" });
  const field = useRef<HTMLTextAreaElement | null>(null);
  const [picked, setPicked] = useState<ReadonlyMap<string, string>>(new Map());
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const matches = query === null ? [] : matchMembers(members, query);
  const listId = `mentions-${feedbackId}`;
  const { ref: registerRef, onChange: registerChange, ...bodyField } = form.register("body");

  const submit = form.handleSubmit(async (v) => {
    try {
      const mentions = mentionsIn(v.body, picked);
      await addComment({
        feedbackId,
        body: v.body,
        visibility: v.visibility,
        ...(mentions.length ? { mentions } : {}),
      }).unwrap();
      setPicked(new Map());
      form.reset({ body: "", visibility: v.visibility });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });

  const track = (el: HTMLTextAreaElement) => {
    setQuery(mentionQuery(el.value.slice(0, el.selectionStart)));
    setActive(0);
  };
  const pick = (m: { id: string; name: string }) => {
    const el = field.current;
    if (!el) return;
    const next = insertMention(el.value, el.selectionStart, m.name);
    setPicked((p) => new Map(p).set(m.id, m.name));
    form.setValue("body", next.text, { shouldDirty: true });
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  };

  return (
    <form
      className={cn(
        "relative space-y-2 rounded-lg border p-2 transition-colors focus-within:border-ring",
        visibility === "internal" && "bg-amber-50/40 dark:bg-amber-500/[0.04]",
      )}
      onSubmit={(e) => void submit(e)}
    >
      <Textarea
        {...bodyField}
        ref={(el) => {
          registerRef(el);
          field.current = el;
        }}
        onChange={(e) => {
          void registerChange(e);
          track(e.currentTarget);
        }}
        onClick={(e) => track(e.currentTarget)}
        onBlur={(e) => {
          void bodyField.onBlur(e);
          // Let a click on a suggestion land before the list closes.
          setTimeout(() => setQuery(null), 150);
        }}
        placeholder={
          visibility === "internal"
            ? "Leave an internal note… (@ to mention)"
            : "Reply to the reporter… (@ to mention a teammate)"
        }
        aria-label="Comment"
        role="combobox"
        aria-expanded={matches.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={matches[active] ? `${listId}-${matches[active].id}` : undefined}
        rows={3}
        maxLength={10_000}
        className="min-h-16 resize-none border-0 bg-transparent p-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
        onKeyDown={(e) => {
          if (matches.length) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : -1;
              setActive((a) => (a + step + matches.length) % matches.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              const m = matches[active];
              if (m) {
                e.preventDefault();
                pick(m);
                return;
              }
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setQuery(null);
              return;
            }
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          if (e.key === "Escape") e.currentTarget.blur();
        }}
      />
      {matches.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Mention a teammate"
          className="absolute inset-x-2 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {matches.map((m, i) => (
            <li
              key={m.id}
              id={`${listId}-${m.id}`}
              role="option"
              aria-selected={i === active}
              className={cn(
                "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                i === active && "bg-muted",
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(m);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <UserAvatar name={m.name} image={m.image} className="size-5" />
              <span className="truncate">{m.name}</span>
              <span className="ml-auto truncate text-xs text-muted-foreground">{m.email}</span>
            </li>
          ))}
        </ul>
      )}
      {visibility === "public" && <ReplyReach reach={reach} projectId={projectId} />}
      <div className="flex flex-wrap items-center gap-2">
        <Controller
          control={form.control}
          name="visibility"
          render={({ field }) => (
            <Tabs value={field.value} onValueChange={(v) => field.onChange(v)}>
              <TabsList className="h-7">
                <TabsTrigger value="internal" className="px-2.5 text-xs">
                  <Lock /> Internal
                </TabsTrigger>
                <TabsTrigger value="public" className="px-2.5 text-xs">
                  Public reply
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        />
        <span className="ml-auto hidden text-[11px] text-muted-foreground sm:inline">Ctrl ↵ to send</span>
        <Button type="submit" size="sm" disabled={!body.trim() || isSubmitting}>
          {isSubmitting ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}

/** Where a public reply goes, from the project's settings and the report (wave-5 contract §3.4). */
export function replyReachText(reach: FeedbackDetail["replyReach"]): {
  tone: "ok" | "warn";
  text: string;
} {
  const email = reach.notifyReporter && reach.reporterHasEmail;
  if (reach.publicRead && email) {
    return { tone: "ok", text: "Shown under the pin on the page and emailed to the reporter." };
  }
  if (reach.publicRead) {
    return {
      tone: "ok",
      text: reach.reporterHasEmail
        ? "Shown under the pin on the page. Reporter emails are off for this project."
        : "Shown under the pin on the page. The reporter left no email address.",
    };
  }
  if (email) return { tone: "ok", text: "Emailed to the reporter. Pins are private on this project." };
  return {
    tone: "warn",
    text: reach.reporterHasEmail
      ? "Not delivered: pins are private and reporter emails are off for this project."
      : "Not delivered: pins are private and the reporter left no email address.",
  };
}

function ReplyReach({ reach, projectId }: { reach: FeedbackDetail["replyReach"]; projectId: string }) {
  const { isAdmin } = useViewer();
  const { tone, text } = replyReachText(reach);
  const Icon = tone === "warn" ? TriangleAlert : reach.publicRead ? Eye : Mail;
  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-1.5 px-1 text-xs",
        tone === "warn" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
      )}
      data-testid="reply-reach"
    >
      <Icon className="size-3.5 shrink-0" />
      {text}
      {tone === "warn" && isAdmin && (
        <Link
          href={`/projects/${projectId}?tab=privacy`}
          className="font-medium underline underline-offset-2"
        >
          Change in project settings
        </Link>
      )}
    </p>
  );
}
