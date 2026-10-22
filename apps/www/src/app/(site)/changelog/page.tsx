import { Markdown } from "fumadocs-core/content/md";
import { remarkGfm } from "fumadocs-core/mdx-plugins/remark-gfm";
import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import changelog from "@/generated/changelog.json";
import { GITHUB_RELEASES_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Changelog",
  description: "Every Pinwren release: new features, fixes and breaking changes.",
  alternates: { canonical: "/changelog" },
};

type Release = { version: string; date: string | null; link: string | null; body: string };

async function Releases() {
  "use cache";
  cacheLife("days");
  // Markdown → React once per release at build time; the page itself stays static.
  const releases = await Promise.all(
    (changelog.releases as Release[]).map(async (r) => ({
      ...r,
      content: await Markdown({ children: r.body, remarkPlugins: [remarkGfm] }),
    })),
  );
  return (
    <ol className="space-y-14">
      {releases.map((r) => (
        <li key={r.version} className="grid gap-4 md:grid-cols-[11rem_1fr]">
          <div className="md:sticky md:top-24 md:self-start">
            <h2 id={r.version.toLowerCase()} className="text-xl font-semibold tracking-tight">
              {r.version}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{r.date ?? "Not released yet"}</p>
            {r.link && (
              <a
                href={r.link}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                Commits
              </a>
            )}
          </div>
          <div className="prose dark:prose-invert prose-h3:mt-6 prose-h3:text-base first:prose-h3:mt-0 max-w-none rounded-2xl border bg-card p-6 shadow-xs">
            {r.content}
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function ChangelogPage() {
  return (
    <div className="container-page max-w-5xl py-16 sm:py-20">
      <header className="max-w-2xl">
        <p className="text-brand text-sm font-semibold">Changelog</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">What’s new in Pinwren</h1>
        <p className="mt-4 text-muted-foreground">
          Generated from <code className="font-mono text-sm">CHANGELOG.md</code>, which release-please keeps
          up to date from the commits on <code className="font-mono text-sm">main</code>. Binaries and images
          are on{" "}
          <a
            href={GITHUB_RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            GitHub Releases
          </a>
          .
        </p>
      </header>
      <div className="mt-14">
        <Releases />
      </div>
    </div>
  );
}
