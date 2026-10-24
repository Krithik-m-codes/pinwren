import type { WidgetFeedbackCreate } from "@pinwren/core";
import {
  type Branding,
  type CaptureCfg,
  type FeedbackPayload,
  type ReporterPayload,
  resolveBranding,
  resolveCapture,
  resolveConfig,
  type WidgetConfig,
} from "./config";
import { HttpError } from "./queue";

// Wire shapes from docs/contracts/wave-1.md §3–§5.
export type Pin = {
  id: string;
  number: number;
  kind: string;
  status: string;
  priority?: string;
  title?: string | null;
  body: string;
  anchor: WidgetFeedbackCreate["anchor"] | null;
  createdAt: string;
  reporterName: string | null;
  replyCount: number;
  /** The item's page (normalised); the sidebar's "All pages" view groups and links by it. */
  pageUrl?: string | null;
};

/** Proof that lets this browser read one private item: a reporter token or a signed page-link token. */
export type Access = { reporter?: string | undefined; link?: string | undefined };

const accessHeaders = (a?: Access): Record<string, string> => ({
  ...(a?.reporter ? { "x-pinwren-reporter-token": a.reporter } : {}),
  ...(a?.link ? { "x-pinwren-link-token": a.link } : {}),
});

/** Most calls give up after this; a report (screenshot, replay, files) gets longer to upload. */
const TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 90_000;

export type Reply = { id: string; body: string; createdAt: string; authorName: string | null; team: boolean };

export type Created = { feedback: { id: string; number: number; reporterToken?: string } };

export type Loaded = {
  /** `slug` fills the `{projectSlug}` action placeholder; empty when the server doesn't send it. */
  project: { name: string; publicRead: boolean; slug: string };
  widget: WidgetConfig;
  capture: CaptureCfg;
  branding: Branding;
};

export class WidgetApi {
  /**
   * A valid review link's token (`?pinwren_review=`), once checked: sent with every request, so reports
   * from this visitor record the link as their source (wave-5 §3.5).
   */
  reviewToken: string | null = null;

  constructor(
    readonly endpoint: string,
    readonly key: string,
  ) {}

  private async req<T>(
    path: string,
    init?: { method?: string; json?: unknown; headers?: Record<string, string>; timeout?: number },
  ): Promise<T> {
    let res: Response;
    // A hung connection must not leave a spinner forever: abort, and report it as a (retryable) timeout.
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = setTimeout(() => ctrl?.abort(), init?.timeout ?? TIMEOUT_MS);
    try {
      res = await fetch(`${this.endpoint}/w${path}`, {
        method: init?.method ?? "GET",
        headers: {
          "x-pinwren-key": this.key,
          ...(this.reviewToken ? { "x-pinwren-review-token": this.reviewToken } : {}),
          ...(init?.json ? { "content-type": "application/json" } : {}),
          ...init?.headers,
        },
        ...(init?.json ? { body: JSON.stringify(init.json) } : {}),
        ...(ctrl ? { signal: ctrl.signal } : {}),
        credentials: "omit",
        mode: "cors",
      });
    } catch (err) {
      if (ctrl?.signal.aborted) throw new HttpError("Request timed out", 408, "TIMEOUT");
      // No response at all (offline, DNS, CORS): status 0 marks it as worth retrying.
      throw new HttpError(err instanceof Error ? err.message : "Network error", 0);
    } finally {
      clearTimeout(timer);
    }
    const data: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const p = data as { title?: unknown; code?: unknown } | null;
      throw new HttpError(
        typeof p?.title === "string" ? p.title : `Request failed (${res.status})`,
        res.status,
        typeof p?.code === "string" ? p.code : undefined,
      );
    }
    return data as T;
  }

  async config(accent?: string): Promise<Loaded> {
    const raw = await this.req<{
      project?: { name?: string; publicRead?: boolean; slug?: unknown };
      widget?: unknown;
      capture?: unknown;
      branding?: unknown;
    }>("/config");
    const slug = raw.project?.slug;
    return {
      project: {
        name: raw.project?.name ?? "",
        publicRead: raw.project?.publicRead !== false,
        slug: typeof slug === "string" ? slug.slice(0, 100) : "",
      },
      widget: resolveConfig(raw.widget, accent),
      capture: resolveCapture(raw.capture),
      branding: resolveBranding(raw.branding, this.endpoint),
    };
  }
  /** Pins for this page; with a page scope (wave-4 §4) the server matches by `urlPattern` instead. */
  pins(url: string, includeClosed: boolean, urlPattern?: string) {
    const q = new URLSearchParams({ url });
    if (urlPattern) q.set("urlPattern", urlPattern);
    if (includeClosed) q.set("include", "closed");
    return this.req<{ items: Pin[] }>(`/feedback?${q.toString()}`);
  }
  /** Public replies; `access` opens a private item (the reporter's own, or one behind a page link). */
  replies(id: string, access?: Access) {
    return this.req<{ items: Reply[] }>(`/feedback/${encodeURIComponent(id)}/comments`, {
      headers: accessHeaders(access),
    });
  }
  reply(id: string, body: string, author?: ReporterPayload, access?: Access) {
    return this.req<{ comment: Reply }>(`/feedback/${encodeURIComponent(id)}/comments`, {
      method: "POST",
      json: { body, author },
      headers: accessHeaders(access),
    });
  }
  /** The reporter's own items (any page, any status), whatever `publicRead` says (wave-5 §3.3). */
  mine(tokens: string[], url?: string, urlPattern?: string) {
    const q = new URLSearchParams();
    if (url) q.set("url", url);
    if (urlPattern) q.set("urlPattern", urlPattern);
    return this.req<{ items: Pin[] }>(`/mine${q.size ? `?${q.toString()}` : ""}`, {
      headers: { "x-pinwren-reporter-tokens": tokens.slice(0, 50).join(",") },
    });
  }
  /** One item opened from a signed page link (`?pinwren=<id>&pwt=<token>`), with its public replies. */
  linked(id: string, token: string) {
    return this.req<{ item: Pin; replies: Reply[]; scope: "read" | "repin" }>(
      `/feedback/${encodeURIComponent(id)}`,
      { headers: { "x-pinwren-link-token": token } },
    );
  }
  /** Re-pin (F-031) with a team-issued re-pin link. */
  repin(id: string, anchor: NonNullable<WidgetFeedbackCreate["anchor"]>, token: string) {
    return this.req<{ feedback: { id: string } }>(`/feedback/${encodeURIComponent(id)}/anchor`, {
      method: "PATCH",
      json: { anchor },
      headers: { "x-pinwren-link-token": token },
    });
  }
  /** A review link's token (`?pinwren_review=`): valid ones show the widget in every visibility mode. */
  async reviewLink(token: string): Promise<boolean> {
    try {
      await this.req<{ ok: true }>("/review-link", { headers: { "x-pinwren-review-token": token } });
      return true;
    } catch {
      return false;
    }
  }
  setStatus(id: string, status: "resolved" | "open", reporterToken?: string) {
    return this.req<{ feedback: { id: string; status: string } }>(`/feedback/${encodeURIComponent(id)}`, {
      method: "PATCH",
      json: { status },
      headers: reporterToken ? { "x-pinwren-reporter-token": reporterToken } : {},
    });
  }
  /** Delete the reporter's own item (wave 5, sidebar): only with the token this browser got when sending it. */
  remove(id: string, reporterToken: string) {
    return this.req<unknown>(`/feedback/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "x-pinwren-reporter-token": reporterToken },
    });
  }

  /** Submit, retrying network failures with the same clientId — the server dedupes on it. */
  async submit(payload: FeedbackPayload): Promise<Created> {
    let lastError: unknown;
    for (const delay of [0, 1000, 3000]) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      try {
        return await this.req<Created>("/feedback", {
          method: "POST",
          json: payload,
          timeout: UPLOAD_TIMEOUT_MS,
        });
      } catch (err) {
        lastError = err;
        if (!(err instanceof HttpError) || err.status !== 0) throw err;
      }
    }
    throw lastError;
  }

  /** One attempt; the caller decides whether a failure goes to the offline outbox. */
  submitOnce(payload: FeedbackPayload): Promise<Created> {
    return this.req<Created>("/feedback", { method: "POST", json: payload, timeout: UPLOAD_TIMEOUT_MS });
  }
}
