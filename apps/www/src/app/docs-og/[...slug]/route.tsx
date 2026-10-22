import { notFound } from "next/navigation";
import { ogCard } from "@/lib/og/card";
import { source } from "@/lib/source";

// One social card per docs page, prerendered at build time: /docs-og/<slug…>/image.png.
export async function GET(_req: Request, ctx: RouteContext<"/docs-og/[...slug]">) {
  const { slug } = await ctx.params;
  const page = source.getPage(slug.slice(0, -1));
  if (!page) notFound();
  return ogCard({ eyebrow: "Docs", title: page.data.title, description: page.data.description });
}

export function generateStaticParams() {
  return source.getPages().map((p) => ({ slug: [...p.slugs, "image.png"] }));
}
