import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { CodeSnippet } from "@/components/code-snippet";
import { HeroMockup } from "@/components/landing/hero-mockup";
import { GitHubIcon } from "@/components/site/github-icon";
import { GITHUB_URL, VERSION } from "@/lib/site";

const SNIPPET = `<script src="https://feedback.example.com/widget.js" data-project="pk_…" async></script>`;

const TRUST = ["Free to self-host", "One container + Postgres", "Widget is MIT", "No seat limits"];

/** Prices from blueprint 00 (vendor pages, October 2026): approximate, and they change. */
const REPLACES = [
  { name: "Marker.io", price: "~$39–199/mo" },
  { name: "BugHerd", price: "~$50–150/mo" },
  { name: "Userback", price: "~$7–23/seat" },
];

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b">
      <div className="bg-dots absolute inset-0 -z-10 [mask-image:radial-gradient(70%_60%_at_50%_0%,black,transparent)] opacity-60" />
      <div className="container-page grid items-center gap-14 pt-14 pb-24 lg:grid-cols-[1fr_1.05fr] lg:pt-20 lg:pb-28">
        <div className="max-w-xl min-w-0">
          <Link
            href="/docs/self-hosting"
            className="inline-flex items-center gap-2 rounded-full border bg-background/80 py-1 pr-3 pl-1 text-xs font-medium text-muted-foreground shadow-xs transition-colors hover:text-foreground"
          >
            <span className="rounded-full bg-brand px-2 py-0.5 text-brand-foreground">v{VERSION}</span>
            Open source · self-hosted
            <ArrowRight className="size-3" aria-hidden />
          </Link>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-[3.4rem] lg:leading-[1.05]">
            Point at the page. <span className="text-brand">Fix what’s wrong.</span>
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-pretty text-muted-foreground">
            One script tag adds a widget to any website. Clients pin Figma-style comments on any element or
            drag over a region; testers send annotated screenshots with console errors and failed requests. It
            all lands in a fast triage inbox you run yourself.
          </p>
          <CodeSnippet code={SNIPPET} wrap label="Copy the script tag" className="mt-7" />
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <ButtonLink
              href="/docs/quickstart"
              size="lg"
              className="h-10 bg-brand px-4 text-brand-foreground hover:bg-brand/90"
            >
              Self-host in 5 minutes
              <ArrowRight aria-hidden />
            </ButtonLink>
            <ButtonLink href="/demo" variant="outline" size="lg" className="h-10 px-4">
              Try the live demo
            </ButtonLink>
            <ButtonLink href={GITHUB_URL} external variant="ghost" size="lg" className="h-10 px-3">
              <GitHubIcon className="size-4" />
              GitHub
            </ButtonLink>
          </div>
          <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            {TRUST.map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <Check className="text-success size-3.5" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0 pb-6 lg:pl-8">
          <HeroMockup />
        </div>
      </div>
      <div className="container-page -mt-4 pb-12">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-x-6 gap-y-2 rounded-2xl border bg-card/70 px-5 py-3.5 text-sm shadow-xs">
          <span className="font-medium">Replaces</span>
          {REPLACES.map((r) => (
            <span key={r.name} className="whitespace-nowrap text-muted-foreground">
              <span className="font-medium text-foreground">{r.name}</span>{" "}
              <span className="line-through decoration-muted-foreground/60">{r.price}</span>
            </span>
          ))}
          <a
            href="#compare"
            className="text-xs whitespace-nowrap text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Approximate list prices, Oct 2026
          </a>
        </div>
      </div>
    </section>
  );
}
