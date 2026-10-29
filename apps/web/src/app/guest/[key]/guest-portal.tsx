"use client";

import { guestReplyCreate, type GuestPortalAccess, type GuestThreadResponse } from "@pinwren/core";
import { skipToken } from "@reduxjs/toolkit/query";
import { ArrowUpRight, Inbox, LockKeyhole, MessageSquare, Search, Send } from "lucide-react";
import { useCallback, useState, useSyncExternalStore } from "react";
import { BrandMark, BrandTheme } from "@/components/brand";
import { RelativeTime, STATUS_META, StatusIcon } from "@/components/feedback-meta";
import { Field, FormError, controlProps, useZodForm } from "@/components/form";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { forgetGuestAccess, guestBrowser, readGuestAccess } from "@/lib/guest-access";
import { useT } from "@/lib/i18n/provider";
import { errorMessage, isApiError } from "@/lib/store/api/base";
import {
  guestApi,
  useGuestPortalQuery,
  useGuestReplyMutation,
  useGuestThreadQuery,
} from "@/lib/store/api/guest";
import { useAppDispatch } from "@/lib/store/hooks";
import { cn } from "@/lib/utils";
import GuestPortalLoading from "./loading";

// The external snapshot keeps SSR credential-free and consumes browser access only after subscribing.
const snapshots = new Map<string, GuestPortalAccess | null>();
const listeners = new Set<() => void>();
const serverSnapshot = () => undefined;
function useGuestAccess(projectKey: string) {
  const subscribe = useCallback(
    (listener: () => void) => {
      listeners.add(listener);
      snapshots.set(projectKey, readGuestAccess(projectKey, guestBrowser()));
      const refresh = () => {
        snapshots.set(projectKey, readGuestAccess(projectKey, guestBrowser()));
        for (const notify of listeners) notify();
      };
      window.addEventListener("storage", refresh);
      window.addEventListener("hashchange", refresh);
      listener();
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", refresh);
        window.removeEventListener("hashchange", refresh);
      };
    },
    [projectKey],
  );
  return useSyncExternalStore(subscribe, () => snapshots.get(projectKey), serverSnapshot);
}

const denied = (error: unknown) => isApiError(error) && (error.status === 401 || error.status === 403);

export function GuestPortal({ projectKey }: { projectKey: string }) {
  const t = useT();
  const dispatch = useAppDispatch();
  const access = useGuestAccess(projectKey);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyDenied, setReplyDenied] = useState(false);
  const queryArgs = access ? { key: projectKey, access } : skipToken;
  const portal = useGuestPortalQuery(queryArgs, { refetchOnFocus: true });
  const thread = useGuestThreadQuery(
    access && selectedId ? { key: projectKey, access, id: selectedId } : skipToken,
    { refetchOnFocus: true },
  );
  const unavailable =
    replyDenied ||
    denied(portal.error) ||
    denied(thread.error) ||
    (isApiError(portal.error) && portal.error.status === 404) ||
    (isApiError(thread.error) && thread.error.status === 404);
  const forget = () => {
    forgetGuestAccess(projectKey, guestBrowser().storage);
    snapshots.set(projectKey, null);
    for (const notify of listeners) notify();
    setSelectedId(null);
    setSearch("");
    dispatch(guestApi.util.resetApiState());
  };

  if (access === undefined || (access && portal.isLoading)) return <GuestPortalLoading />;
  if (!access || unavailable) {
    return (
      <main className="mx-auto flex min-h-svh max-w-lg flex-col justify-center px-6 py-12">
        <div className="mb-8">
          <BrandMark logoUrl={null} />
        </div>
        <LockKeyhole className="mb-4 size-6 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-2xl font-semibold tracking-tight">
          {t(unavailable ? "guest.accessUnavailable" : "guest.title")}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t("guest.accessHelp")}</p>
        {access && (
          <Button variant="outline" className="mt-6 self-start" onClick={forget}>
            {t("guest.forget")}
          </Button>
        )}
      </main>
    );
  }
  if (portal.error || !portal.data) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8">
        <ErrorState
          error={portal.error}
          retry={() => {
            void portal.refetch();
          }}
        />
        <Button variant="ghost" onClick={forget}>
          {t("guest.forget")}
        </Button>
      </main>
    );
  }

  const { project, branding, items } = portal.data;
  const filtered = items.filter((item) =>
    `${item.title ?? ""} ${item.body} ${item.number}`.toLowerCase().includes(search.toLowerCase().trim()),
  );
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <BrandTheme accent={branding.accent} />
      <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
        <div className="flex min-w-0 items-start gap-3">
          <BrandMark logoUrl={branding.logoUrl} className="mt-1" />
          <div className="min-w-0">
            <p className="mb-1 text-xs font-medium text-muted-foreground">{branding.productName}</p>
            <h1 className="text-xl font-semibold tracking-tight break-words sm:text-2xl">{project.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("guest.description")}</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="shrink-0" onClick={forget}>
          {t("guest.forget")}
        </Button>
      </header>
      {items.length === 0 ? (
        <EmptyState icon={Inbox} title={t("guest.emptyTitle")} description={t("guest.emptyHelp")} />
      ) : (
        <div className="grid min-w-0 md:grid-cols-[19rem_minmax(0,1fr)]">
          <section
            aria-label={t("guest.title")}
            className="min-w-0 border-b py-5 md:border-r md:border-b-0 md:pr-5"
          >
            <h2 className="mb-3 text-sm font-semibold">{t("guest.title")}</h2>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                aria-label={t("guest.search")}
                placeholder={t("guest.search")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9"
              />
            </div>
            <ul className="mt-4 space-y-1">
              {filtered.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-pressed={selectedId === item.id}
                    onClick={() => setSelectedId(item.id)}
                    className={cn(
                      "w-full rounded-lg p-3 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                      selectedId === item.id && "bg-accent",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <StatusIcon status={item.status} className="mt-0.5" />
                      <span className="min-w-0 text-sm font-medium break-words">
                        {item.title || t("guest.reportFallback", { number: item.number })}
                      </span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-sm break-words text-muted-foreground">
                      {item.body}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span>#{item.number}</span>
                      <span>{t(STATUS_META[item.status].labelKey)}</span>
                      <RelativeTime iso={item.createdAt} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            {filtered.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("guest.noMatches")}</p>
            )}
          </section>
          <section aria-label={t("guest.conversation")} className="min-w-0 py-6 md:pl-7">
            {!selectedId ? (
              <EmptyState
                icon={MessageSquare}
                title={t("guest.chooseReport")}
                description={t("guest.chooseHelp")}
              />
            ) : thread.error ? (
              <ErrorState
                error={thread.error}
                retry={() => {
                  void thread.refetch();
                }}
              />
            ) : !thread.currentData ? (
              <div role="status" className="py-12 text-center text-sm text-muted-foreground">
                {t("guest.loading")}
              </div>
            ) : (
              <GuestThread
                key={selectedId}
                data={thread.currentData}
                projectKey={projectKey}
                access={access}
                canReply={project.canReply}
                onDenied={() => setReplyDenied(true)}
              />
            )}
          </section>
        </div>
      )}
      {!branding.hidePoweredBy && (
        <footer className="border-t pt-5 text-xs text-muted-foreground">{t("guest.poweredBy")}</footer>
      )}
    </main>
  );
}

function GuestThread({
  data,
  projectKey,
  access,
  canReply,
  onDenied,
}: {
  data: GuestThreadResponse;
  projectKey: string;
  access: GuestPortalAccess;
  canReply: boolean;
  onDenied: () => void;
}) {
  const t = useT();
  const { item, replies } = data;
  const [reply, mutation] = useGuestReplyMutation();
  const [sent, setSent] = useState(false);
  const form = useZodForm(guestReplyCreate, { defaultValues: { body: "" } });
  const submit = form.handleSubmit(async ({ body }) => {
    setSent(false);
    try {
      await reply({ key: projectKey, access, id: item.id, body }).unwrap();
      form.reset();
      setSent(true);
    } catch (error) {
      if (denied(error)) onDenied();
    }
  });
  let pageUrl: URL | null = null;
  try {
    if (item.pageUrl) {
      const parsed = new URL(item.pageUrl);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") pageUrl = parsed;
    }
  } catch {
    /* Invalid saved page URLs are never rendered as links. */
  }
  return (
    <>
      <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span>#{item.number}</span>
        <Badge variant="secondary">
          <StatusIcon status={item.status} />
          {t(STATUS_META[item.status].labelKey)}
        </Badge>
      </div>
      <h2 className="text-xl font-semibold tracking-tight break-words">
        {item.title || t("guest.reportFallback", { number: item.number })}
      </h2>
      <p className="mt-4 text-sm leading-relaxed break-words whitespace-pre-wrap">{item.body}</p>
      <RelativeTime iso={item.createdAt} className="mt-3 block text-xs text-muted-foreground" />
      {pageUrl && (
        <a
          href={pageUrl.href}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
          className="mt-3 inline-flex max-w-full items-center gap-1 rounded text-xs text-muted-foreground underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="truncate">
            {pageUrl.hostname}
            {pageUrl.pathname}
          </span>
          <ArrowUpRight className="size-3 shrink-0" aria-hidden="true" />
        </a>
      )}
      <h3 className="mt-8 mb-4 text-sm font-semibold">{t("guest.conversation")}</h3>
      <ol className="space-y-5">
        {replies.map((comment) => (
          <li key={comment.id} className="border-b pb-5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium">
                {comment.authorName || t(comment.team ? "guest.team" : "guest.you")}
              </span>
              {comment.team && <Badge variant="outline">{t("guest.team")}</Badge>}
              <RelativeTime iso={comment.createdAt} className="text-muted-foreground" />
            </div>
            <p className="mt-2 text-sm leading-relaxed break-words whitespace-pre-wrap">{comment.body}</p>
          </li>
        ))}
      </ol>
      {canReply ? (
        <form onSubmit={submit} className="mt-6 space-y-3">
          <Field
            id="guest-reply"
            label={t("guest.yourReply")}
            help={t("guest.replyHelp")}
            error={form.formState.errors.body?.message}
          >
            <Textarea
              {...form.register("body")}
              {...controlProps("guest-reply", form.formState.errors.body?.message, true)}
              rows={4}
              maxLength={10_000}
              disabled={mutation.isLoading}
            />
          </Field>
          {mutation.error && <FormError message={errorMessage(mutation.error)} />}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={mutation.isLoading}>
              <Send />
              {t(mutation.isLoading ? "guest.sending" : "guest.sendReply")}
            </Button>
            <p role="status" className="text-xs text-muted-foreground">
              {sent ? t("guest.replySent") : ""}
            </p>
          </div>
        </form>
      ) : (
        <p className="mt-6 rounded-lg bg-muted p-4 text-sm text-muted-foreground">{t("guest.readOnly")}</p>
      )}
    </>
  );
}
