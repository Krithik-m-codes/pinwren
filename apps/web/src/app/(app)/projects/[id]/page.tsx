import type { Metadata } from "next";
import { Suspense } from "react";
import { ProjectSettings } from "./project-settings";

export const metadata: Metadata = { title: "Project" };

export default function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  return (
    <Suspense>
      <ProjectSettings params={params} />
    </Suspense>
  );
}
