import type { IssueProvider } from "@pinwren/core";
import { env } from "../env";

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
  fetchImpl: typeof fetch,
): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(`${apiBase(cfg)}${path}`, {
      method,
      headers: headers(cfg),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const msg = err instanceof Error && err.name === "TimeoutError" ? "timed out" : (err as Error)?.message;
    throw new TrackerError(
      `Could not reach ${cfg.provider === "github" ? "GitHub" : "GitLab"}: ${msg}`,
      null,
    );
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    let detail = text.slice(0, 200);
    try {
      const j = JSON.parse(text) as { message?: unknown; error?: unknown };
      detail = String(j.message ?? j.error ?? detail).slice(0, 200);
    } catch {
      // not JSON — keep the text
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
  fetchImpl: typeof fetch = fetch,
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
  fetchImpl: typeof fetch = fetch,
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
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; name: string } | { ok: false; message: string }> {
  try {
    const r = await call<{ full_name?: unknown; path_with_namespace?: unknown }>(
      cfg,
      "GET",
      repoPath(cfg),
      undefined,
      fetchImpl,
    );
    return { ok: true, name: String(r.full_name ?? r.path_with_namespace ?? cfg.repo) };
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
