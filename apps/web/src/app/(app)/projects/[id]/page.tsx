import type { Metadata } from "next";
import { Suspense } from "react";
import { ProjectSettings } from "./project-settings";

// Signed-in screens render after the client confirms the session (ADR 0012), so there is no
// static shell for Next to validate instant navigation against.
export const instant = false;

export const metadata: Metadata = { title: "Project settings" };

export default function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  return (
    <Suspense>
      <ProjectSettings params={params} />
    </Suspense>
  );
}
