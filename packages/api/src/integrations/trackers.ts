import { safeFetch, type OutboundFetch } from "../outbound/safe-fetch";
import { adapterFor } from "./adapters";
import { gitlabBase } from "./adapters/gitlab";
import { githubBase } from "./adapters/github";
import { jiraBase } from "./adapters/jira";
import { LINEAR_API_URL } from "./adapters/linear";
import type { AccessResult, IssueRef, LinkTarget, NewIssue, TrackerConfig } from "./sdk/types";

// Issue sync entry points: GitHub (F-076), GitLab (F-077), Linear (F-078), Jira Cloud (F-079) and, since
// ADR 0029, Trello, Asana, ClickUp and Notion. Each tracker is an adapter in `adapters/` implementing the
// contract in `sdk/types.ts`; these functions pick the adapter by `cfg.provider` and add nothing of their own,
// so callers (jobs, routes, tests) never branch on the provider. Every request goes through `safeFetch`;
// only the instance's own GITHUB_API_URL / GITLAB_URL (operator settings) may point at a private address.

export { TrackerError } from "./sdk/types";
export type {
  AccessResult,
  InboundEvent,
  IssueRef,
  IssueSource,
  LinkTarget,
  NewIssue,
  TrackerAdapter,
  TrackerConfig,
  WebhookAdapter,
} from "./sdk/types";
export { adapterFor, ADAPTERS, PROVIDER_NAMES } from "./adapters";
export { adfText } from "./adapters/jira";
export { LINEAR_API_URL } from "./adapters/linear";
export { errorDetail } from "./sdk/http";
export { issueKey, keyNumber, mdEscape } from "./sdk/util";

/** REST base of a tracker with a configurable endpoint (kept for tests and diagnostics). */
export function apiBase(cfg: Pick<TrackerConfig, "provider" | "apiUrl">): string {
  if (cfg.provider === "github") return githubBase(cfg);
  if (cfg.provider === "linear") return LINEAR_API_URL;
  if (cfg.provider === "jira") return jiraBase(cfg);
  return gitlabBase(cfg);
}

/** Legacy callers pass the issue number; adapters take the whole link target. */
const targetOf = (t: number | LinkTarget): LinkTarget =>
  typeof t === "number" ? { number: t, externalId: null } : t;

export function createIssue(
  cfg: TrackerConfig,
  issue: NewIssue,
  fetchImpl: OutboundFetch = safeFetch,
): Promise<IssueRef> {
  return adapterFor(cfg.provider).createIssue(cfg, issue, fetchImpl);
}

/** An item a previous, interrupted create already made at the tracker, for adapters that can look. */
export async function findExistingIssue(
  cfg: TrackerConfig,
  issue: NewIssue,
  fetchImpl: OutboundFetch = safeFetch,
): Promise<IssueRef | null> {
  return (await adapterFor(cfg.provider).findExisting?.(cfg, issue, fetchImpl)) ?? null;
}

export function setIssueState(
  cfg: TrackerConfig,
  target: number | LinkTarget,
  state: "open" | "closed",
  fetchImpl: OutboundFetch = safeFetch,
): Promise<void> {
  return adapterFor(cfg.provider).setIssueState(cfg, targetOf(target), state, fetchImpl);
}

/** "Test connection": can this token see the repository / team / project / board / list / database? */
export function checkAccess(cfg: TrackerConfig, fetchImpl: OutboundFetch = safeFetch): Promise<AccessResult> {
  return adapterFor(cfg.provider).checkAccess(cfg, fetchImpl);
}
