import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import type { ProjectDetail, ReviewRound } from "@/lib/api";
import { serverApi } from "@/lib/server/api";
import { HydrateQueries } from "@/lib/store/hydrate";
import { RoundsView } from "./rounds-view";

export const metadata: Metadata = { title: "Review rounds" };

export default function RoundsPage({ params }: PageProps<"/projects/[id]/rounds">) {
  return (
    <Suspense fallback={<PageSkeleton narrow />}>
      <RoundsData params={params} />
    </Suspense>
  );
}

/** Project and rounds are fetched on the server and seeded into RTK Query. */
async function RoundsData({ params }: { params: PageProps<"/projects/[id]/rounds">["params"] }) {
  const { id } = await params;
  const [project, rounds] = await Promise.all([
    serverApi<{ project: ProjectDetail }>(`/projects/${id}`),
    serverApi<{ rounds: ReviewRound[] }>(`/projects/${id}/rounds`),
  ]);
  return (
    <HydrateQueries
      key={id}
      entries={[
        ...(project.ok ? [{ endpointName: "project" as const, arg: id, value: project.data }] : []),
        ...(rounds.ok ? [{ endpointName: "rounds" as const, arg: id, value: rounds.data }] : []),
      ]}
    >
      <RoundsView projectId={id} />
    </HydrateQueries>
  );
}
