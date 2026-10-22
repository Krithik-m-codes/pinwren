import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { ProjectsView } from "./projects-view";

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ProjectsView />
    </Suspense>
  );
}
