import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { PagesView } from "./pages-view";

export const metadata: Metadata = { title: "Pages" };

export default function PagesPage({ params }: PageProps<"/projects/[id]/pages">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PagesView params={params} />
    </Suspense>
  );
}
