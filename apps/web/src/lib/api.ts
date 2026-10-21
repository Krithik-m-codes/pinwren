import type { FeedbackKind, FeedbackStatus, Priority } from "@annota/core";

/** Thrown for any non-2xx answer; carries the problem-details code (blueprint 04 §1). */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`/api${path}`, {
    ...rest,
    credentials: "same-origin",
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(res.status, data.code ?? "ERROR", data.title ?? res.statusText);
  }
  return data as T;
}

// --- Response shapes (mirror packages/api/src/routes/dashboard.ts) -----------------------------------

export type Project = {
  id: string;
  name: string;
  slug: string;
  publicKey: string;
  allowedOrigins: string[];
  publicRead: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  openCount?: number;
};

export type Guest = { name?: string; email?: string; externalId?: string } | null;

export type FeedbackRow = {
  id: string;
  number: number;
  kind: FeedbackKind;
  status: FeedbackStatus;
  priority: Priority;
  title: string | null;
  body: string;
  assigneeIds: string[];
  reporterGuest: Guest;
  createdAt: string;
  projectId: string;
  projectName: string;
  pageUrl: string | null;
  hasScreenshot: boolean;
  commentCount: number;
};

export type Member = { id: string; name: string; email: string; image: string | null; role: string };

export type FeedbackDetail = {
  feedback: FeedbackRow & {
    environment: {
      userAgent?: string;
      browser?: string;
      os?: string;
      viewport?: { w: number; h: number };
      dpr?: number;
      locale?: string;
      timezone?: string;
    } | null;
    metadata: Record<string, unknown> | null;
    anchor: { css?: string; xpath?: string; text?: { content?: string } } | null;
    pageTitle: string | null;
    resolvedAt: string | null;
  };
  assets: { id: string; kind: string; contentType: string }[];
  comments: {
    id: string;
    body: string;
    visibility: "public" | "internal";
    createdAt: string;
    authorGuest: Guest;
    author: { id: string; name: string; image: string | null } | null;
  }[];
  activity: {
    id: string;
    type: string;
    data: Record<string, unknown>;
    createdAt: string;
    actorName: string | null;
  }[];
  diagnostics: {
    console: { level: string; message: string; at: number }[] | null;
    network: { method: string; url: string; status: number; durationMs: number; at: number }[] | null;
  } | null;
};
