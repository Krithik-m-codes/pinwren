import type { IssueProvider } from "@pinwren/core";
import { env } from "../env";
import { type OutboundFetch, outboundErrorText, safeFetch } from "../outbound/safe-fetch";

// GitHub and GitLab REST clients for issue sync (F-076/F-077). Authenticated with a personal or
// project access token, so a self-hosted instance needs no OAuth app or GitHub App (ADR 0015).

export type TrackerConfig = {
  provider: IssueProvider;
  token: string;
  repo: string;
  apiUrl: string | null;
};

export type IssueRef = { number: number; url: string };

export class TrackerError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 15_000;

/** REST base: GitHub's API root, or GitLab's `/api/v4` under the instance URL. */
export function apiBase(cfg: Pick<TrackerConfig, "provider" | "apiUrl">): string {
  const e = env();
  if (cfg.provider === "github") return (cfg.apiUrl ?? e.GITHUB_API_URL).replace(/\/+$/, "");
  const root = (cfg.apiUrl ?? e.GITLAB_URL).replace(/\/+$/, "").replace(/\/api\/v4$/, "");
  return `${root}/api/v4`;
}

function headers(cfg: TrackerConfig): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": `Pinwren/${env().PINWREN_VERSION}`,
  };
  if (cfg.provider === "github") {
    h.authorization = `Bearer ${cfg.token}`;
    h.accept = "application/vnd.github+json";
    h["x-github-api-version"] = "2022-11-28";
  } else {
    h["private-token"] = cfg.token;
  }
  return h;
}

const repoPath = (cfg: TrackerConfig) =>
  cfg.provider === "github"
    ? `/repos/${cfg.repo.split("/").map(encodeURIComponent).join("/")}`
    : `/projects/${encodeURIComponent(cfg.repo)}`;

async function call<T>(
  cfg: TrackerConfig,
  method: string,
  path: string,
  body: unknown,
  fetchImpl: OutboundFetch,
): Promise<T> {
  let res: Response;
  try {
    // A per-integration base URL is user input and goes through the outbound guard; the instance's own
    // GITHUB_API_URL / GITLAB_URL are operator settings and may be private.
    res = await fetchImpl(`${apiBase(cfg)}${path}`, {
      method,
      headers: headers(cfg),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      timeoutMs: TIMEOUT_MS,
      maxBytes: 2 * 1024 * 1024,
      trusted: cfg.apiUrl === null,
    });
  } catch (err) {
    throw new TrackerError(
      `Could not reach ${cfg.provider === "github" ? "GitHub" : "GitLab"}: ${outboundErrorText(err)}`,
      null,
    );
  }
  if (res.status >= 300 && res.status < 400) {
    throw new TrackerError(`${res.status} redirect — use the API's final URL`, res.status);
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    // Only the tracker's JSON `message`/`error` field is echoed, never a raw response body: a base URL
    // pointed at some other service must not read that service back.
    let detail = "";
    try {
      const j = JSON.parse(text) as { message?: unknown; error?: unknown };
      const m = j.message ?? j.error;
      // GitLab sometimes answers with a structured message ({ "name": ["has already been taken"] }).
      if (m !== undefined && m !== null)
        detail = (typeof m === "string" ? m : JSON.stringify(m)).slice(0, 200);
    } catch {
      // not JSON — nothing is echoed
    }
    const hint =
      res.status === 401
        ? " (check the token)"
        : res.status === 404
          ? " (check the repository and the token's access)"
          : "";
    throw new TrackerError(`${res.status} ${detail}${hint}`.trim(), res.status);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new TrackerError("Unexpected response from the tracker", res.status);
  }
}

export async function createIssue(
  cfg: TrackerConfig,
  issue: { title: string; body: string; labels: string[] },
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
  await call(
    cfg,
    "PUT",
    `${repoPath(cfg)}/issues/${number}`,
    { state_event: state === "closed" ? "close" : "reopen" },
    fetchImpl,
  );
}

/** "Test connection": can this token see the repository? */
export async function checkAccess(
  cfg: TrackerConfig,
  fetchImpl: OutboundFetch = safeFetch,
): Promise<{ ok: true; name: string } | { ok: false; message: string }> {
  try {
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
 * Escape untrusted text for GitHub/GitLab Markdown: HTML is entity-encoded, Markdown punctuation is
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
