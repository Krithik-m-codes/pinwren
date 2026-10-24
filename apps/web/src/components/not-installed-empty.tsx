"use client";

import { Plug } from "lucide-react";
import type { Route } from "next";
import { useSearchParams } from "next/navigation";
import { ButtonLink } from "@/components/button-link";
import { EmptyState } from "@/components/states";
import { useProjectsQuery } from "@/lib/store/api";

/**
 * The inbox's empty state when the widget has never loaded (wave-5 §3.5): "Inbox zero" would be wrong for
 * a site that can't send anything yet. Looks at the project in the `project` filter, or every project;
 * when one of them has been seen, `children` (the usual empty state) shows instead.
 */
export function NotInstalledEmpty({ children }: { children: React.ReactNode }) {
  const projects = useProjectsQuery(undefined).data?.projects ?? [];
  const filter = useSearchParams().get("project");
  const scope = filter ? projects.filter((p) => p.id === filter) : projects;
  if (!scope.length || scope.some((p) => p.lastSeenAt)) return children;
  const first = scope[0];
  if (!first) return children;
  return (
    <EmptyState
      icon={Plug}
      title={scope.length === 1 ? `Install the widget on ${first.name}` : "Install the widget on your site"}
      description="Nothing can arrive until the widget is on your site. Paste one snippet, then send a test report from the page."
      action={
        <ButtonLink href={`/projects/${first.id}?tab=install` as Route} size="sm" data-testid="install-cta">
          Open the Install tab
        </ButtonLink>
      }
    />
  );
}
