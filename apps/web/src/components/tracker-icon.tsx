import type { IssueProvider } from "@pinwren/core";
import {
  CircleDot,
  Columns3,
  Hexagon,
  ListChecks,
  NotebookText,
  SquareCheckBig,
  SquareKanban,
  Zap,
} from "lucide-react";

export const TRACKER_NAMES: Record<IssueProvider, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  linear: "Linear",
  jira: "Jira",
  trello: "Trello",
  asana: "Asana",
  clickup: "ClickUp",
  notion: "Notion",
};

const ICONS = {
  github: CircleDot,
  gitlab: Hexagon,
  linear: Zap,
  jira: SquareKanban,
  trello: Columns3,
  asana: ListChecks,
  clickup: SquareCheckBig,
  notion: NotebookText,
} as const;

/** Neutral marks for the trackers (no brand logos bundled). */
export function TrackerIcon({ provider, className }: { provider: IssueProvider; className?: string }) {
  const Icon = ICONS[provider];
  return <Icon className={className} aria-hidden />;
}

/**
 * How an item is referred to: `#12` on GitHub / GitLab / Trello, the key (`ENG-12`, `WEB-7`) on Linear and Jira
 * (read from the URL when the link carries no key). Asana, ClickUp and Notion items have no number: they are
 * named after the tracker ("Asana task", "ClickUp task", "Notion page") by the caller, so this returns "".
 */
export function issueRef(l: { provider: string; number: number | null; url?: string | null; key?: unknown }) {
  if (l.provider !== "linear" && l.provider !== "jira") return l.number === null ? "" : `#${l.number}`;
  if (typeof l.key === "string" && l.key) return l.key;
  const m = /\/(?:issue|browse)\/([A-Za-z][A-Za-z0-9_]*-\d+)/.exec(l.url ?? "");
  return m?.[1] ?? (l.number === null ? "" : `#${l.number}`);
}

/** The tracker's name from an activity row's `provider` / `via`, for any provider. */
export const trackerName = (v: unknown): string | null =>
  typeof v === "string" && v in TRACKER_NAMES ? TRACKER_NAMES[v as IssueProvider] : null;
