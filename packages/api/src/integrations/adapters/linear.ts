import type { OutboundFetch } from "../../outbound/safe-fetch";
import { errorDetail, trackerClient } from "../sdk/http";
import { type AccessResult, type TrackerAdapter, type TrackerConfig, TrackerError } from "../sdk/types";
import { issueKey, refFrom } from "../sdk/util";

// Linear (F-078): GraphQL with a personal API key, sent bare in `Authorization` (ADR 0015).

export const LINEAR_API_URL = "https://api.linear.app/graphql";

const call = trackerClient({
  name: "Linear",
  base: () => LINEAR_API_URL,
  // Personal API keys go bare (OAuth tokens would be `Bearer …`; not used, ADR 0015).
  headers: (cfg) => ({
    "content-type": "application/json",
    accept: "application/json",
    authorization: cfg.token,
  }),
  hint: (_cfg, status) =>
    status === 401
      ? " (check the API key)"
      : status === 404
        ? " (check the repository and the token's access)"
        : "",
});

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

export const linearAdapter: TrackerAdapter = {
  provider: "linear",
  name: "Linear",
  async createIssue(cfg, issue, f) {
    const team = await linearTeam(cfg, f);
    const labelIds = await linearLabelIds(cfg, team.id, issue.labels, f);
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
      f,
    );
    const i = d.issueCreate.issue;
    if (!d.issueCreate.success || !i) throw new TrackerError("Linear did not create the issue", null);
    return {
      ...refFrom(i.number, i.url),
      ...(typeof i.identifier === "string" ? { key: i.identifier } : {}),
    };
  },
  async setIssueState(cfg, target, state, f) {
    if (target.number === null) throw new TrackerError("Linear issue number missing", null);
    const number = target.number;
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
      f,
    );
    if (!d.issue) throw new TrackerError(`Linear issue ${issueKey(cfg, number)} not found`, 404);
    const current = d.issue.state?.type ?? "";
    if ((state === "closed") === (current === "completed" || current === "canceled")) return;
    const states = [...d.issue.team.states.nodes].sort((a, b) => a.position - b.position);
    const to =
      state === "closed"
        ? states.find((s) => s.type === "completed")
        : (states.find((s) => s.type === "unstarted") ?? states.find((s) => s.type === "backlog"));
    if (!to) {
      throw new TrackerError(
        `The Linear team has no ${state === "closed" ? "completed" : "open"} state`,
        null,
      );
    }
    await linear(
      cfg,
      "mutation($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }",
      { id: d.issue.id, stateId: to.id },
      f,
    );
  },
  async checkAccess(cfg, f): Promise<AccessResult> {
    try {
      const team = await linearTeam(cfg, f);
      return { ok: true, name: `${team.name} (${team.key})` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "failed" };
    }
  },
};
