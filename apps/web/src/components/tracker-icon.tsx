import type { IssueProvider } from "@annota/core";
import { CircleDot, Hexagon } from "lucide-react";

export const TRACKER_NAMES: Record<IssueProvider, string> = { github: "GitHub", gitlab: "GitLab" };

/** Neutral marks for the two trackers (no brand logos bundled). */
export function TrackerIcon({ provider, className }: { provider: IssueProvider; className?: string }) {
  const Icon = provider === "github" ? CircleDot : Hexagon;
  return <Icon className={className} aria-hidden />;
}
