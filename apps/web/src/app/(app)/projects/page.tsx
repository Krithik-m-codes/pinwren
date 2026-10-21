import type { Metadata } from "next";
import { Suspense } from "react";
import { ProjectsView } from "./projects-view";

// Signed-in screens render after the client confirms the session (ADR 0012), so there is no
// static shell for Next to validate instant navigation against.
export const instant = false;

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  return (
    <Suspense>
      <ProjectsView />
    </Suspense>
  );
}
