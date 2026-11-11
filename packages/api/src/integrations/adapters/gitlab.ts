import { trimTrailingSlashes } from "@pinwren/core";
import { env } from "../../env";
import { trackerClient } from "../sdk/http";
import { type AccessResult, type TrackerAdapter, type TrackerConfig, TrackerError } from "../sdk/types";
import { refFrom } from "../sdk/util";

// GitLab issues (F-077), REST v4 with a project / personal access token (ADR 0015).

export function gitlabBase(cfg: Pick<TrackerConfig, "apiUrl">): string {
  const root = trimTrailingSlashes(cfg.apiUrl ?? env().GITLAB_URL).replace(/\/api\/v4$/, "");
  return `${root}/api/v4`;
}

const call = trackerClient({
  name: "GitLab",
  base: gitlabBase,
  headers: (cfg) => ({
    "content-type": "application/json",
    accept: "application/json",
    "private-token": cfg.token,
  }),
  // The instance's own GITLAB_URL is an operator setting and may be private.
  trusted: (cfg) => cfg.apiUrl === null,
  hint: (_cfg, status) =>
    status === 401
      ? " (check the token)"
      : status === 404
        ? " (check the repository and the token's access)"
        : "",
});

const repoPath = (cfg: TrackerConfig) => `/projects/${encodeURIComponent(cfg.repo)}`;

export const gitlab: TrackerAdapter = {
  provider: "gitlab",
  name: "GitLab",
  async createIssue(cfg, issue, f) {
    const r = await call<{ iid?: unknown; web_url?: unknown }>(
      cfg,
      "POST",
      `${repoPath(cfg)}/issues`,
      {
        title: issue.title,
        description: issue.body,
        ...(issue.labels.length ? { labels: issue.labels.join(",") } : {}),
      },
      f,
    );
    return refFrom(r.iid, r.web_url);
  },
  async setIssueState(cfg, target, state, f) {
    if (target.number === null) throw new TrackerError("GitLab issue number missing", null);
    await call(
      cfg,
      "PUT",
      `${repoPath(cfg)}/issues/${target.number}`,
      { state_event: state === "closed" ? "close" : "reopen" },
      f,
    );
  },
  async checkAccess(cfg, f): Promise<AccessResult> {
    try {
      const r = await call<{ path_with_namespace?: unknown }>(cfg, "GET", repoPath(cfg), undefined, f);
      return {
        ok: true,
        name: typeof r.path_with_namespace === "string" ? r.path_with_namespace : cfg.repo,
      };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "failed" };
    }
  },
};
