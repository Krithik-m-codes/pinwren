"use client";

import { FEEDBACK_STATUSES, type FeedbackStatus, PRIORITIES, type Priority } from "@annota/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Lock, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { initials } from "@/components/app-shell";
import {
  KIND_META,
  PRIORITY_META,
  PriorityIcon,
  STATUS_META,
  StatusIcon,
  timeAgo,
} from "@/components/feedback-meta";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, type FeedbackDetail, type Member } from "@/lib/api";
import { cn } from "@/lib/utils";

const statusItems = FEEDBACK_STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label }));
const priorityItems = PRIORITIES.map((p) => ({ value: p, label: PRIORITY_META[p].label }));

export function FeedbackDetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ["feedback", id],
    queryFn: () => api<FeedbackDetail>(`/feedback/${id}`),
  });
  const members = useQuery({ queryKey: ["members"], queryFn: () => api<{ members: Member[] }>("/members") });

  const update = useMutation({
    mutationFn: (patch: Partial<{ status: FeedbackStatus; priority: Priority; assigneeIds: string[] }>) =>
      api(`/feedback/${id}`, { method: "PATCH", json: patch }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["feedback"] });
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => api(`/feedback/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Feedback deleted");
      void qc.invalidateQueries({ queryKey: ["feedback"] });
      onClose();
    },
  });

  if (detail.isPending) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }
  if (detail.isError) return <p className="p-6 text-sm text-destructive">{detail.error.message}</p>;

  const { feedback: f, assets, comments, diagnostics } = detail.data;
  const screenshot =
    assets.find((a) => a.kind === "screenshot_annotated") ?? assets.find((a) => a.kind === "screenshot");
  const Kind = KIND_META[f.kind].icon;
  const assignee = f.assigneeIds[0] ?? "unassigned";
  const memberItems = [
    { value: "unassigned", label: "Unassigned" },
    ...(members.data?.members.map((m) => ({ value: m.id, label: m.name })) ?? []),
  ];
  const openOnPage = f.pageUrl ? withParam(f.pageUrl, "annota", f.id) : null;
  const consoleEntries = diagnostics?.console ?? [];
  const networkEntries = diagnostics?.network ?? [];

  return (
    <article className="flex flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/90 px-5 py-2.5 backdrop-blur">
        <span className="font-mono text-xs text-muted-foreground">#{f.number}</span>
        <Badge variant="secondary" className="gap-1">
          <Kind className="size-3" />
          {KIND_META[f.kind].label}
        </Badge>
        <span className="truncate text-xs text-muted-foreground">{f.projectName}</span>
        <div className="ml-auto flex items-center gap-1">
          {openOnPage && (
            <Button
              variant="ghost"
              size="sm"
              render={<a href={openOnPage} target="_blank" rel="noopener noreferrer" />}
            >
              <ExternalLink /> Open on page
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Delete"
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
          >
            <Trash2 />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
            <X />
          </Button>
        </div>
      </header>

      <div className="space-y-6 px-5 py-5">
        <div>
          <h2 className="text-lg leading-snug font-semibold text-balance">{f.title || firstLine(f.body)}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {f.reporterGuest?.name ?? f.reporterGuest?.email ?? "Anonymous visitor"} · {timeAgo(f.createdAt)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Select
            items={statusItems}
            value={f.status}
            onValueChange={(v) => v && update.mutate({ status: v as FeedbackStatus })}
          >
            <SelectTrigger size="sm" aria-label="Status">
              <StatusIcon status={f.status} />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusItems.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  <StatusIcon status={s.value} />
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            items={priorityItems}
            value={f.priority}
            onValueChange={(v) => v && update.mutate({ priority: v as Priority })}
          >
            <SelectTrigger size="sm" aria-label="Priority">
              <PriorityIcon priority={f.priority} />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {priorityItems.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  <PriorityIcon priority={p.value} />
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            items={memberItems}
            value={assignee}
            onValueChange={(v) => v && update.mutate({ assigneeIds: v === "unassigned" ? [] : [String(v)] })}
          >
            <SelectTrigger size="sm" aria-label="Assignee">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {memberItems.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <p className="text-sm leading-relaxed whitespace-pre-wrap">{f.body}</p>

        {screenshot && (
          <a
            href={`/api/assets/${screenshot.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block overflow-hidden rounded-lg border bg-muted/40"
          >
            {/* biome-ignore lint/performance/noImgElement: authenticated asset route, not optimisable */}
            <img
              src={`/api/assets/${screenshot.id}`}
              alt="Screenshot attached to this report"
              className="w-full"
            />
          </a>
        )}

        <Tabs defaultValue="details">
          <TabsList variant="line" className="w-full justify-start border-b">
            <TabsTrigger value="details" className="flex-none">
              Details
            </TabsTrigger>
            <TabsTrigger value="console" className="flex-none">
              Console {consoleEntries.length > 0 && `(${consoleEntries.length})`}
            </TabsTrigger>
            <TabsTrigger value="network" className="flex-none">
              Network {networkEntries.length > 0 && `(${networkEntries.length})`}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="details">
            <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
              <Meta label="Page">
                {f.pageUrl ? (
                  <a
                    href={f.pageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all underline-offset-4 hover:underline"
                  >
                    {f.pageUrl}
                  </a>
                ) : (
                  "—"
                )}
              </Meta>
              <Meta label="Browser">
                {[f.environment?.browser, f.environment?.os].filter(Boolean).join(" · ") || "—"}
              </Meta>
              <Meta label="Viewport">
                {f.environment?.viewport
                  ? `${f.environment.viewport.w} × ${f.environment.viewport.h} @${f.environment.dpr ?? 1}x`
                  : "—"}
              </Meta>
              <Meta label="Locale">
                {[f.environment?.locale, f.environment?.timezone].filter(Boolean).join(" · ") || "—"}
              </Meta>
              {f.anchor?.css && (
                <Meta label="Element">
                  <code className="font-mono text-xs break-all">{f.anchor.css}</code>
                </Meta>
              )}
              {f.reporterGuest?.email && <Meta label="Reporter">{f.reporterGuest.email}</Meta>}
              {f.metadata &&
                Object.entries(f.metadata).map(([k, v]) => (
                  <Meta key={k} label={k}>
                    <code className="font-mono text-xs break-all">{JSON.stringify(v)}</code>
                  </Meta>
                ))}
            </dl>
          </TabsContent>
          <TabsContent value="console">
            {consoleEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No console output was captured.</p>
            ) : (
              <ul className="divide-y rounded-lg border font-mono text-xs">
                {consoleEntries.map((e, i) => (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: log lines have no id
                    key={i}
                    className={cn(
                      "px-3 py-1.5 whitespace-pre-wrap break-all",
                      e.level === "error" && "bg-destructive/5 text-destructive",
                      e.level === "warn" && "bg-amber-500/5 text-amber-600 dark:text-amber-400",
                    )}
                  >
                    {e.message}
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
          <TabsContent value="network">
            {networkEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No failed requests were captured.</p>
            ) : (
              <ul className="divide-y rounded-lg border font-mono text-xs">
                {networkEntries.map((n, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: request entries have no id
                  <li key={i} className="flex gap-3 px-3 py-1.5">
                    <span
                      className={cn(
                        "w-10 shrink-0",
                        n.status >= 400 || n.status === 0 ? "text-destructive" : "",
                      )}
                    >
                      {n.status || "ERR"}
                    </span>
                    <span className="w-12 shrink-0 text-muted-foreground">{n.method}</span>
                    <span className="min-w-0 flex-1 break-all">{n.url}</span>
                    <span className="shrink-0 text-muted-foreground">{Math.round(n.durationMs)}ms</span>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>

        <section aria-label="Conversation" className="space-y-4">
          <h3 className="text-sm font-semibold">Conversation</h3>
          {comments.length === 0 && <p className="text-sm text-muted-foreground">No replies yet.</p>}
          <ol className="space-y-3">
            {comments.map((c) => {
              const name = c.author?.name ?? c.authorGuest?.name ?? "Visitor";
              return (
                <li
                  key={c.id}
                  className={cn(
                    "rounded-lg border p-3",
                    c.visibility === "internal" && "border-amber-500/30 bg-amber-500/5",
                  )}
                >
                  <div className="mb-1.5 flex items-center gap-2 text-xs">
                    <Avatar className="size-5">
                      <AvatarFallback className="text-[9px]">{initials(name)}</AvatarFallback>
                    </Avatar>
                    <span className="font-medium">{name}</span>
                    {c.visibility === "internal" && (
                      <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                        <Lock className="size-3" /> Internal
                      </span>
                    )}
                    <span className="ml-auto text-muted-foreground">{timeAgo(c.createdAt)}</span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{c.body}</p>
                </li>
              );
            })}
          </ol>
          <CommentComposer feedbackId={id} />
        </section>
      </div>
    </article>
  );
}

function CommentComposer({ feedbackId }: { feedbackId: string }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"internal" | "public">("internal");
  const send = useMutation({
    mutationFn: () => api(`/feedback/${feedbackId}/comments`, { method: "POST", json: { body, visibility } }),
    onSuccess: () => {
      setBody("");
      void qc.invalidateQueries({ queryKey: ["feedback"] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) send.mutate();
      }}
    >
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={visibility === "internal" ? "Leave an internal note…" : "Reply to the reporter…"}
        rows={3}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim()) send.mutate();
        }}
      />
      <div className="flex items-center gap-2">
        <Tabs value={visibility} onValueChange={(v) => setVisibility(v as "internal" | "public")}>
          <TabsList>
            <TabsTrigger value="internal" className="px-3">
              <Lock /> Internal
            </TabsTrigger>
            <TabsTrigger value="public" className="px-3">
              Public reply
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button type="submit" size="sm" className="ml-auto" disabled={!body.trim() || send.isPending}>
          {send.isPending ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function firstLine(text: string) {
  const line = text.split("\n")[0] ?? "";
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

function withParam(url: string, key: string, value: string) {
  try {
    const u = new URL(url);
    u.searchParams.set(key, value);
    return u.toString();
  } catch {
    return url;
  }
}
