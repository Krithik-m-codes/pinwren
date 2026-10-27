"use client";

import { CircleCheck, X } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import type { Key } from "@/lib/i18n/en";
import { useT } from "@/lib/i18n/provider";
import { type SetupStep, useSetupChecklistQuery } from "@/lib/store/api/onboarding";
import { cn } from "@/lib/utils";
import { useViewer } from "@/lib/viewer";

// First-run checklist (wave-5 contract §3.5) on the inbox: every step comes from real state on the server
// (GET /api/setup-checklist), so it ticks itself as the owner goes. Shown to workspace Admins until every
// step is done or they dismiss it. Dismissal is a per-browser convenience (localStorage).

const DISMISS_KEY = "pinwren.setupChecklist.dismissed";
const listeners = new Set<() => void>();
/** Hidden for this page view even when storage is blocked. */
let hiddenThisView = false;

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function dismiss() {
  try {
    window.localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // Storage blocked (private window): hidden for this page view only.
  }
  hiddenThisView = true;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

type StepView = { title: string; detail: string; href: Route | null; cta: string | null };

function stepView(
  step: SetupStep,
  o: { instanceAdmin: boolean; projectId: string | null },
  t: (key: Key) => string,
): StepView {
  const install: Route = o.projectId ? (`/projects/${o.projectId}?tab=install` as Route) : "/projects?new=1";
  switch (step) {
    case "admin":
      return {
        title: t("components1.stepAdminTitle"),
        detail: t("components1.stepAdminDetail"),
        href: null,
        cta: null,
      };
    case "email":
      return o.instanceAdmin
        ? {
            title: t("components1.stepEmailTitle"),
            detail: t("components1.stepEmailDetailAdmin"),
            href: "/settings/email",
            cta: t("components1.stepEmailCta"),
          }
        : {
            title: t("components1.stepEmailTitle"),
            detail: t("components1.stepEmailDetailMember"),
            href: null,
            cta: null,
          };
    case "emailSent":
      return {
        title: t("components1.stepEmailSentTitle"),
        detail: t("components1.stepEmailSentDetail"),
        href: o.instanceAdmin ? "/settings/email" : null,
        cta: o.instanceAdmin ? t("components1.stepEmailSentCta") : null,
      };
    case "widget":
      return {
        title: t("components1.stepWidgetTitle"),
        detail: t("components1.stepWidgetDetail"),
        href: install,
        cta: o.projectId ? t("components1.stepWidgetCtaSnippet") : t("components1.stepWidgetCtaProject"),
      };
    case "feedback":
      return {
        title: t("components1.stepFeedbackTitle"),
        detail: t("components1.stepFeedbackDetail"),
        href: install,
        cta: t("components1.stepFeedbackCta"),
      };
    case "team":
      return {
        title: t("components1.stepTeamTitle"),
        detail: t("components1.stepTeamDetail"),
        href: "/settings/members",
        cta: t("components1.stepTeamCta"),
      };
  }
}

const ORDER: SetupStep[] = ["admin", "email", "emailSent", "widget", "feedback", "team"];

export function SetupChecklist({ className }: { className?: string }) {
  const t = useT();
  const { isAdmin, instanceAdmin } = useViewer();
  const dismissed = useSyncExternalStore(
    subscribe,
    () => hiddenThisView || readDismissed(),
    () => true,
  );
  const query = useSetupChecklistQuery(undefined, { skip: !isAdmin || dismissed });
  const c = query.data?.checklist;
  // Loading and errors show nothing: the checklist is a helper, never in the way of the inbox.
  if (!isAdmin || dismissed || !c || c.done === c.total) return null;
  const next = ORDER.find((s) => !c.steps[s]);

  return (
    <section
      aria-label={t("components1.getStarted")}
      className={cn("border-b bg-muted/30 px-4 py-3", className)}
      data-testid="setup-checklist"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">
            {t("components1.getStarted")}{" "}
            <span className="font-normal text-muted-foreground tabular-nums">
              {t("components1.setupProgressCount", { done: c.done, total: c.total })}
            </span>
          </h2>
          <div
            className="mt-2 h-1 w-full max-w-xs overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={c.total}
            aria-valuenow={c.done}
            aria-label={t("components1.setupProgress")}
          >
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${(c.done / c.total) * 100}%` }}
            />
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label={t("components1.hideChecklist")} onClick={dismiss}>
          <X />
        </Button>
      </div>
      <ol className="mt-3 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
        {ORDER.map((s) => {
          const done = c.steps[s];
          const v = stepView(s, { instanceAdmin, projectId: c.projectId }, t);
          return (
            <li
              key={s}
              data-step={s}
              data-done={done || undefined}
              className={cn(
                "flex items-start gap-2 rounded-lg border bg-background px-3 py-2 text-sm",
                s === next && "border-primary/40 ring-1 ring-primary/20",
              )}
            >
              {done ? (
                <CircleCheck
                  className="mt-0.5 size-4 shrink-0 text-emerald-600"
                  aria-label={t("components1.done")}
                />
              ) : (
                <span
                  className="mt-0.5 size-4 shrink-0 rounded-full border border-dashed"
                  aria-label={t("components1.toDo")}
                />
              )}
              <span className="min-w-0 flex-1">
                <span className={cn("block font-medium", done && "text-muted-foreground line-through")}>
                  {v.title}
                </span>
                {!done && <span className="block text-xs text-muted-foreground">{v.detail}</span>}
              </span>
              {!done && v.href && v.cta && (
                <Link
                  href={v.href}
                  className="shrink-0 text-xs font-medium text-primary underline-offset-2 hover:underline"
                >
                  {v.cta}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
