import { trimTrailingSlashes } from "@pinwren/core";
import { env } from "../../env";
import { trackerClient } from "../sdk/http";
import { type AccessResult, type TrackerAdapter, type TrackerConfig, TrackerError } from "../sdk/types";
import { refFrom } from "../sdk/util";

// GitHub issues (F-076), REST v3 with a token (ADR 0015).

export const githubBase = (cfg: Pick<TrackerConfig, "apiUrl">) =>
  trimTrailingSlashes(cfg.apiUrl ?? env().GITHUB_API_URL);

const call = trackerClient({
  name: "GitHub",
  base: githubBase,
  headers: (cfg) => ({
    "content-type": "application/json",
    authorization: `Bearer ${cfg.token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  }),
  // The instance's own GITHUB_API_URL is an operator setting and may be private.
  trusted: (cfg) => cfg.apiUrl === null,
  hint: (_cfg, status) =>
    status === 401
      ? " (check the token)"
      : status === 404
        ? " (check the repository and the token's access)"
        : "",
});

const repoPath = (cfg: TrackerConfig) => `/repos/${cfg.repo.split("/").map(encodeURIComponent).join("/")}`;

export const github: TrackerAdapter = {
  provider: "github",
  name: "GitHub",
  async createIssue(cfg, issue, f) {
    const r = await call<{ number?: unknown; html_url?: unknown }>(
      cfg,
      "POST",
      `${repoPath(cfg)}/issues`,
      { title: issue.title, body: issue.body, ...(issue.labels.length ? { labels: issue.labels } : {}) },
      f,
    );
    return refFrom(r.number, r.html_url);
  },
  async setIssueState(cfg, target, state, f) {
    if (target.number === null) throw new TrackerError("GitHub issue number missing", null);
    await call(
      cfg,
      "PATCH",
      `${repoPath(cfg)}/issues/${target.number}`,
      state === "closed" ? { state, state_reason: "completed" } : { state },
      f,
    );
  },
  async checkAccess(cfg, f): Promise<AccessResult> {
    try {
      const r = await call<{ full_name?: unknown }>(cfg, "GET", repoPath(cfg), undefined, f);
      return { ok: true, name: typeof r.full_name === "string" ? r.full_name : cfg.repo };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "failed" };
    }
  },
};
