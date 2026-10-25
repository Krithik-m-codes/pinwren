import { Check, Minus, Heart, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/button-link";
import { PlanCards } from "@/components/pricing/plan-cards";
import { cn } from "@/lib/utils";

const BUY_ME_COFFEE_URL = "https://www.buymeacoffee.com/krithikm92f";
const GITHUB_SPONSORS_URL = "https://github.com/sponsors/Krithik-m-codes";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Pinwren is free to self-host with every core feature. Cloud plans and Enterprise licences for organisation-scale needs are coming soon.",
  alternates: { canonical: "/pricing" },
};

// Blueprint 07 §3. Paid prices are proposals and are labelled as such on the page.
const COLUMNS = ["Community", "Cloud Free", "Cloud Pro", "Cloud Business", "Enterprise"] as const;
type Cell = string | boolean;
const MATRIX: { group: string; rows: { label: string; cells: Cell[] }[] }[] = [
  {
    group: "Usage",
    rows: [
      { label: "Team seats", cells: ["Unlimited", "3", "10 (+$6/seat)", "30 (+$5/seat)", "Per contract"] },
      { label: "Guests (clients)", cells: ["Unlimited", "Unlimited", "Unlimited", "Unlimited", "Unlimited"] },
      { label: "Projects", cells: ["Unlimited", "1", "10", "Unlimited", "Unlimited"] },
      { label: "Reports / month", cells: ["Unlimited", "100", "2,000", "20,000", "Contract"] },
      { label: "Retention", cells: ["You decide", "30 days", "1 year", "3 years", "Custom"] },
    ],
  },
  {
    group: "Collect",
    rows: [
      { label: "Comment pins, bug reports, annotation editor", cells: [true, true, true, true, true] },
      { label: "Console + network capture", cells: [true, true, true, true, true] },
      { label: "Session replay", cells: [true, false, "30 s", "120 s", true] },
    ],
  },
  {
    group: "Route",
    rows: [
      {
        label: "Email, Slack, Discord, Teams, Telegram, ntfy, webhooks",
        cells: [true, "Email + 1 chat", true, true, true],
      },
      { label: "GitHub, GitLab and Linear two-way sync", cells: [true, false, true, true, true] },
      { label: "Jira Cloud two-way sync", cells: [false, false, false, false, true] },
      { label: "MCP server + REST API", cells: [true, "API read-only", true, true, true] },
      {
        label: "Storage",
        cells: ["Disk or any S3", "Included", "Included", "Included", "Your bucket option"],
      },
    ],
  },
  {
    group: "Organisation",
    rows: [
      {
        label: "“Powered by Pinwren” removal / white-label",
        cells: [false, false, "Remove badge", "Full", true],
      },
      { label: "Audit log", cells: [false, false, false, "Planned", "Planned (+ SIEM stream)"] },
      { label: "SSO (SAML/OIDC), SCIM", cells: [false, false, false, false, "Planned"] },
      { label: "Support", cells: ["Community", "Community", "Email", "Priority email", "SLA"] },
    ],
  },
];

function Value({ v }: { v: Cell }) {
  if (v === true)
    return (
      <>
        <Check className="text-success mx-auto size-4" aria-hidden />
        <span className="sr-only">Included</span>
      </>
    );
  if (v === false)
    return (
      <>
        <Minus className="mx-auto size-4 text-muted-foreground/50" aria-hidden />
        <span className="sr-only">Not included</span>
      </>
    );
  return <span className="text-xs text-muted-foreground">{v}</span>;
}

export default function PricingPage() {
  return (
    <div className="pb-24">
      <section className="border-b py-16 text-center sm:py-20">
        <div className="container-page max-w-3xl">
          <p className="text-sm font-semibold text-brand">Pricing</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Free to self-host. Really.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-pretty text-muted-foreground">
            Everything a team needs to collect, triage and route feedback is free on your own server, at any
            scale. Paid plans will cover what an organisation needs to govern many teams — and, in Cloud, the
            cost of us running it.
          </p>
        </div>
      </section>

      <section className="container-page -mt-px pt-12">
        <PlanCards />
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Cloud and Enterprise prices are proposals and may change before launch. Prices in USD, excluding
          tax.
        </p>
      </section>

      <section className="container-page mt-20" aria-labelledby="compare-plans">
        <h2 id="compare-plans" className="text-center text-2xl font-semibold tracking-tight">
          Compare plans
        </h2>
        <div className="relative mt-8 overflow-x-auto rounded-2xl border bg-card shadow-xs">
          <table className="w-full min-w-[50rem] text-sm">
            <caption className="sr-only">What each Pinwren edition includes</caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className="w-72 px-4 py-3 text-left font-medium text-muted-foreground">
                  Feature
                </th>
                {COLUMNS.map((c, i) => (
                  <th
                    key={c}
                    scope="col"
                    className={cn("px-3 py-3 text-center font-semibold", i === 0 && "text-brand")}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            {MATRIX.map((g) => (
              <tbody key={g.group} className="divide-y border-b last:border-b-0">
                <tr className="bg-muted/40">
                  <th
                    scope="colgroup"
                    colSpan={COLUMNS.length + 1}
                    className="px-4 py-2 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                  >
                    {g.group}
                  </th>
                </tr>
                {g.rows.map((r) => (
                  <tr key={r.label}>
                    <th scope="row" className="px-4 py-2.5 text-left font-medium">
                      {r.label}
                    </th>
                    {r.cells.map((c, i) => (
                      <td
                        key={COLUMNS[i]}
                        className={cn("px-3 py-2.5 text-center", i === 0 && "bg-brand-soft/50")}
                      >
                        <Value v={c} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </section>

      <section className="container-page mt-20 grid gap-6 md:grid-cols-3">
        {[
          {
            t: "The trust rule",
            d: "A feature never moves from the free Community edition into a paid one. Movement only goes the other way.",
          },
          {
            t: "No phone-home",
            d: "Enterprise licence files are verified offline; air-gapped installs work. Telemetry is off unless you opt in.",
          },
          {
            t: "Clients are always free",
            d: "Guests who leave feedback never count as seats, on any plan.",
          },
        ].map((x) => (
          <div key={x.t} className="rounded-2xl border bg-card p-6 shadow-xs">
            <h3 className="font-semibold">{x.t}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{x.d}</p>
          </div>
        ))}
      </section>

      <section className="container-page mt-16 text-center">
        <p className="text-muted-foreground">
          Questions about licensing or a self-hosted Enterprise trial?{" "}
          <Link href="/docs/licensing" className="font-medium text-foreground underline underline-offset-4">
            Editions & licensing
          </Link>
        </p>
        <ButtonLink
          href="/docs/quickstart"
          size="lg"
          className="mt-6 h-10 bg-brand px-4 text-brand-foreground hover:bg-brand/90"
        >
          Start self-hosting
        </ButtonLink>
      </section>

      {/* Support section */}
      <section className="container-page mt-20 border-t py-12 text-center">
        <p className="mb-6 text-muted-foreground">
          Pinwren is free to self-host forever. If it saves you time, consider supporting the project:
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <a
            href={BUY_ME_COFFEE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-orange-500/30 bg-orange-500/10 px-4 py-2.5 text-sm font-medium text-orange-600 transition-colors hover:bg-orange-500/20 dark:text-orange-400"
            aria-label="Buy me a coffee"
          >
            <Heart className="size-4" aria-hidden />
            Buy me a coffee
          </a>
          <a
            href={GITHUB_SPONSORS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-purple-500/30 bg-purple-500/10 px-4 py-2.5 text-sm font-medium text-purple-600 transition-colors hover:bg-purple-500/20 dark:text-purple-400"
            aria-label="Sponsor on GitHub"
          >
            <Users className="size-4" aria-hidden />
            Sponsor us
          </a>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Coffee fuels late-night fixes. Sponsorships fund features, docs, and maintenance.
        </p>
      </section>
    </div>
  );
}
