import {
  Anchor,
  Bot,
  Box,
  Camera,
  EyeOff,
  Globe,
  Inbox,
  Languages,
  type LucideIcon,
  Paintbrush,
  PlayCircle,
  Shield,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

function Card({
  icon: Icon,
  title,
  children,
  visual,
  className,
  badge,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  visual?: ReactNode;
  className?: string;
  badge?: string;
}) {
  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border bg-card p-5 shadow-xs transition-shadow hover:shadow-md",
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className="bg-brand-soft text-brand grid size-8 place-items-center rounded-lg">
          <Icon className="size-4" aria-hidden />
        </span>
        <h3 className="font-semibold">{title}</h3>
        {badge && (
          <span className="border-brand/30 bg-brand-soft text-brand ml-auto rounded-full border px-2 py-0.5 text-[11px] font-medium">
            {badge}
          </span>
        )}
      </div>
      <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{children}</p>
      {visual && (
        <div className="mt-5 flex-1" aria-hidden>
          {visual}
        </div>
      )}
    </article>
  );
}

const Mono = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn("rounded-lg border bg-muted/50 p-3 font-mono text-[11.5px] leading-relaxed", className)}>
    {children}
  </div>
);

function InboxVisual() {
  const rows = [
    { n: 142, t: "Add to cart does nothing", k: "Bug", s: "Open", c: "bg-destructive" },
    { n: 141, t: "Headline wraps on laptop", k: "Comment", s: "In progress", c: "bg-warning" },
    { n: 139, t: "Use the autumn photo", k: "Comment", s: "Resolved", c: "bg-success" },
  ];
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div
          key={r.n}
          className={cn(
            "flex items-center gap-2.5 rounded-lg border bg-background px-2.5 py-2 text-[12px]",
            i === 0 && "ring-brand/40 ring-2",
          )}
        >
          <span className={cn("size-2 shrink-0 rounded-full", r.c)} />
          <span className="font-mono text-muted-foreground">#{r.n}</span>
          <span className="truncate font-medium">{r.t}</span>
          <span className="ml-auto shrink-0 rounded bg-muted px-1.5 text-[10.5px] text-muted-foreground">
            {r.k}
          </span>
        </div>
      ))}
      <div className="flex flex-wrap gap-1.5 pt-1.5 text-[11px] text-muted-foreground">
        {["j", "k", "e", "s", "a", "/"].map((k) => (
          <kbd key={k} className="rounded border bg-background px-1.5 font-mono shadow-xs">
            {k}
          </kbd>
        ))}
        <span className="self-center">keyboard-first</span>
      </div>
    </div>
  );
}

function RoutingVisual() {
  const targets = ["Email", "Slack", "Discord", "Webhooks", "GitHub", "GitLab"];
  return (
    <div className="flex flex-wrap gap-1.5">
      {targets.map((t) => (
        <span key={t} className="rounded-full border bg-background px-2.5 py-1 text-[12px] font-medium">
          {t}
        </span>
      ))}
    </div>
  );
}

export function Features() {
  return (
    <section id="features" className="scroll-mt-20 border-b py-24">
      <div className="container-page">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-brand text-sm font-semibold">Two jobs, one widget</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Client review and developer-grade bug reports
          </h2>
          <p className="mt-4 text-pretty text-muted-foreground">
            Teams usually pay for a visual-review tool and a bug reporter. Pinwren does both, on your own
            server, with no artificial limits on the core features.
          </p>
        </div>

        <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card
            icon={Anchor}
            title="Comments pinned to the page"
            className="lg:col-span-2"
            visual={
              <div className="bg-dots relative h-36 overflow-hidden rounded-xl border bg-background">
                <div className="absolute top-5 left-6 h-3 w-40 rounded bg-foreground/80" />
                <div className="absolute top-11 left-6 h-2 w-56 rounded bg-muted-foreground/30" />
                <div className="absolute top-16 left-6 h-2 w-48 rounded bg-muted-foreground/30" />
                <div className="border-brand bg-brand/10 absolute top-4 left-[18rem] h-24 w-44 rounded-lg border-2 border-dashed max-sm:left-[12rem]" />
                <span className="bg-brand text-brand-foreground absolute top-2 left-[28.5rem] grid size-6 place-items-center rounded-full rounded-bl-none text-[11px] font-semibold shadow ring-2 ring-background max-sm:left-[22.5rem]">
                  2
                </span>
                <div className="absolute bottom-3 left-6 rounded-lg border bg-popover px-2.5 py-1.5 text-[12px] shadow">
                  “The CTA is hard to see on mobile.”
                </div>
              </div>
            }
          >
            Click an element, drag over a region or select text. Threads, replies with a team badge, resolve
            and reopen from the page, and deep links that open the page with the thread showing.
          </Card>
          <Card
            icon={Camera}
            title="Annotated bug reports"
            visual={
              <Mono>
                <span className="text-red-700 dark:text-red-300">✕ TypeError: cart is undefined</span>
                <br />
                <span className="text-red-700 dark:text-red-300">✕ POST /api/cart → 500</span>
                <br />
                <span className="text-muted-foreground">Chrome 131 · macOS · 1440×900 · en-GB</span>
              </Mono>
            }
          >
            Viewport, full-page, element or screen capture; draw, box, arrow, text, pixelate and crop. Console
            errors, failed requests and the browser come along.
          </Card>
          <Card icon={Inbox} title="A triage inbox that keeps up" visual={<InboxVisual />}>
            List, board and page review with pins over the screenshot. Statuses, priorities, assignees, bulk
            edits with undo and a shortcut for everything.
          </Card>
          <Card icon={Workflow} title="Routes where your team works" visual={<RoutingVisual />}>
            Signed webhooks with Slack and Discord formats and a delivery log, email, and two-way GitHub and
            GitLab issue sync — including GitHub Enterprise and self-managed GitLab.
          </Card>
          <Card
            icon={Bot}
            title="Ready for AI agents"
            badge="New in 0.1"
            visual={<Mono>claude mcp add pinwren -- npx -y @pinwren/mcp</Mono>}
          >
            An MCP server lets Claude Code or Cursor search feedback, pull the reproduction context and
            resolve it. Plus a REST API, typed SDK and CLI.
          </Card>
          <Card icon={Shield} title="Safe on your site">
            Closed Shadow DOM, no global CSS or JS, every error caught. The core is about 26 KB gzip; the
            panel, report form, capture engine and each language load only when needed.
          </Card>
          <Card icon={EyeOff} title="Privacy built in">
            Passwords and card fields are always masked; mark anything else with{" "}
            <code className="font-mono text-[12px]">data-pinwren-mask</code>. Privacy mode masks every text
            field and asks for consent.
          </Card>
          <Card icon={PlayCircle} title="Session replay" badge="New in 0.1">
            Optionally attach the last 30–120 seconds before a report, with every input masked — recorded in
            the browser and stored on your server.
          </Card>
          <Card icon={Box} title="One container + Postgres">
            Files on disk or any S3-compatible bucket, background jobs in Postgres, settings in the UI that
            environment variables can lock. No Redis, no queue broker.
          </Card>
          <Card icon={Languages} title="11 languages">
            English, Spanish, French, German, Brazilian Portuguese, Italian, Japanese, Hindi, Dutch, Chinese
            and Russian — each loaded only for visitors who need it.
          </Card>
          <Card icon={Paintbrush} title="Your brand, not ours">
            Launcher position, shape, icon and colour; dialog accent and logo; your name, logo and colour in
            the dashboard and emails.
          </Card>
        </div>
        <p className="mt-8 text-center text-sm text-muted-foreground">
          <Globe className="mr-1.5 inline size-4 align-[-3px]" aria-hidden />
          Everything above is in the free, self-hosted Community edition.{" "}
          <Link href="/docs/licensing" className="font-medium text-foreground underline underline-offset-4">
            Editions & licensing
          </Link>
        </p>
      </div>
    </section>
  );
}
