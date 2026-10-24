import type { Route } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/button-link";
import { Logo } from "@/components/logo";
import { GitHubIcon } from "@/components/site/github-icon";
import { MobileNav } from "@/components/site/mobile-nav";
import { SearchButton } from "@/components/site/search-button";
import { ThemeToggle } from "@/components/site/theme-toggle";
import { GITHUB_URL } from "@/lib/site";

export const NAV = [
  { label: "Features", href: "/#features" },
  { label: "Compare", href: "/#compare" },
  { label: "Docs", href: "/docs" },
  { label: "Pricing", href: "/pricing" },
  { label: "Changelog", href: "/changelog" },
] as const;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-lg supports-backdrop-filter:bg-background/65">
      <div className="container-page flex h-14 items-center gap-6">
        <Link
          href="/"
          aria-label="Pinwren home"
          className="rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Logo />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href as Route}
              className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <SearchButton className="hidden lg:inline-flex" />
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Pinwren on GitHub"
            className="hidden size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:grid"
          >
            <GitHubIcon className="size-4" />
          </a>
          <ThemeToggle />
          <ButtonLink
            href="/demo"
            size="sm"
            className="ml-1 hidden bg-brand text-brand-foreground hover:bg-brand/90 sm:inline-flex"
          >
            Try the demo
          </ButtonLink>
          <MobileNav />
        </div>
      </div>
    </header>
  );
}
