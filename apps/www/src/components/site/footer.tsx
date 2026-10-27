import type { Route } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { FooterSupport } from "@/components/site/support-buttons";
import {
  GITHUB_DISCUSSIONS_URL,
  GITHUB_ISSUES_URL,
  GITHUB_URL,
  githubBlob,
  npmUrl,
  VERSION,
} from "@/lib/site";

type FooterLink = { label: string; href: string; external?: boolean };

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/#features" },
      { label: "Live demo", href: "/demo" },
      { label: "Demo inbox", href: "/demo/inbox" },
      { label: "Pricing", href: "/pricing" },
      { label: "Changelog", href: "/changelog" },
    ],
  },
  {
    title: "Docs",
    links: [
      { label: "Quickstart", href: "/docs/quickstart" },
      { label: "Self-hosting", href: "/docs/self-hosting" },
      { label: "Widget", href: "/docs/widget" },
      { label: "Integrations", href: "/docs/integrations" },
      { label: "API & MCP", href: "/docs/api" },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "GitHub", href: GITHUB_URL, external: true },
      { label: "Discussions", href: GITHUB_DISCUSSIONS_URL, external: true },
      { label: "Report an issue", href: GITHUB_ISSUES_URL, external: true },
      { label: "npm: @pinwren/widget", href: npmUrl("@pinwren/widget"), external: true },
      { label: "Security", href: "/docs/security" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Editions & licensing", href: "/docs/licensing" },
      { label: "Privacy", href: "/legal/privacy" },
      { label: "Terms", href: "/legal/terms" },
      { label: "AGPL-3.0 licence", href: githubBlob("LICENSE"), external: true },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t bg-muted/30">
      <div className="container-page grid gap-10 py-14 md:grid-cols-[1.3fr_repeat(5,1fr)]">
        <div className="space-y-3">
          <Logo />
          <p className="max-w-xs text-sm text-muted-foreground">
            Pinned feedback and annotated bug reports for any website. Open source and free to self-host.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <nav key={col.title} aria-label={col.title} className="space-y-3">
            <h2 className="text-sm font-semibold">{col.title}</h2>
            <ul className="space-y-2 text-sm">
              {col.links.map((l) => (
                <li key={l.label}>
                  {l.external ? (
                    <a
                      href={l.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {l.label}
                    </a>
                  ) : (
                    <Link
                      href={l.href as Route}
                      className="text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {l.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
        <FooterSupport />
      </div>
      <div className="border-t">
        <div className="container-page flex flex-col gap-2 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 Pinwren contributors · v{VERSION}</p>
          <p>Server and dashboard AGPL-3.0 · widget, SDK and tools MIT</p>
        </div>
        <div className="container-page flex flex-wrap items-center gap-4 pb-5">
          <a href="https://toolindex.net/?ref=badge" target="_blank" rel="nofollow noopener">
            {/* eslint-disable-next-line @next/next/no-img-element -- the badge markup is supplied as-is by Tool Index */}
            <img
              src="https://toolindex.net/badges/listed-on-toolindex.svg"
              alt="Listed on Tool Index"
              width="200"
              height="54"
            />
          </a>
          <a
            href={
              "https://www.producthunt.com/products/pinwren?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-pinwren"
            }
            target="_blank"
            rel="noopener noreferrer"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- the badge markup is supplied as-is by Product Hunt */}
            <img
              alt="Pinwren - Pinwren is a self-hostable visual feedback tool | Product Hunt"
              width="250"
              height="54"
              src={
                "https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1294130&theme=light&t=1793078291449"
              }
            />
          </a>
        </div>
      </div>
    </footer>
  );
}
