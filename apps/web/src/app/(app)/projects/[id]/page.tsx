import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProjectDetail } from "@/lib/api";
import { serverApi } from "@/lib/server/api";
import { HydrateQueries } from "@/lib/store/hydrate";
import { ProjectSettings } from "./project-settings";

export const metadata: Metadata = { title: "Project settings" };

export default function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  return (
    <Suspense fallback={<SettingsSkeleton />}>
      <ProjectData params={params} />
    </Suspense>
  );
}

/** The project is fetched on the server and seeded into RTK Query; the tabs are client components. */
async function ProjectData({ params }: { params: PageProps<"/projects/[id]">["params"] }) {
  const { id } = await params;
  const project = await serverApi<{ project: ProjectDetail }>(`/projects/${id}`);
  return (
    <HydrateQueries
      key={id}
      entries={project.ok ? [{ endpointName: "project", arg: id, value: project.data }] : []}
    >
      <ProjectSettings id={id} />
    </HydrateQueries>
  );
}

function SettingsSkeleton() {
  return (
    <div aria-busy>
      <div className="flex h-12 items-center gap-2 border-b px-3">
        <Skeleton className="size-7" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="mx-auto w-full max-w-5xl space-y-4 p-4">
        <Skeleton className="h-8 w-96 max-w-full" />
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}
