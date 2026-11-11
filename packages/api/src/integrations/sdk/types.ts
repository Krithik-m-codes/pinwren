import type { IssueProvider } from "@pinwren/core";
import type { OutboundFetch } from "../../outbound/safe-fetch";

// The tracker adapter contract (ADR 0029). One adapter per issue tracker: it turns Pinwren's "create an item",
// "close / reopen it" and "can this token see the project?" into that tracker's API calls, and — when the
// tracker can call us back — says how its webhooks are registered, verified and read. Everything above the
// adapters (jobs, links, activity, tenant checks, licence gates, routes) is the same for every tracker; see
// docs/integrations/tracker-adapters.md for how to write one.

/** What an adapter needs to talk to one project's tracker. Built from the stored, decrypted integration. */
export type TrackerConfig = {
  provider: IssueProvider;
  /** GitHub/GitLab token, Linear API key, Jira API token, Trello token, Asana PAT, ClickUp token, Notion secret. */
  token: string;
  /**
   * GitHub `owner/name`, GitLab project path, Linear team key, Jira project key, Trello board id, Asana
   * project gid, ClickUp list id, Notion database id.
   */
  repo: string;
  /** GitHub Enterprise / self-managed GitLab base URL, or the Jira site URL. Null for the SaaS-only trackers. */
  apiUrl: string | null;
  /** Jira: the Atlassian account the API token belongs to. */
  email?: string | null;
  /** Trello: the API key the token was issued for. */
  apiKey?: string | null;
  /** Board providers: target list / status / priority mapping (keys in core's `TRACKER_SETTING_KEYS`). */
  settings?: Record<string, string>;
};

/**
 * `key` is the tracker's own reference when it isn't `#number` (Linear `ENG-12`, Jira `WEB-7`). Trackers whose
 * items have no number (Asana, ClickUp, Notion) return `number: null` and an `externalId`.
 */
export type IssueRef = { number: number | null; url: string; key?: string; externalId?: string };

/** How a stored link names its item: the number (GitHub, GitLab, Linear, Jira, Trello) and/or the tracker's id. */
export type LinkTarget = { number: number | null; externalId: string | null };

export type NewIssue = {
  title: string;
  /** Markdown (GitHub, GitLab, Linear, Trello, ClickUp) or plain text. */
  body: string;
  labels: string[];
  /** The feedback kind: Jira picks the Bug issue type for bugs. */
  kind?: string;
  /** The feedback priority (`none` … `urgent`), for trackers with a priority field. */
  priority?: string;
  /** Jira: the description as an Atlassian Document Format document. */
  adf?: object;
  /**
   * The structured source of `body` (quote, facts, dashboard link), for trackers that build their own rich
   * format (Asana notes, Notion blocks). Its text is untrusted: put it in plain-text fields only.
   */
  source?: IssueSource;
};

export type IssueSource = {
  number: number;
  /** The reporter's words. */
  quote: string;
  /** `[label, value]` rows: project, kind, page, browser, viewport, reporter. */
  facts: [string, string][];
  /** Dashboard link to the item (sign-in required). */
  link: string;
  productName: string;
};

export class TrackerError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    /** Set on a rate limit the in-process backoff gave up on: how long the tracker asked us to wait. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export type AccessResult =
  | {
      ok: true;
      name: string;
      /** A canonical form of `repo` the tracker resolved (Trello short link → id). */ repo?: string;
    }
  | { ok: false; message: string };

/** What one webhook delivery means for one linked item. */
export type InboundEvent = { number: number | null; externalId: string | null; state: "open" | "closed" };

/** A webhook delivery as the route received it. `callbackUrl` is the URL Pinwren registered, not the request's. */
export type WebhookRequest = {
  raw: string;
  headers: Headers;
  body: Record<string, unknown>;
  callbackUrl: string;
};

/** A one-time handshake the tracker uses to hand over the signing secret (Asana, Notion). */
export type Handshake = { secret: string; reply?: Record<string, string> };

export type WebhookAdapter = {
  /**
   * `register`: Pinwren registers the webhook through the API (Trello, Asana, ClickUp).
   * `handshake`: the admin adds the URL in the tracker and the tracker posts a one-time token (Notion).
   */
  readonly mode: "register" | "handshake";
  /** Register the webhook at the tracker. `secret` is returned when the tracker generates it. */
  register?(
    cfg: TrackerConfig,
    callbackUrl: string,
    fetchImpl: OutboundFetch,
  ): Promise<{ ref: string; secret?: string }>;
  unregister?(cfg: TrackerConfig, ref: string, fetchImpl: OutboundFetch): Promise<void>;
  /** The one-time handshake in this delivery, if it is one. Unsigned by nature: the route only accepts it while pending. */
  handshake?(req: WebhookRequest): Handshake | null;
  /** Is this delivery signed with `secret`? Constant-time. */
  verify(secret: string, req: WebhookRequest): boolean;
  /** A stable id of the delivery for replay protection; the route falls back to the body's hash. */
  deliveryId(req: WebhookRequest): string | undefined;
  /** The state changes in a verified delivery. May call the tracker (Asana and Notion send ids, not values). */
  events(cfg: TrackerConfig, req: WebhookRequest, fetchImpl: OutboundFetch): Promise<InboundEvent[]>;
};

export type TrackerAdapter = {
  readonly provider: IssueProvider;
  readonly name: string;
  createIssue(cfg: TrackerConfig, issue: NewIssue, fetchImpl: OutboundFetch): Promise<IssueRef>;
  setIssueState(
    cfg: TrackerConfig,
    target: LinkTarget,
    state: "open" | "closed",
    fetchImpl: OutboundFetch,
  ): Promise<void>;
  /** "Test connection": can this token see the project / board / list / database? */
  checkAccess(cfg: TrackerConfig, fetchImpl: OutboundFetch): Promise<AccessResult>;
  /**
   * Idempotency beyond the `issue_link` row: an item a previous, interrupted create already made at the
   * tracker (the job died between the tracker's answer and our insert). Optional; the title is the key.
   */
  findExisting?(cfg: TrackerConfig, issue: NewIssue, fetchImpl: OutboundFetch): Promise<IssueRef | null>;
  readonly webhooks?: WebhookAdapter;
};
