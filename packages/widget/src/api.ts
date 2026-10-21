import type { WidgetFeedbackCreate } from "@annota/core";

export type Pin = {
  id: string;
  number: number;
  kind: string;
  status: string;
  body: string;
  anchor: WidgetFeedbackCreate["anchor"] | null;
  createdAt: string;
  reporterName: string | null;
  replyCount: number;
};

export type Reply = { id: string; body: string; createdAt: string; authorName: string | null; team: boolean };

export class WidgetApi {
  constructor(
    readonly endpoint: string,
    readonly key: string,
  ) {}

  private async req<T>(path: string, init?: { method?: string; json?: unknown }): Promise<T> {
    const res = await fetch(`${this.endpoint}/w${path}`, {
      method: init?.method ?? "GET",
      headers: { "x-annota-key": this.key, ...(init?.json ? { "content-type": "application/json" } : {}) },
      body: init?.json ? JSON.stringify(init.json) : undefined,
      credentials: "omit",
      mode: "cors",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.title ?? `Request failed (${res.status})`);
    return data as T;
  }

  config() {
    return this.req<{ project: { name: string; publicRead: boolean } }>("/config");
  }
  pins(url: string) {
    return this.req<{ items: Pin[] }>(`/feedback?url=${encodeURIComponent(url)}`);
  }
  replies(id: string) {
    return this.req<{ items: Reply[] }>(`/feedback/${id}/comments`);
  }
  reply(id: string, body: string, name?: string) {
    return this.req(`/feedback/${id}/comments`, {
      method: "POST",
      json: { body, author: name ? { name } : undefined },
    });
  }

  /** Submit, retrying network failures with the same clientId — the server dedupes on it. */
  async submit(payload: WidgetFeedbackCreate): Promise<{ feedback: { id: string; number: number } }> {
    let lastError: unknown;
    for (const delay of [0, 1000, 3000]) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      try {
        return await this.req("/feedback", { method: "POST", json: payload });
      } catch (err) {
        lastError = err;
        if (err instanceof Error && !/fetch|network/i.test(err.message)) throw err;
      }
    }
    throw lastError;
  }
}
