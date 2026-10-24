"use client";

import { CircleCheck, X } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
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

function stepView(step: SetupStep, o: { instanceAdmin: boolean; projectId: string | null }): StepView {
  const install: Route = o.projectId ? (`/projects/${o.projectId}?tab=install` as Route) : "/projects?new=1";
  switch (step) {
    case "admin":
      return {
        title: "Create the admin account",
        detail: "The first account on a new server administers it.",
        href: null,
        cta: null,
      };
    case "email":
      return o.instanceAdmin
        ? {
            title: "Set up email",
            detail: "Add your SMTP server so reports reach the team's inbox.",
            href: "/settings/email",
            cta: "Add SMTP",
          }
        : {
            title: "Set up email",
            detail: "Your server admin adds SMTP under Settings › Email.",
            href: null,
            cta: null,
          };
    case "emailSent":
      return {
        title: "Send a test email",
        detail: "Proves the server can deliver mail.",
        href: o.instanceAdmin ? "/settings/email" : null,
        cta: o.instanceAdmin ? "Send a test" : null,
      };
    case "widget":
      return {
        title: "Install the widget",
        detail: "Paste one snippet on your site; it shows Connected once it loads.",
        href: install,
        cta: o.projectId ? "Get the snippet" : "Create a project",
      };
    case "feedback":
      return {
        title: "Receive your first report",
        detail: "Click the feedback button on your site and report a bug.",
        href: install,
        cta: "How to test",
      };
    case "team":
      return {
        title: "Add a teammate",
        detail: "Create their account or invite them by email.",
        href: "/settings/members",
        cta: "Add people",
      };
  }
}

const ORDER: SetupStep[] = ["admin", "email", "emailSent", "widget", "feedback", "team"];

export function SetupChecklist({ className }: { className?: string }) {
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
      aria-label="Get started"
      className={cn("border-b bg-muted/30 px-4 py-3", className)}
      data-testid="setup-checklist"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">
            Get started{" "}
            <span className="font-normal text-muted-foreground tabular-nums">
              · {c.done} of {c.total} done
            </span>
          </h2>
          <div
            className="mt-2 h-1 w-full max-w-xs overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={c.total}
            aria-valuenow={c.done}
            aria-label="Setup progress"
          >
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${(c.done / c.total) * 100}%` }}
            />
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Hide the checklist" onClick={dismiss}>
          <X />
        </Button>
      </div>
      <ol className="mt-3 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
        {ORDER.map((s) => {
          const done = c.steps[s];
          const v = stepView(s, { instanceAdmin, projectId: c.projectId });
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
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="Done" />
              ) : (
                <span
                  className="mt-0.5 size-4 shrink-0 rounded-full border border-dashed"
                  aria-label="To do"
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
