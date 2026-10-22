import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";
import { source } from "@/lib/source";

const PAGES: { path: string; priority: number }[] = [
  { path: "/", priority: 1 },
  { path: "/demo", priority: 0.8 },
  { path: "/demo/inbox", priority: 0.5 },
  { path: "/pricing", priority: 0.8 },
  { path: "/changelog", priority: 0.6 },
  { path: "/legal/privacy", priority: 0.2 },
  { path: "/legal/terms", priority: 0.2 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const site = PAGES.map((p) => ({
    url: absoluteUrl(p.path),
    changeFrequency: "weekly" as const,
    priority: p.priority,
  }));
  const docs = source.getPages().map((page) => ({
    url: absoluteUrl(page.url),
    changeFrequency: "weekly" as const,
    priority: page.url === "/docs" || page.url === "/docs/quickstart" ? 0.9 : 0.7,
  }));
  return [...site, ...docs];
}
