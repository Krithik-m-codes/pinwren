import type {
  CommentCreate,
  Comment,
  FeedbackDetail,
  FeedbackList,
  FeedbackListItem,
  FeedbackListQuery,
  FeedbackRow,
  FeedbackUpdate,
  Project,
  Reproduction,
  Round,
  RoundUpdate,
} from "./types.generated";

export type * from "./types.generated";

/** Options for {@link Pinwren}. */
export type PinwrenOptions = {
  /** Your Pinwren instance, e.g. `https://feedback.example.com`. */
  url: string;
  /** An API token (`pwt_…`) from Settings › API tokens. */
  token: string;
  /** Custom fetch (tests, proxies, edge runtimes). Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Abort a request after this many milliseconds (default 30 000). */
  timeoutMs?: number;
  /** Sent as `User-Agent` where the runtime allows it. */
  userAgent?: string;
};

/** An error answer from the API (RFC 9457 problem details), or a network failure (`status` 0). */
export class PinwrenError extends Error {
  override readonly name = "PinwrenError";
  constructor(
    /** HTTP status; 0 when the server could not be reached. */
    readonly status: number,
    /** Stable error code, e.g. `INVALID_TOKEN`, `INSUFFICIENT_SCOPE`, `READ_ONLY_ROLE`, `NOT_FOUND`. */
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

function queryString(q: Query | undefined): string {
  if (!q) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

const enc = encodeURIComponent;

/** A loop, not `/\/+$/`: that regex is quadratic on long runs of `/` (CodeQL js/polynomial-redos). */
function trimTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* / */) end--;
  return s.slice(0, end);
}

/**
 * Typed client for the Pinwren public API (`/api/v1`).
 *
 * ```ts
 * const pinwren = new Pinwren({ url: "https://feedback.example.com", token: process.env.PINWREN_TOKEN! });
 * const { items } = await pinwren.feedback.list({ status: "open", kind: "bug" });
 * ```
 */
export class Pinwren {
  readonly url: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #userAgent: string | undefined;

  constructor(options: PinwrenOptions) {
    if (!options.url) throw new TypeError("Pinwren: `url` is required");
    if (!options.token) throw new TypeError("Pinwren: `token` is required");
    this.url = trimTrailingSlashes(options.url);
    this.#token = options.token;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#userAgent = options.userAgent;
  }

  /** Low-level request against `/api/v1`. Resolves with the raw `Response` for non-JSON bodies. */
  async request(
    method: string,
    path: string,
    init: { query?: Query; body?: unknown } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.#token}`,
      accept: "application/json",
    };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (this.#userAgent) headers["user-agent"] = this.#userAgent;
    let res: Response;
    try {
      res = await this.#fetch(`${this.url}/api/v1${path}${queryString(init.query)}`, {
        method,
        headers,
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (err) {
      throw new PinwrenError(0, "NETWORK_ERROR", err instanceof Error ? err.message : "Request failed");
    }
    if (!res.ok) {
      let code = "HTTP_ERROR";
      let title = `HTTP ${res.status}`;
      try {
        const problem = (await res.json()) as { code?: unknown; title?: unknown };
        if (typeof problem.code === "string") code = problem.code;
        if (typeof problem.title === "string") title = problem.title;
      } catch {
        // Not problem+json (a proxy error page, say): keep the status line.
      }
      throw new PinwrenError(res.status, code, title);
    }
    return res;
  }

  async #json<T>(method: string, path: string, init?: { query?: Query; body?: unknown }): Promise<T> {
    const res = await this.request(method, path, init);
    return (await res.json()) as T;
  }

  async *#iterate(query: FeedbackListQuery): AsyncGenerator<FeedbackListItem, void, undefined> {
    let cursor = query.cursor;
    for (;;) {
      const page = await this.feedback.list({ ...query, cursor });
      yield* page.items;
      if (!page.nextCursor) return;
      cursor = page.nextCursor;
    }
  }

  /** Projects of the token's organisation, with open-item counts. */
  readonly projects = {
    list: async (): Promise<Project[]> =>
      (await this.#json<{ projects: Project[] }>("GET", "/projects")).projects,
  };

  readonly feedback = {
    /** One page of feedback, newest first. Pass `nextCursor` back as `cursor` for the next page. */
    list: (query: FeedbackListQuery = {}): Promise<FeedbackList> =>
      this.#json<FeedbackList>("GET", "/feedback", { query }),

    /** Every matching item, page by page: `for await (const item of pinwren.feedback.iterate({ … }))`. */
    iterate: (query: FeedbackListQuery = {}): AsyncGenerator<FeedbackListItem, void, undefined> =>
      this.#iterate(query),

    /** The item with its thread, files, timeline and diagnostics. */
    get: (id: string): Promise<FeedbackDetail> => this.#json<FeedbackDetail>("GET", `/feedback/${enc(id)}`),

    /** Change status, priority, title, assignees or review round. Needs `feedback:write`. */
    update: async (id: string, patch: FeedbackUpdate): Promise<FeedbackRow> =>
      (await this.#json<{ feedback: FeedbackRow }>("PATCH", `/feedback/${enc(id)}`, { body: patch }))
        .feedback,

    /** Mark resolved, optionally with a note (e.g. the PR that fixed it) as an internal comment. */
    resolve: async (id: string, note?: string): Promise<FeedbackRow> => {
      if (note?.trim()) await this.comments.create(id, { body: note, visibility: "internal" });
      return this.feedback.update(id, { status: "resolved" });
    },

    /** Steps, failing requests and console errors (plus a replay summary when one was recorded). */
    reproduction: (id: string): Promise<Reproduction> =>
      this.#json<Reproduction>("GET", `/feedback/${enc(id)}/reproduction`),
  };

  readonly comments = {
    /** Add a team comment (internal unless `visibility: "public"`). Needs `comments:write`. */
    create: async (feedbackId: string, comment: CommentCreate): Promise<Comment> =>
      (
        await this.#json<{ comment: Comment }>("POST", `/feedback/${enc(feedbackId)}/comments`, {
          body: comment,
        })
      ).comment,
  };

  readonly rounds = {
    list: async (projectId: string): Promise<Round[]> =>
      (await this.#json<{ rounds: Round[] }>("GET", `/projects/${enc(projectId)}/rounds`)).rounds,
    get: async (id: string): Promise<Round> =>
      (await this.#json<{ round: Round }>("GET", `/rounds/${enc(id)}`)).round,
    /** Rename, reschedule or close a round. Needs `feedback:write`. */
    update: async (id: string, patch: RoundUpdate): Promise<Round> =>
      (await this.#json<{ round: Round }>("PATCH", `/rounds/${enc(id)}`, { body: patch })).round,
  };

  readonly assets = {
    /** Download a screenshot, attachment or replay (`application/gzip`) as bytes. */
    get: async (id: string): Promise<{ contentType: string; bytes: Uint8Array }> => {
      const res = await this.request("GET", `/assets/${enc(id)}`);
      return {
        contentType: res.headers.get("content-type") ?? "application/octet-stream",
        bytes: new Uint8Array(await res.arrayBuffer()),
      };
    },
    /** The URL of an asset (it needs this client's token: `Authorization: Bearer`). */
    url: (id: string): string => `${this.url}/api/v1/assets/${enc(id)}`,
  };
}

/** Shorthand for `new Pinwren(options)`. */
export const createClient = (options: PinwrenOptions): Pinwren => new Pinwren(options);
