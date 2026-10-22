"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { ButtonLink } from "@/components/button-link";
import { GITHUB_DISCUSSIONS_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

type Plan = {
  name: string;
  monthly: string;
  annual: string;
  unit: string;
  blurb: string;
  features: string[];
  cta:
    | { label: string; href: "/docs/quickstart" | "/docs/licensing" }
    | { label: string; external: string }
    | null;
  soon: boolean;
  primary?: boolean;
};

// Blueprint 07 §3 — proposals until validated with customers; Cloud is not live yet.
const PLANS: Plan[] = [
  {
    name: "Community",
    monthly: "$0",
    annual: "$0",
    unit: "self-hosted, forever",
    blurb: "Everything a team needs, on your own server.",
    features: [
      "Unlimited projects, seats and reports",
      "Comments, bug reports, replay",
      "Email, Slack, Discord, webhooks",
      "GitHub & GitLab two-way sync",
      "REST API, MCP server, CLI",
      "Disk or any S3 storage",
    ],
    cta: { label: "Self-host now", href: "/docs/quickstart" },
    soon: false,
    primary: true,
  },
  {
    name: "Cloud Pro",
    monthly: "$29",
    annual: "$24",
    unit: "per month",
    blurb: "Hosted for small teams and agencies.",
    features: [
      "10 seats (+$6/seat)",
      "10 projects",
      "2,000 reports / month",
      "30 s replay",
      "Remove the badge",
    ],
    cta: null,
    soon: true,
  },
  {
    name: "Cloud Business",
    monthly: "$99",
    annual: "$79",
    unit: "per month",
    blurb: "For product and QA teams at scale.",
    features: [
      "30 seats (+$5/seat)",
      "Unlimited projects",
      "20,000 reports / month",
      "120 s replay",
      "Full white-label, audit log",
    ],
    cta: null,
    soon: true,
  },
  {
    name: "Enterprise",
    monthly: "From $4,000",
    annual: "From $4,000",
    unit: "per year, self-host",
    blurb: "SSO, SCIM, audit and support for regulated orgs.",
    features: [
      "SAML/OIDC SSO, SCIM",
      "Custom roles",
      "Audit log + SIEM stream",
      "Offline licence file",
      "SLA support",
    ],
    cta: { label: "Talk to us", external: GITHUB_DISCUSSIONS_URL },
    soon: true,
  },
];

export function PlanCards() {
  const [annual, setAnnual] = useState(false);
  return (
    <div>
      <div className="flex justify-center">
        <div
          role="radiogroup"
          aria-label="Billing period"
          className="inline-flex rounded-lg border bg-muted p-1 text-sm"
        >
          {[
            { v: false, l: "Monthly" },
            { v: true, l: "Annual" },
          ].map((o) => (
            <button
              key={o.l}
              type="button"
              role="radio"
              aria-checked={annual === o.v}
              onClick={() => setAnnual(o.v)}
              className={cn(
                "rounded-md px-3 py-1 font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                annual === o.v
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.l}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((p) => (
          <article
            key={p.name}
            className={cn(
              "relative flex flex-col rounded-2xl border bg-card p-6 shadow-xs",
              p.primary && "border-brand/50 shadow-brand/10 ring-brand/30 shadow-lg ring-1",
            )}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="text-lg font-semibold whitespace-nowrap">{p.name}</h2>
              {p.soon ? (
                <span className="rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-muted-foreground">
                  {p.name === "Enterprise" ? "Coming soon" : "Cloud coming soon"}
                </span>
              ) : (
                <span className="bg-brand text-brand-foreground rounded-full px-2 py-0.5 text-[11px] font-medium">
                  Available
                </span>
              )}
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">{p.blurb}</p>
            <p className="mt-5 flex flex-wrap items-baseline gap-x-1.5">
              <span
                className={cn(
                  "font-semibold tracking-tight whitespace-nowrap",
                  p.monthly.length > 6 ? "text-2xl" : "text-3xl",
                )}
              >
                {annual ? p.annual : p.monthly}
              </span>
              <span className="text-sm text-muted-foreground">{p.unit}</span>
            </p>
            {annual && p.soon && p.name.startsWith("Cloud") && (
              <p className="text-xs text-muted-foreground">billed annually</p>
            )}
            <ul className="mt-5 flex-1 space-y-2 text-sm">
              {p.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="text-success mt-0.5 size-4 shrink-0" aria-hidden />
                  {f}
                </li>
              ))}
            </ul>
            <div className="mt-6">
              {p.cta && "href" in p.cta ? (
                <ButtonLink
                  href={p.cta.href}
                  className="bg-brand text-brand-foreground hover:bg-brand/90 h-9 w-full"
                >
                  {p.cta.label}
                </ButtonLink>
              ) : p.cta ? (
                <ButtonLink href={p.cta.external} external variant="outline" className="h-9 w-full">
                  {p.cta.label}
                </ButtonLink>
              ) : (
                <span className="flex h-9 w-full items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                  Coming soon
                </span>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
