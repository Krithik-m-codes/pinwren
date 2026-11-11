import type { OutboundFetch } from "../../outbound/safe-fetch";
import { trackerClient } from "../sdk/http";
import { type AccessResult, type TrackerAdapter, type TrackerConfig, TrackerError } from "../sdk/types";
import { issueKey, keyNumber } from "../sdk/util";

// Jira Cloud (F-079), REST v3 with `email:apiToken` Basic auth (ADR 0015). An Enterprise feature (`jira` licence).

/** The Jira site's origin (`https://acme.atlassian.net`). */
export function jiraSite(cfg: Pick<TrackerConfig, "apiUrl">): string {
  try {
    return new URL(cfg.apiUrl ?? "").origin;
  } catch {
    throw new TrackerError("Jira needs the site URL, like https://acme.atlassian.net", null);
  }
}

export const jiraBase = (cfg: Pick<TrackerConfig, "apiUrl">) => `${jiraSite(cfg)}/rest/api/3`;

const call = trackerClient({
  name: "Jira",
  base: jiraBase,
  headers: (cfg) => ({
    "content-type": "application/json",
    accept: "application/json",
    authorization: `Basic ${Buffer.from(`${cfg.email ?? ""}:${cfg.token}`).toString("base64")}`,
  }),
  hint: (_cfg, status) =>
    status === 401
      ? " (check the token)"
      : status === 403
        ? " (check the account's project permissions)"
        : status === 404
          ? " (check the site URL, the project key and the account's access)"
          : "",
});

type JiraIssueType = { id: string; name: string; subtask?: boolean };
type JiraTransition = { id: string; to?: { statusCategory?: { key?: string } } };

/** The project's Bug type for bugs, else Task, else its first standard type. */
async function jiraIssueType(cfg: TrackerConfig, kind: string | undefined, fetchImpl: OutboundFetch) {
  const r = await call<{ issueTypes?: JiraIssueType[]; values?: JiraIssueType[] }>(
    cfg,
    "GET",
    `/issue/createmeta/${encodeURIComponent(cfg.repo)}/issuetypes`,
    undefined,
    fetchImpl,
  );
  const types = (r.issueTypes ?? r.values ?? []).filter((t) => !t.subtask);
  const byName = (n: string) => types.find((t) => t.name.toLowerCase() === n);
  const pick = (kind === "bug" ? byName("bug") : undefined) ?? byName("task") ?? types[0];
  if (!pick)
    throw new TrackerError(`Jira project ${cfg.repo} has no issue type this account can create`, null);
  return pick.id;
}

/** Plain text as an ADF document: one paragraph per line, never interpreted as markup. */
export function adfText(text: string): object {
  return {
    type: "doc",
    version: 1,
    content: text.split(/\r?\n/).map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : [],
    })),
  };
}

export const jira: TrackerAdapter = {
  provider: "jira",
  name: "Jira",
  async createIssue(cfg, issue, f) {
    const issuetype = await jiraIssueType(cfg, issue.kind, f);
    const r = await call<{ key?: unknown }>(
      cfg,
      "POST",
      "/issue",
      {
        fields: {
          project: { key: cfg.repo },
          issuetype: { id: issuetype },
          summary: issue.title,
          description: issue.adf ?? adfText(issue.body),
          // Jira labels can't contain spaces.
          ...(issue.labels.length ? { labels: issue.labels.map((l) => l.replace(/\s+/g, "-")) } : {}),
        },
      },
      f,
    );
    const number = keyNumber(r.key);
    if (number === null || typeof r.key !== "string")
      throw new TrackerError("Jira did not return an issue", null);
    return { number, key: r.key, url: `${jiraSite(cfg)}/browse/${encodeURIComponent(r.key)}` };
  },
  async setIssueState(cfg, target, state, f) {
    if (target.number === null) throw new TrackerError("Jira issue number missing", null);
    // Take the workflow's transition into the "done" category (closed) or "to do" / "in progress" (open).
    const key = encodeURIComponent(issueKey(cfg, target.number));
    const r = await call<{ transitions?: JiraTransition[] }>(
      cfg,
      "GET",
      `/issue/${key}/transitions`,
      undefined,
      f,
    );
    const into = (cat: string) => (r.transitions ?? []).find((t) => t.to?.statusCategory?.key === cat);
    const pick = state === "closed" ? into("done") : (into("new") ?? into("indeterminate"));
    if (!pick) {
      throw new TrackerError(
        `No Jira transition ${state === "closed" ? "to a Done status" : "back to an open status"} from the issue's status`,
        null,
      );
    }
    await call(cfg, "POST", `/issue/${key}/transitions`, { transition: { id: pick.id } }, f);
  },
  async checkAccess(cfg, f): Promise<AccessResult> {
    try {
      const r = await call<{ name?: unknown }>(
        cfg,
        "GET",
        `/project/${encodeURIComponent(cfg.repo)}`,
        undefined,
        f,
      );
      return { ok: true, name: typeof r.name === "string" ? `${r.name} (${cfg.repo})` : cfg.repo };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "failed" };
    }
  },
};
