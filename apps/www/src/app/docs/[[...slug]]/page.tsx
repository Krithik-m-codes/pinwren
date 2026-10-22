import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  EditOnGitHub,
} from "@fumadocs/base-ui/layouts/docs/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getMDXComponents } from "@/components/mdx";
import { absoluteUrl, githubBlob, SITE_NAME } from "@/lib/site";
import { source } from "@/lib/source";

type Params = PageProps<"/docs/[[...slug]]">["params"];

// The URL is read inside a Suspense boundary so every docs URL shares one App Shell (instant client
// navigation); each page is still prerendered in full at build time through generateStaticParams.
export default function Page({ params }: PageProps<"/docs/[[...slug]]">) {
  return (
    <Suspense fallback={<DocsSkeleton />}>
      <DocsContent params={params} />
    </Suspense>
  );
}

async function DocsContent({ params }: { params: Params }) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();
  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full ?? false} tableOfContent={{ style: "clerk" }}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
      <EditOnGitHub href={githubBlob(`apps/www/content/docs/${page.path}`)} />
    </DocsPage>
  );
}

function DocsSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-10 md:px-6" aria-busy="true">
      <div className="h-9 w-2/3 animate-pulse rounded-lg bg-muted" />
      <div className="h-5 w-1/2 animate-pulse rounded bg-muted" />
      <div className="mt-8 h-64 animate-pulse rounded-xl bg-muted/70" />
    </div>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata({ params }: PageProps<"/docs/[[...slug]]">): Promise<Metadata> {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();
  const { title, description } = page.data;
  const image = `/docs-og/${[...(slug ?? []), "image.png"].join("/")}`;
  return {
    title,
    description,
    alternates: { canonical: page.url },
    openGraph: {
      type: "article",
      siteName: SITE_NAME,
      title,
      ...(description ? { description } : {}),
      url: absoluteUrl(page.url),
      images: [image],
    },
    twitter: { card: "summary_large_image", title, ...(description ? { description } : {}), images: [image] },
  };
}
