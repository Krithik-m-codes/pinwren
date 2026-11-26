import {
  BarChart3,
  Bell,
  Braces,
  FileSignature,
  FlaskConical,
  GitPullRequestArrow,
  KeyRound,
  ListChecks,
  type LucideIcon,
  Mic,
  Rocket,
  Sparkles,
  Users,
} from "lucide-react";
import Link from "next/link";

type Item = { icon: LucideIcon; title: string; text: string; href?: "/docs/licensing" };

// Everything here is built and covered by tests (docs/roadmap-status.md); optional AI features are marked as
// such because they need a provider the owner configures.
const ITEMS: Item[] = [
  {
    icon: Users,
    title: "A guest portal for clients",
    text: "Clients follow their own reports from an email link: reporter-scoped threads and public replies, no account and never a paid seat.",
  },
  {
    icon: FileSignature,
    title: "Share, review, sign off",
    text: "Send a password-protected link to a report or a review round. Clients comment on it and approve it, and you keep the record.",
  },
  {
    icon: Rocket,
    title: "Releases and regressions",
    text: "Record releases from CI with one command. Items show the release that fixed them and are flagged when they come back.",
  },
  {
    icon: ListChecks,
    title: "Custom fields and a form builder",
    text: "Ask for an order number or a plan tier on bug reports. Answers show on the item, filter the inbox and export with it.",
  },
  {
    icon: Mic,
    title: "Screen and voice recording",
    text: "Attach a short screen recording or voice note instead of typing the steps, stored on your own server.",
  },
  {
    icon: Sparkles,
    title: "Automation and optional AI",
    text: "Rules label, assign and route new reports. Bring your own provider for summaries, triage, duplicate checks, reproduction steps and translation.",
  },
  {
    icon: BarChart3,
    title: "Dashboards that are yours",
    text: "Named, shareable dashboards with a filter bar that lives in the URL, so a view of your feedback is a link you can send.",
  },
  {
    icon: GitPullRequestArrow,
    title: "More trackers, two-way",
    text: "GitHub, GitLab and Linear sync, plus Trello, Asana, ClickUp and Notion boards. Jira Cloud with an Enterprise licence.",
  },
  {
    icon: Bell,
    title: "Slack you can act from",
    text: "Interactive cards and a /pinwren command: assign to yourself, change the status or add a label without leaving the channel.",
  },
  {
    icon: FlaskConical,
    title: "Hand-off to your agent",
    text: "A reproduction brief and a draft Playwright test for every report: pipe it to Claude Code, or fetch it with the CLI or MCP server.",
  },
  {
    icon: KeyRound,
    title: "Sign-in you can trust",
    text: "Passkeys, two-factor, email links, Google and GitHub sign-in, and roles with read-only viewers.",
  },
  {
    icon: Braces,
    title: "An open API for the rest",
    text: "A token-scoped REST API, a typed SDK, a CLI with a server doctor, and an MCP server. Releases, labels, stats and custom fields included.",
  },
];

export function MoreFeatures() {
  return (
    <section id="more" className="scroll-mt-20 border-b bg-muted/30 py-24">
      <div className="container-page">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold text-brand">And it keeps going</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Built for the whole feedback loop, not just the widget
          </h2>
          <p className="mt-4 text-pretty text-muted-foreground">
            From the first comment to the release that fixes it and the client who signs it off. All of it
            runs in the free Community edition unless marked.
          </p>
        </div>
        <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ITEMS.map(({ icon: Icon, title, text }) => (
            <li key={title} className="rounded-2xl border bg-card p-5 shadow-xs">
              <div className="flex items-center gap-2.5">
                <span className="bg-brand-soft text-brand-ink grid size-8 place-items-center rounded-lg">
                  <Icon className="size-4" aria-hidden />
                </span>
                <h3 className="font-semibold">{title}</h3>
              </div>
              <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{text}</p>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-center text-sm text-muted-foreground">
          Need SSO, SCIM or an audit log for your organisation? They are on the{" "}
          <Link href="/docs/licensing" className="font-medium text-foreground underline underline-offset-4">
            Enterprise roadmap
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
