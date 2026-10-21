import type { WidgetFeedbackCreate } from "@pinwren/core";
import {
  type Branding,
  type CaptureCfg,
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
};

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
  constructor(
    readonly endpoint: string,
    readonly key: string,
  ) {}

  private async req<T>(
    path: string,
    init?: { method?: string; json?: unknown; headers?: Record<string, string> },
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.endpoint}/w${path}`, {
        method: init?.method ?? "GET",
        headers: {
          "x-pinwren-key": this.key,
          ...(init?.json ? { "content-type": "application/json" } : {}),
          ...init?.headers,
        },
        ...(init?.json ? { body: JSON.stringify(init.json) } : {}),
        credentials: "omit",
        mode: "cors",
      });
    } catch (err) {
      // No response at all (offline, DNS, CORS): status 0 marks it as worth retrying.
      throw new HttpError(err instanceof Error ? err.message : "Network error", 0);
    }
    const data: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const title = (data as { title?: unknown } | null)?.title;
      throw new HttpError(typeof title === "string" ? title : `Request failed (${res.status})`, res.status);
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
  pins(url: string, includeClosed: boolean) {
    return this.req<{ items: Pin[] }>(
      `/feedback?url=${encodeURIComponent(url)}${includeClosed ? "&include=closed" : ""}`,
    );
  }
  replies(id: string) {
    return this.req<{ items: Reply[] }>(`/feedback/${encodeURIComponent(id)}/comments`);
  }
  reply(id: string, body: string, author?: { name?: string; email?: string }) {
    return this.req<{ comment: Reply }>(`/feedback/${encodeURIComponent(id)}/comments`, {
      method: "POST",
      json: { body, author },
    });
  }
  setStatus(id: string, status: "resolved" | "open", reporterToken?: string) {
    return this.req<{ feedback: { id: string; status: string } }>(`/feedback/${encodeURIComponent(id)}`, {
      method: "PATCH",
      json: { status },
      headers: reporterToken ? { "x-pinwren-reporter-token": reporterToken } : {},
    });
  }

  /** Submit, retrying network failures with the same clientId — the server dedupes on it. */
  async submit(payload: WidgetFeedbackCreate): Promise<Created> {
    let lastError: unknown;
    for (const delay of [0, 1000, 3000]) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      try {
        return await this.req<Created>("/feedback", { method: "POST", json: payload });
      } catch (err) {
        lastError = err;
        if (!(err instanceof HttpError) || err.status !== 0) throw err;
      }
    }
    throw lastError;
  }

  /** One attempt; the caller decides whether a failure goes to the offline outbox. */
  submitOnce(payload: WidgetFeedbackCreate): Promise<Created> {
    return this.req<Created>("/feedback", { method: "POST", json: payload });
  }
}
