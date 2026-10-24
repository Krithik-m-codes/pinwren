import { type IssueProvider, trimTrailingSlashes } from "@pinwren/core";
import { env } from "../env";
import { type OutboundFetch, outboundErrorText, safeFetch } from "../outbound/safe-fetch";

// REST/GraphQL clients for issue sync: GitHub (F-076), GitLab (F-077), Linear (F-078) and Jira Cloud (F-079).
// Authenticated with an access token / API key, so a self-hosted instance needs no OAuth app or GitHub App
// (ADR 0015). Every request goes through `safeFetch`; only the instance's own GITHUB_API_URL / GITLAB_URL
// (operator settings) may point at a private address.

export type TrackerConfig = {
  provider: IssueProvider;
  /** GitHub/GitLab token, Linear API key, Jira API token. */
  token: string;
  /** GitHub `owner/name`, GitLab project path, Linear team key, Jira project key. */
  repo: string;
  /** GitHub Enterprise / self-managed GitLab base URL, or the Jira site URL. */
  apiUrl: string | null;
  /** Jira: the Atlassian account the API token belongs to. */
  email?: string | null;
};

/** `key` is the tracker's own reference when it isn't `#number` (Linear `ENG-12`, Jira `WEB-7`). */
export type IssueRef = { number: number; url: string; key?: string };

export type NewIssue = {
  title: string;
  /** Markdown (GitHub, GitLab, Linear) or plain text. Jira uses `adf` when given. */
  body: string;
  labels: string[];
  /** The feedback kind: Jira picks the Bug issue type for bugs. */
  kind?: string;
  /** Jira: the description as an Atlassian Document Format document. */
  adf?: object;
};

export class TrackerError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

export const PROVIDER_NAMES: Record<IssueProvider, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  linear: "Linear",
  jira: "Jira",
};

const TIMEOUT_MS = 15_000;
export const LINEAR_API_URL = "https://api.linear.app/graphql";

/** The Jira site's origin (`https://acme.atlassian.net`). */
function jiraSite(cfg: Pick<TrackerConfig, "apiUrl">): string {
  try {
    return new URL(cfg.apiUrl ?? "").origin;
  } catch {
    throw new TrackerError("Jira needs the site URL, like https://acme.atlassian.net", null);
  }
}

/** REST base: GitHub's API root, GitLab's `/api/v4` under the instance URL, or the Jira site's REST v3. */
export function apiBase(cfg: Pick<TrackerConfig, "provider" | "apiUrl">): string {
  const e = env();
  if (cfg.provider === "github") return trimTrailingSlashes(cfg.apiUrl ?? e.GITHUB_API_URL);
  if (cfg.provider === "linear") return LINEAR_API_URL;
  if (cfg.provider === "jira") return `${jiraSite(cfg)}/rest/api/3`;
  const root = trimTrailingSlashes(cfg.apiUrl ?? e.GITLAB_URL).replace(/\/api\/v4$/, "");
  return `${root}/api/v4`;
}

function headers(cfg: TrackerConfig): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    "user-agent": `Pinwren/${env().PINWREN_VERSION}`,
  };
  if (cfg.provider === "github") {
    h.authorization = `Bearer ${cfg.token}`;
    h.accept = "application/vnd.github+json";
    h["x-github-api-version"] = "2022-11-28";
  } else if (cfg.provider === "gitlab") {
    h["private-token"] = cfg.token;
  } else if (cfg.provider === "linear") {
    // Personal API keys go bare (OAuth tokens would be `Bearer …`; not used, ADR 0015).
    h.authorization = cfg.token;
  } else {
    h.authorization = `Basic ${Buffer.from(`${cfg.email ?? ""}:${cfg.token}`).toString("base64")}`;
  }
  return h;
}

const repoPath = (cfg: TrackerConfig) =>
  cfg.provider === "github"
    ? `/repos/${cfg.repo.split("/").map(encodeURIComponent).join("/")}`
    : `/projects/${encodeURIComponent(cfg.repo)}`;

/**
 * The tracker's own error message, from its JSON error fields only. A raw response body is never echoed: a
 * base URL pointed at some other service must not read that service back.
 */
export function errorDetail(text: string): string {
  let j: Record<string, unknown>;
  try {
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return "";
    j = v as Record<string, unknown>;
  } catch {
    return "";
  }
  // Jira: { errorMessages: [...], errors: { field: message } }.
  const fieldErrors =
    j.errors && typeof j.errors === "object" && !Array.isArray(j.errors)
      ? Object.entries(j.errors as Record<string, unknown>).map(([k, v]) => `${k}: ${String(v)}`)
      : [];
  const messages: unknown[] = Array.isArray(j.errorMessages) ? j.errorMessages : [];
  const jira = [...messages, ...fieldErrors].filter(
    (m): m is string => typeof m === "string" && m.length > 0,
  );
  if (jira.length) return jira.join("; ").slice(0, 200);
  // Linear (GraphQL): { errors: [{ message, extensions: { userPresentableMessage } }] }.
  if (Array.isArray(j.errors) && j.errors.length) {
    const first = j.errors[0] as { message?: unknown; extensions?: { userPresentableMessage?: unknown } };
    const m = first.extensions?.userPresentableMessage ?? first.message;
    if (typeof m === "string") return m.slice(0, 200);
  }
  const m = j.message ?? j.error;
  // GitLab sometimes answers with a structured message ({ "name": ["has already been taken"] }).
  if (m !== undefined && m !== null) return (typeof m === "string" ? m : JSON.stringify(m)).slice(0, 200);
  return "";
}

function hintFor(provider: IssueProvider, status: number): string {
  if (status === 401) return provider === "linear" ? " (check the API key)" : " (check the token)";
  if (status === 403 && provider === "jira") return " (check the account's project permissions)";
  if (status === 404) {
    return provider === "jira"
      ? " (check the site URL, the project key and the account's access)"
      : " (check the repository and the token's access)";
  }
  return "";
}

async function call<T>(
  cfg: TrackerConfig,
  method: string,
  path: string,
  body: unknown,
  fetchImpl: OutboundFetch,
): Promise<T> {
  let res: Response;
  const url = `${apiBase(cfg)}${path}`;
  try {
    // A per-integration base URL is user input and goes through the outbound guard; the instance's own
    // GITHUB_API_URL / GITLAB_URL are operator settings and may be private.
    res = await fetchImpl(url, {
      method,
      headers: headers(cfg),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      timeoutMs: TIMEOUT_MS,
      maxBytes: 2 * 1024 * 1024,
      trusted: (cfg.provider === "github" || cfg.provider === "gitlab") && cfg.apiUrl === null,
    });
  } catch (err) {
    throw new TrackerError(
      `Could not reach ${PROVIDER_NAMES[cfg.provider]}: ${outboundErrorText(err)}`,
      null,
    );
  }
  if (res.status >= 300 && res.status < 400) {
    throw new TrackerError(`${res.status} redirect — use the API's final URL`, res.status);
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new TrackerError(
      `${res.status} ${errorDetail(text)}${hintFor(cfg.provider, res.status)}`.trim(),
      res.status,
    );
  }
  // Jira answers some writes (transitions) with 204 and no body.
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new TrackerError("Unexpected response from the tracker", res.status);
  }
}

// --- Linear (GraphQL) -------------------------------------------------------------------------------

type LinearState = { id: string; type: string; position: number };

/** One GraphQL request. Linear reports most failures as HTTP 200 with `errors`. */
async function linear<T>(
  cfg: TrackerConfig,
  query: string,
  variables: object,
  fetchImpl: OutboundFetch,
): Promise<T> {
  const r = await call<{ data?: T | null; errors?: unknown }>(
    cfg,
    "POST",
    "",
    { query, variables },
    fetchImpl,
  );
  if (r.errors !== undefined || !r.data) {
    const detail = errorDetail(JSON.stringify({ errors: r.errors ?? [] }));
    throw new TrackerError(detail || "Linear refused the request", null);
  }
  return r.data;
}

async function linearTeam(cfg: TrackerConfig, fetchImpl: OutboundFetch) {
  const d = await linear<{ teams: { nodes: { id: string; key: string; name: string }[] } }>(
    cfg,
    "query($key: String!) { teams(filter: { key: { eqIgnoreCase: $key } }) { nodes { id key name } } }",
    { key: cfg.repo },
    fetchImpl,
  );
  const team = d.teams.nodes[0];
  if (!team) {
    throw new TrackerError(
      `No Linear team with the key ${cfg.repo} (check the key and the API key's access)`,
      404,
    );
  }
  return team;
}

/** Linear labels are ids: existing workspace or team labels with these names are used, others skipped. */
async function linearLabelIds(
  cfg: TrackerConfig,
  teamId: string,
  names: string[],
  fetchImpl: OutboundFetch,
): Promise<string[]> {
  if (!names.length) return [];
  const d = await linear<{
    issueLabels: { nodes: { id: string; name: string; team: { id: string } | null }[] };
  }>(
    cfg,
    "query($names: [String!]) { issueLabels(filter: { name: { in: $names } }) { nodes { id name team { id } } } }",
    { names },
    fetchImpl,
  );
  return d.issueLabels.nodes.filter((l) => !l.team || l.team.id === teamId).map((l) => l.id);
}

/** `ENG-12` → 12. */
export function keyNumber(key: unknown): number | null {
  if (typeof key !== "string") return null;
  const m = /^[A-Za-z][A-Za-z0-9_]*-(\d+)$/.exec(key);
  return m?.[1] ? Number(m[1]) : null;
}

/** A Linear / Jira issue's key from the team / project key and its number. */
export const issueKey = (cfg: Pick<TrackerConfig, "repo">, number: number) => `${cfg.repo}-${number}`;

// --- Jira Cloud (REST v3) ---------------------------------------------------------------------------

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

// --- Operations ---------------------------------------------------------------------------------------

export async function createIssue(
  cfg: TrackerConfig,
  issue: NewIssue,
  fetchImpl: OutboundFetch = safeFetch,
): Promise<IssueRef> {
  if (cfg.provider === "github") {
    const r = await call<{ number?: unknown; html_url?: unknown }>(
      cfg,
      "POST",
      `${repoPath(cfg)}/issues`,
      { title: issue.title, body: issue.body, ...(issue.labels.length ? { labels: issue.labels } : {}) },
      fetchImpl,
    );
    return refFrom(r.number, r.html_url);
  }
  if (cfg.provider === "gitlab") {
    const r = await call<{ iid?: unknown; web_url?: unknown }>(
      cfg,
      "POST",
      `${repoPath(cfg)}/issues`,
      {
        title: issue.title,
        description: issue.body,
        ...(issue.labels.length ? { labels: issue.labels.join(",") } : {}),
      },
      fetchImpl,
    );
    return refFrom(r.iid, r.web_url);
  }
  if (cfg.provider === "linear") {
    const team = await linearTeam(cfg, fetchImpl);
    const labelIds = await linearLabelIds(cfg, team.id, issue.labels, fetchImpl);
    const d = await linear<{
      issueCreate: {
        success: boolean;
        issue: { identifier?: unknown; number?: unknown; url?: unknown } | null;
      };
    }>(
      cfg,
      "mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier number url } } }",
      {
        input: {
          teamId: team.id,
          title: issue.title,
          description: issue.body,
          ...(labelIds.length ? { labelIds } : {}),
        },
      },
      fetchImpl,
    );
    const i = d.issueCreate.issue;
    if (!d.issueCreate.success || !i) throw new TrackerError("Linear did not create the issue", null);
    return {
      ...refFrom(i.number, i.url),
      ...(typeof i.identifier === "string" ? { key: i.identifier } : {}),
    };
  }
  const issuetype = await jiraIssueType(cfg, issue.kind, fetchImpl);
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
    fetchImpl,
  );
  const number = keyNumber(r.key);
  if (number === null || typeof r.key !== "string")
    throw new TrackerError("Jira did not return an issue", null);
  return { number, key: r.key, url: `${jiraSite(cfg)}/browse/${encodeURIComponent(r.key)}` };
}

function refFrom(n: unknown, url: unknown): IssueRef {
  const number = Number(n);
  if (!Number.isInteger(number) || number <= 0 || typeof url !== "string" || !/^https?:\/\//.test(url)) {
    throw new TrackerError("The tracker did not return an issue", null);
  }
  return { number, url };
}

export async function setIssueState(
  cfg: TrackerConfig,
  number: number,
  state: "open" | "closed",
  fetchImpl: OutboundFetch = safeFetch,
): Promise<void> {
  if (cfg.provider === "github") {
    await call(
      cfg,
      "PATCH",
      `${repoPath(cfg)}/issues/${number}`,
      state === "closed" ? { state, state_reason: "completed" } : { state },
      fetchImpl,
    );
    return;
  }
  if (cfg.provider === "gitlab") {
    await call(
      cfg,
      "PUT",
      `${repoPath(cfg)}/issues/${number}`,
      { state_event: state === "closed" ? "close" : "reopen" },
      fetchImpl,
    );
    return;
  }
  if (cfg.provider === "linear") {
    // Closed = the team's first "completed" state; open = its first "unstarted" (else "backlog") state.
    const d = await linear<{
      issue: {
        id: string;
        state: { type: string } | null;
        team: { states: { nodes: LinearState[] } };
      } | null;
    }>(
      cfg,
      "query($id: String!) { issue(id: $id) { id state { type } team { states { nodes { id type position } } } } }",
      { id: issueKey(cfg, number) },
      fetchImpl,
    );
    if (!d.issue) throw new TrackerError(`Linear issue ${issueKey(cfg, number)} not found`, 404);
    const current = d.issue.state?.type ?? "";
    if ((state === "closed") === (current === "completed" || current === "canceled")) return;
    const states = [...d.issue.team.states.nodes].sort((a, b) => a.position - b.position);
    const target =
      state === "closed"
        ? states.find((s) => s.type === "completed")
        : (states.find((s) => s.type === "unstarted") ?? states.find((s) => s.type === "backlog"));
    if (!target) {
      throw new TrackerError(
        `The Linear team has no ${state === "closed" ? "completed" : "open"} state`,
        null,
      );
    }
    await linear(
      cfg,
      "mutation($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }",
      { id: d.issue.id, stateId: target.id },
      fetchImpl,
    );
    return;
  }
  // Jira: take the workflow's transition into the "done" category (closed) or "to do" / "in progress" (open).
  const key = encodeURIComponent(issueKey(cfg, number));
  const r = await call<{ transitions?: JiraTransition[] }>(
    cfg,
    "GET",
    `/issue/${key}/transitions`,
    undefined,
    fetchImpl,
  );
  const into = (cat: string) => (r.transitions ?? []).find((t) => t.to?.statusCategory?.key === cat);
  const pick = state === "closed" ? into("done") : (into("new") ?? into("indeterminate"));
  if (!pick) {
    throw new TrackerError(
      `No Jira transition ${state === "closed" ? "to a Done status" : "back to an open status"} from the issue's status`,
      null,
    );
  }
  await call(cfg, "POST", `/issue/${key}/transitions`, { transition: { id: pick.id } }, fetchImpl);
}

/** "Test connection": can this token see the repository / team / project? */
export async function checkAccess(
  cfg: TrackerConfig,
  fetchImpl: OutboundFetch = safeFetch,
): Promise<{ ok: true; name: string } | { ok: false; message: string }> {
  try {
    if (cfg.provider === "linear") {
      const team = await linearTeam(cfg, fetchImpl);
      return { ok: true, name: `${team.name} (${team.key})` };
    }
    if (cfg.provider === "jira") {
      const r = await call<{ name?: unknown }>(
        cfg,
        "GET",
        `/project/${encodeURIComponent(cfg.repo)}`,
        undefined,
        fetchImpl,
      );
      return { ok: true, name: typeof r.name === "string" ? `${r.name} (${cfg.repo})` : cfg.repo };
    }
    const r = await call<{ full_name?: unknown; path_with_namespace?: unknown }>(
      cfg,
      "GET",
      repoPath(cfg),
      undefined,
      fetchImpl,
    );
    const name = [r.full_name, r.path_with_namespace].find((v): v is string => typeof v === "string");
    return { ok: true, name: name ?? cfg.repo };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "failed" };
  }
}

// --- Issue body: Markdown that can't ping, link or format anything the reporter wrote -------------

/**
 * Escape untrusted text for GitHub/GitLab/Linear Markdown: HTML is entity-encoded, Markdown punctuation is
 * backslash-escaped, and `@` / `#` get a zero-width space so names can't mention people or link
 * other issues.
 */
export function mdEscape(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/([\\`*_{}[\]()+\-.!|~=])/g, "\\$1")
    .replace(/#/g, "#​")
    .replace(/@/g, "@​");
}
