"use client";

import type { ShareReportResponse, ShareRoundResponse } from "@pinwren/core";
import { SHARE_TOKEN_HEADER, SHARE_UNLOCK_HEADER } from "@pinwren/core";
import { skipToken } from "@reduxjs/toolkit/query";
import {
  ArrowUpRight,
  CircleCheck,
  Clock,
  LinkIcon,
  LockKeyhole,
  MessageSquareWarning,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { z } from "zod";
import { BrandMark, BrandTheme } from "@/components/brand";
import { LocalDate, PRIORITY_META, RelativeTime, STATUS_META, StatusIcon } from "@/components/feedback-meta";
import { controlProps, Field, FormError, useZodForm } from "@/components/form";
import { SignoffBadge } from "@/components/round-signoffs";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Asset } from "@/lib/api";
import { en, type Key } from "@/lib/i18n/en";
import { useT } from "@/lib/i18n/provider";
import { readShareAccess, saveShareAccess, type ShareAccess, shareBrowser } from "@/lib/share-access";
import { errorMessage, isApiError } from "@/lib/store/api/base";
import {
  shareApi,
  useShareCommentMutation,
  useShareSignoffMutation,
  useShareUnlockMutation,
  useShareViewQuery,
} from "@/lib/store/api/share";
import { useAppDispatch } from "@/lib/store/hooks";
import { ReplayViewer } from "../../(app)/inbox/replay-viewer";
import ShareLoading from "./loading";

// External snapshot, like the guest portal: SSR stays credential-free and the fragment is consumed after mount.
const snapshots = new Map<string, ShareAccess | null>();
const listeners = new Set<() => void>();
const serverSnapshot = () => undefined;
const notifyAll = () => {
  for (const l of listeners) l();
};

function useShareAccess(projectKey: string) {
  const subscribe = useCallback(
    (listener: () => void) => {
      listeners.add(listener);
      snapshots.set(projectKey, readShareAccess(projectKey, shareBrowser()));
      listener();
      return () => {
        listeners.delete(listener);
      };
    },
    [projectKey],
  );
  return useSyncExternalStore(subscribe, () => snapshots.get(projectKey), serverSnapshot);
}

const msgOf = (t: (k: Key) => string) => (m?: string) => (m && m in en ? t(m as Key) : m);

export function ShareView({ projectKey }: { projectKey: string }) {
  const t = useT();
  const access = useShareAccess(projectKey);
  const view = useShareViewQuery(access ? { key: projectKey, access } : skipToken, {
    refetchOnFocus: true,
  });

  if (access === undefined || (access && view.isLoading)) return <ShareLoading />;
  const error = view.error;
  if (!access) return <Unavailable title={t("share.noLinkTitle")} help={t("share.noLinkHelp")} />;
  if (isApiError(error) && error.code === "SHARE_PASSWORD_REQUIRED") {
    return (
      <PasswordGate
        projectKey={projectKey}
        access={access}
        onUnlocked={(unlock) => {
          const next = { ...access, unlock };
          saveShareAccess(projectKey, next, shareBrowser().storage);
          snapshots.set(projectKey, next);
          notifyAll();
        }}
      />
    );
  }
  if (isApiError(error) && error.status === 410) {
    return <Unavailable title={t("share.goneTitle")} help={t("share.goneHelp")} />;
  }
  if (isApiError(error) && error.status === 404) {
    return <Unavailable title={t("share.notFoundTitle")} help={t("share.notFoundHelp")} />;
  }
  if (error || !view.data) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <ErrorState
          error={error}
          retry={() => {
            void view.refetch();
          }}
        />
      </main>
    );
  }
  const data = view.data;
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <BrandTheme accent={data.branding.accent} />
      <header className="flex items-start gap-3 border-b pb-5">
        <BrandMark logoUrl={data.branding.logoUrl} className="mt-1" />
        <div className="min-w-0">
          <p className="mb-1 text-xs font-medium text-muted-foreground">{data.branding.productName}</p>
          <h1 className="text-xl font-semibold tracking-tight break-words sm:text-2xl">
            {data.project.name}
          </h1>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3" aria-hidden="true" />
            {t("share.linkExpires")} <LocalDate iso={data.link.expiresAt} />
          </p>
        </div>
      </header>
      {data.kind === "report" ? (
        <ReportView data={data} projectKey={projectKey} access={access} />
      ) : (
        <RoundView data={data} projectKey={projectKey} access={access} />
      )}
      {!data.branding.hidePoweredBy && (
        <footer className="mt-10 border-t pt-5 text-xs text-muted-foreground">{t("share.poweredBy")}</footer>
      )}
    </main>
  );
}

function Unavailable({ title, help }: { title: string; help: string }) {
  const t = useT();
  return (
    <main className="mx-auto flex min-h-svh max-w-lg flex-col justify-center px-6 py-12">
      <div className="mb-8">
        <BrandMark logoUrl={null} />
      </div>
      <LinkIcon className="mb-4 size-6 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{help}</p>
      <p className="mt-6 text-xs text-muted-foreground">{t("share.poweredBy")}</p>
    </main>
  );
}

const passwordForm = z.object({ password: z.string().min(1, "share.passwordRequired").max(128) });

function PasswordGate({
  projectKey,
  access,
  onUnlocked,
}: {
  projectKey: string;
  access: ShareAccess;
  onUnlocked: (unlock: string) => void;
}) {
  const t = useT();
  const msg = msgOf(t);
  const [unlock] = useShareUnlockMutation();
  const form = useZodForm(passwordForm, { defaultValues: { password: "" } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async ({ password }) => {
    try {
      const res = await unlock({ key: projectKey, access, password }).unwrap();
      onUnlocked(res.unlock);
    } catch (e) {
      form.setError("root", {
        message:
          isApiError(e) && e.code === "SHARE_PASSWORD_INVALID" ? t("share.passwordWrong") : errorMessage(e),
      });
    }
  });
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center px-6 py-12">
      <LockKeyhole className="mb-4 size-6 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-2xl font-semibold tracking-tight">{t("share.passwordTitle")}</h1>
      <p className="mt-3 text-sm text-muted-foreground">{t("share.passwordHelp")}</p>
      <form noValidate className="mt-6 grid gap-4" onSubmit={(e) => void submit(e)}>
        <Field id="share-pw" label={t("share.password")} error={msg(errors.password?.message)}>
          <Input
            {...controlProps("share-pw", msg(errors.password?.message))}
            {...form.register("password")}
            type="password"
            autoComplete="off"
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the only field on the page
            autoFocus
          />
        </Field>
        <FormError message={errors.root?.message} />
        <Button type="submit" disabled={isSubmitting} className="self-start">
          {isSubmitting ? t("share.unlocking") : t("share.unlock")}
        </Button>
      </form>
    </main>
  );
}

// --- A report ------------------------------------------------------------------------------------------------

/** Fetch a protected file with the link's headers and hand back an object URL (images can't carry headers). */
function useAssetUrl(projectKey: string, access: ShareAccess, assetId: string | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!assetId) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    void shareFetch(projectKey, access, assetId)
      .then(async (res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (!blob || cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectKey, access, assetId]);
  return url;
}

const shareFetch = (projectKey: string, access: ShareAccess, assetId: string) =>
  fetch(`/api/share/${encodeURIComponent(projectKey)}/assets/${assetId}`, {
    cache: "no-store",
    headers: {
      [SHARE_TOKEN_HEADER]: access.token,
      ...(access.unlock ? { [SHARE_UNLOCK_HEADER]: access.unlock } : {}),
    },
  });

function safeHttp(url: string | null): URL | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

function ReportView({
  data,
  projectKey,
  access,
}: {
  data: ShareReportResponse;
  projectKey: string;
  access: ShareAccess;
}) {
  const t = useT();
  const r = data.report;
  const shot = useAssetUrl(projectKey, access, r.screenshot?.id);
  const pageUrl = safeHttp(r.pageUrl);
  const handle = useRef(null);
  const d = r.diagnostics;
  const replayAsset: Asset | null = r.replay
    ? { id: r.replay.id, kind: "replay", contentType: r.replay.contentType, bytes: 0, name: null, meta: null }
    : null;
  return (
    <article className="py-6" data-testid="share-report">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>#{r.number}</span>
        <Badge variant="secondary" data-testid="share-status">
          <StatusIcon status={r.status} />
          {t(STATUS_META[r.status].labelKey)}
        </Badge>
        {r.status === "resolved" && (r.fixedInVersion || r.fixedInNextRelease) && (
          <Badge
            variant="outline"
            className="text-emerald-700 dark:text-emerald-400"
            data-testid="share-fixed-in"
          >
            {r.fixedInVersion
              ? t("releases.guestFixedIn", { version: r.fixedInVersion })
              : t("releases.guestFixedInNext")}
          </Badge>
        )}
        {r.priority !== "none" && <span>{t(PRIORITY_META[r.priority].labelKey)}</span>}
        <RelativeTime iso={r.createdAt} />
      </div>
      <h2 className="text-xl font-semibold tracking-tight break-words">
        {r.title || t("share.reportFallback", { number: r.number })}
      </h2>
      <p className="mt-4 text-sm leading-relaxed break-words whitespace-pre-wrap">{r.body}</p>
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
      {(r.browser || r.os) && (
        <p className="mt-2 text-xs text-muted-foreground">{[r.browser, r.os].filter(Boolean).join(" · ")}</p>
      )}
      {r.screenshot && (
        <figure className="mt-6">
          {shot ? (
            // eslint-disable-next-line @next/next/no-img-element -- a blob: URL for a protected file; next/image can't take it
            <img
              src={shot}
              alt={t("share.screenshotAlt")}
              className="max-h-[32rem] w-full rounded-lg border object-contain"
            />
          ) : (
            <div className="aspect-[16/10] animate-pulse rounded-lg border bg-muted" aria-hidden="true" />
          )}
        </figure>
      )}
      {replayAsset && (
        <section className="mt-6" aria-label={t("share.replay")}>
          <h3 className="mb-2 text-sm font-semibold">{t("share.replay")}</h3>
          <ReplayViewer
            asset={replayAsset}
            diagnostics={null}
            handle={handle}
            onTime={() => undefined}
            load={(id) => shareFetch(projectKey, access, id)}
          />
        </section>
      )}
      <section className="mt-8 grid gap-4" aria-label={t("share.diagnostics")}>
        <h3 className="text-sm font-semibold">{t("share.diagnostics")}</h3>
        <p className="text-xs text-muted-foreground">{t("share.diagnosticsMasked")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border p-3 text-sm" data-testid="share-console">
            <p className="font-medium">{t("share.console")}</p>
            <p className="text-xs text-muted-foreground">
              {t("share.consoleCounts", { errors: d.console.errors, warnings: d.console.warnings })}
            </p>
            {d.console.entries.length > 0 && (
              <ul className="mt-2 grid gap-1 font-mono text-xs">
                {d.console.entries.map((e, i) => (
                  <li key={i} className="break-words">
                    <span className={e.level === "error" ? "text-destructive" : "text-amber-600"}>
                      {e.level}
                    </span>{" "}
                    {e.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-lg border p-3 text-sm" data-testid="share-network">
            <p className="font-medium">{t("share.network")}</p>
            <p className="text-xs text-muted-foreground">
              {t("share.networkCounts", { total: d.network.total, failed: d.network.failed })}
            </p>
            {d.network.entries.length > 0 && (
              <ul className="mt-2 grid gap-1 font-mono text-xs">
                {d.network.entries.map((e, i) => (
                  <li key={i} className="break-all">
                    <span className="text-destructive">{e.status || "ERR"}</span> {e.method} {e.url}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
      <Comments data={data} projectKey={projectKey} access={access} />
    </article>
  );
}

const commentForm = z.object({
  name: z.string().trim().min(1, "share.nameRequired").max(80),
  body: z.string().trim().min(1, "share.commentRequired").max(10_000),
});

function Comments({
  data,
  projectKey,
  access,
}: {
  data: ShareReportResponse;
  projectKey: string;
  access: ShareAccess;
}) {
  const t = useT();
  const msg = msgOf(t);
  const [send] = useShareCommentMutation();
  const [sent, setSent] = useState(false);
  const form = useZodForm(commentForm, { defaultValues: { name: "", body: "" } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (v) => {
    setSent(false);
    try {
      await send({ key: projectKey, access, ...v }).unwrap();
      form.reset({ name: v.name, body: "" });
      setSent(true);
    } catch (e) {
      form.setError("root", { message: errorMessage(e) });
    }
  });
  return (
    <section className="mt-10" aria-label={t("share.comments")}>
      <h3 className="mb-4 text-sm font-semibold">{t("share.comments")}</h3>
      {data.comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("share.noComments")}</p>
      ) : (
        <ol className="space-y-5">
          {data.comments.map((c) => (
            <li key={c.id} className="border-b pb-5" data-testid="share-comment">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium">
                  {c.authorName || t(c.team ? "share.team" : "share.visitor")}
                </span>
                {c.team && <Badge variant="outline">{t("share.team")}</Badge>}
                <RelativeTime iso={c.createdAt} className="text-muted-foreground" />
              </div>
              <p className="mt-2 text-sm leading-relaxed break-words whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
        </ol>
      )}
      {data.link.canComment && (
        <form noValidate className="mt-6 grid gap-3" onSubmit={(e) => void submit(e)}>
          <Field id="share-name" label={t("share.yourName")} error={msg(errors.name?.message)}>
            <Input
              {...controlProps("share-name", msg(errors.name?.message))}
              {...form.register("name")}
              maxLength={80}
              autoComplete="name"
            />
          </Field>
          <Field id="share-comment" label={t("share.yourComment")} error={msg(errors.body?.message)}>
            <Textarea
              {...controlProps("share-comment", msg(errors.body?.message))}
              {...form.register("body")}
              rows={4}
              maxLength={10_000}
            />
          </Field>
          <FormError message={errors.root?.message} />
          {sent && (
            <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
              {t("share.commentSent")}
            </p>
          )}
          <Button type="submit" disabled={isSubmitting} className="self-start">
            {isSubmitting ? t("share.sending") : t("share.sendComment")}
          </Button>
        </form>
      )}
    </section>
  );
}

// --- A round, with sign-off ------------------------------------------------------------------------------

const signoffForm = z
  .object({
    decision: z.enum(["approved", "changes_requested"]),
    name: z.string().trim().min(1, "share.nameRequired").max(120),
    email: z.email("share.emailInvalid").max(254),
    note: z.string().trim().max(5000),
  })
  .refine((v) => v.decision === "approved" || v.note.length > 0, {
    message: "share.noteRequired",
    path: ["note"],
  });

function RoundView({
  data,
  projectKey,
  access,
}: {
  data: ShareRoundResponse;
  projectKey: string;
  access: ShareAccess;
}) {
  const t = useT();
  const { round } = data;
  const pct = round.counts.total ? Math.round((round.counts.closed / round.counts.total) * 100) : 0;
  return (
    <section className="py-6" data-testid="share-round" aria-label={round.name}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold tracking-tight break-words">{round.name}</h2>
        <SignoffBadge state={data.state} required={round.requireSignoff} />
        {round.status === "closed" && <Badge variant="outline">{t("share.roundClosed")}</Badge>}
      </div>
      {round.dueAt && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("share.due")} <LocalDate iso={round.dueAt} />
        </p>
      )}
      <div
        className="mt-4 h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={t("share.progress")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
        {t("share.progressCounts", { closed: round.counts.closed, total: round.counts.total })}
      </p>

      <h3 className="mt-8 mb-3 text-sm font-semibold">{t("share.items")}</h3>
      {data.items.length === 0 ? (
        <EmptyState icon={CircleCheck} title={t("share.noItems")} />
      ) : (
        <ul className="divide-y rounded-lg border" data-testid="share-items">
          {data.items.map((i) => (
            <li key={i.id} className="grid gap-1 px-3 py-2.5 text-sm">
              <div className="flex items-start gap-2">
                <StatusIcon status={i.status} className="mt-0.5" />
                <span className="min-w-0 font-medium break-words">
                  #{i.number} {i.title || i.body.split("\n")[0]?.slice(0, 120)}
                </span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {t(STATUS_META[i.status].labelKey)}
                  {i.status === "resolved" && i.fixedInVersion && (
                    <span className="ml-1.5 text-emerald-700 dark:text-emerald-400">
                      {t("releases.guestFixedIn", { version: i.fixedInVersion })}
                    </span>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-8 mb-3 text-sm font-semibold">{t("share.signoffs")}</h3>
      {data.signoffs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("share.noSignoffs")}</p>
      ) : (
        <ol className="grid gap-3" data-testid="share-signoffs">
          {data.signoffs.map((s) => (
            <li key={s.id} className="grid gap-1 rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <SignoffBadge state={s.decision} required={false} />
                <span className="font-medium">{s.name}</span>
                <RelativeTime iso={s.createdAt} className="ml-auto text-xs text-muted-foreground" />
              </div>
              {s.note && <p className="break-words whitespace-pre-wrap text-muted-foreground">{s.note}</p>}
            </li>
          ))}
        </ol>
      )}
      {round.status === "closed" ? (
        <p className="mt-6 flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          <TriangleAlert className="size-4" aria-hidden="true" /> {t("share.roundClosedNote")}
        </p>
      ) : (
        <SignoffForm projectKey={projectKey} access={access} />
      )}
    </section>
  );
}

function SignoffForm({ projectKey, access }: { projectKey: string; access: ShareAccess }) {
  const t = useT();
  const msg = msgOf(t);
  const dispatch = useAppDispatch();
  const [send] = useShareSignoffMutation();
  const [done, setDone] = useState<"approved" | "changes_requested" | null>(null);
  const form = useZodForm(signoffForm, {
    defaultValues: { decision: "approved", name: "", email: "", note: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (v) => {
    try {
      await send({ key: projectKey, access, ...v }).unwrap();
      setDone(v.decision);
      form.reset({ decision: "approved", name: v.name, email: v.email, note: "" });
      dispatch(shareApi.util.invalidateTags([{ type: "Share", id: `public:${projectKey}` }]));
    } catch (e) {
      form.setError("root", { message: errorMessage(e) });
    }
  });
  const answer = (decision: "approved" | "changes_requested") => {
    form.setValue("decision", decision);
    void submit();
  };
  return (
    <form
      noValidate
      className="mt-8 grid gap-3 rounded-xl border p-4"
      aria-label={t("share.signoffFormTitle")}
      onSubmit={(e) => e.preventDefault()}
      data-testid="signoff-form"
    >
      <h3 className="text-sm font-semibold">{t("share.signoffFormTitle")}</h3>
      <p className="text-sm text-muted-foreground">{t("share.signoffFormHelp")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="so-name" label={t("share.yourName")} error={msg(errors.name?.message)}>
          <Input
            {...controlProps("so-name", msg(errors.name?.message))}
            {...form.register("name")}
            maxLength={120}
            autoComplete="name"
          />
        </Field>
        <Field id="so-email" label={t("share.yourEmail")} error={msg(errors.email?.message)}>
          <Input
            {...controlProps("so-email", msg(errors.email?.message))}
            {...form.register("email")}
            type="email"
            maxLength={254}
            autoComplete="email"
          />
        </Field>
      </div>
      <Field id="so-note" label={t("share.noteOptional")} error={msg(errors.note?.message)}>
        <Textarea
          {...controlProps("so-note", msg(errors.note?.message))}
          {...form.register("note")}
          rows={3}
          maxLength={5000}
        />
      </Field>
      <FormError message={errors.root?.message} />
      {done && (
        <p
          role="status"
          className="text-sm text-emerald-700 dark:text-emerald-400"
          data-testid="signoff-sent"
        >
          {t(done === "approved" ? "share.sentApproved" : "share.sentChanges")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={isSubmitting}
          onClick={() => answer("approved")}
          data-testid="signoff-approve"
        >
          <CircleCheck /> {t("share.approve")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isSubmitting}
          onClick={() => answer("changes_requested")}
          data-testid="signoff-changes"
        >
          <MessageSquareWarning /> {t("share.requestChanges")}
        </Button>
      </div>
    </form>
  );
}
