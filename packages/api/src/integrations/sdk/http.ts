import { env } from "../../env";
import { type OutboundFetch, outboundErrorText } from "../../outbound/safe-fetch";
import { type TrackerConfig, TrackerError } from "./types";

// The HTTP half of the adapter SDK: one JSON client per tracker with the instance's outbound guard, the
// tracker's own error text (never a raw body), and — for the trackers that ask for it — rate-limit backoff.

const TIMEOUT_MS = 15_000;

/** Backoff knobs, exported so tests can run without waiting. */
export const backoff = {
  /** Waits and retries on 429 / 503 (and, for reads, 502 / 504 / network errors) up to this many times. */
  baseMs: 500,
  /** A longer `Retry-After` is not waited for in-process: the job queue retries later (it has its own backoff). */
  maxWaitMs: 8_000,
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  jitter: () => Math.random() * 0.25,
};

/** `Retry-After` as milliseconds (delta-seconds or an HTTP date), or null. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, Math.round(secs * 1000));
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

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
  // Linear (GraphQL) and Asana: { errors: [{ message, extensions: { userPresentableMessage } }] }.
  if (Array.isArray(j.errors) && j.errors.length) {
    const first = j.errors[0] as {
      message?: unknown;
      extensions?: { userPresentableMessage?: unknown };
    };
    const m = first.extensions?.userPresentableMessage ?? first.message;
    if (typeof m === "string") return m.slice(0, 200);
  }
  // GitHub / GitLab / Notion: message; ClickUp: err.
  const m = j.message ?? j.error ?? j.err;
  // GitLab sometimes answers with a structured message ({ "name": ["has already been taken"] }).
  if (m !== undefined && m !== null) return (typeof m === "string" ? m : JSON.stringify(m)).slice(0, 200);
  return "";
}

export type ClientSpec = {
  /** Shown in "Could not reach …". */
  name: string;
  base: (cfg: TrackerConfig) => string;
  headers: (cfg: TrackerConfig) => Record<string, string>;
  /** The base URL is the operator's own setting (GITHUB_API_URL, GITLAB_URL), so private addresses are allowed. */
  trusted?: (cfg: TrackerConfig) => boolean;
  /** A short hint appended to an HTTP error (check the token, the project key …). */
  hint?: (cfg: TrackerConfig, status: number) => string;
  /** Plain-text error bodies of a fixed, first-party host (Trello) may be shown, cut short and stripped. */
  plainTextErrors?: boolean;
  /** In-process retries on rate limits and transient errors. Default 0 (the job queue retries instead). */
  retries?: number;
};

const plain = (text: string) =>
  text
    .replace(/[^\p{L}\p{N} .,:;'"()/_-]/gu, "")
    .trim()
    .slice(0, 120);

const TRANSIENT_READ = new Set([502, 503, 504]);

/** A JSON client for one tracker: `call(cfg, method, path, body, fetch)` → parsed body (`{}` when empty). */
export function trackerClient(spec: ClientSpec) {
  return async function call<T>(
    cfg: TrackerConfig,
    method: string,
    path: string,
    body: unknown,
    fetchImpl: OutboundFetch,
  ): Promise<T> {
    const url = `${spec.base(cfg)}${path}`;
    const retries = spec.retries ?? 0;
    for (let attempt = 0; ; attempt++) {
      let res: Response | undefined;
      let failure: unknown;
      try {
        // A per-integration base URL is user input and goes through the outbound guard; the instance's own
        // GITHUB_API_URL / GITLAB_URL are operator settings and may be private.
        res = await fetchImpl(url, {
          method,
          headers: { "user-agent": `Pinwren/${env().PINWREN_VERSION}`, ...spec.headers(cfg) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          timeoutMs: TIMEOUT_MS,
          maxBytes: 2 * 1024 * 1024,
          trusted: spec.trusted?.(cfg) ?? false,
        });
      } catch (err) {
        failure = err;
      }
      const read = method === "GET";
      const status = res?.status ?? null;
      const transient =
        status === 429 ||
        status === 503 ||
        (read && (failure !== undefined || TRANSIENT_READ.has(status ?? 0)));
      if (transient && attempt < retries) {
        const asked = retryAfterMs(res?.headers.get("retry-after") ?? null);
        const wait = asked ?? Math.round(backoff.baseMs * 2 ** attempt * (1 + backoff.jitter()));
        if (wait <= backoff.maxWaitMs) {
          await backoff.sleep(wait);
          continue;
        }
        throw new TrackerError(
          `${spec.name} is rate limiting requests — retrying in ${Math.ceil(wait / 1000)} s`,
          429,
          wait,
        );
      }
      if (!res) {
        throw new TrackerError(`Could not reach ${spec.name}: ${outboundErrorText(failure)}`, null);
      }
      if (res.status >= 300 && res.status < 400) {
        throw new TrackerError(`${res.status} redirect — use the API's final URL`, res.status);
      }
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        const detail = errorDetail(text) || (spec.plainTextErrors ? plain(text) : "");
        const asked =
          res.status === 429 ? (retryAfterMs(res.headers.get("retry-after")) ?? undefined) : undefined;
        throw new TrackerError(
          `${res.status} ${detail}${spec.hint?.(cfg, res.status) ?? ""}`.trim(),
          res.status,
          asked,
        );
      }
      // Some writes (Jira transitions) answer 204 with no body.
      if (!text.trim()) return {} as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new TrackerError("Unexpected response from the tracker", res.status);
      }
    }
  };
}
