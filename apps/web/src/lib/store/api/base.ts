import { createApi, type FetchArgs, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type { BaseQueryFn, FetchBaseQueryError } from "@reduxjs/toolkit/query";

/** A failed request as the dashboard sees it: the HTTP status and the problem-details code (blueprint 04 §1). */
export type ApiError = { status: number; code: string; message: string };

/** What every store is created with (`makeStore`), handed to RTK Query and the listener middleware. */
export type StoreExtra = {
  /** Where `/api` lives: same origin in the browser; an absolute URL in tests. */
  apiBase: string;
  /** Opens the real-time stream. Absent on the server and in tests that don't need it. */
  eventSource?: ((url: string) => EventSourceLike) | undefined;
};

/** The part of `EventSource` the real-time middleware uses (a fake implements it in tests). */
export type EventSourceLike = {
  readonly readyState: number;
  onopen: ((ev: Event) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
  addEventListener: (type: string, listener: (ev: MessageEvent<string>) => void) => void;
  close: () => void;
};

export const isApiError = (e: unknown): e is ApiError =>
  !!e && typeof e === "object" && "status" in e && "code" in e && "message" in e;

/** 403s for admin-only screens render as an explanation instead of an error. */
export const isForbidden = (e: unknown) => isApiError(e) && e.status === 403;

/** The message to show for any error a hook or `unwrap()` hands back. */
export const errorMessage = (e: unknown, fallback = "Something went wrong") =>
  isApiError(e) ? e.message : e instanceof Error ? e.message : fallback;

function toApiError(e: FetchBaseQueryError): ApiError {
  if (typeof e.status === "number") {
    const body = (e.data ?? {}) as { code?: unknown; title?: unknown };
    return {
      status: e.status,
      code: typeof body.code === "string" ? body.code : "ERROR",
      message: typeof body.title === "string" ? body.title : `Request failed (${e.status})`,
    };
  }
  // FETCH_ERROR (offline), PARSING_ERROR, TIMEOUT_ERROR, CUSTOM_ERROR
  return { status: 0, code: e.status, message: "error" in e ? e.error : "Network error" };
}

const queries = new Map<string, ReturnType<typeof fetchBaseQuery>>();
function rawQuery(base: string) {
  let q = queries.get(base);
  if (!q) {
    q = fetchBaseQuery({ baseUrl: base, credentials: "same-origin" });
    queries.set(base, q);
  }
  return q;
}

export type BaseQuery = BaseQueryFn<string | FetchArgs, unknown, ApiError>;

/** fetchBaseQuery against `extra.apiBase`, with problem-details errors flattened to `ApiError`. */
export const baseQuery: BaseQuery = async (args, api, extraOptions: object) => {
  const { apiBase } = api.extra as StoreExtra;
  const result = await rawQuery(apiBase)(args, api, extraOptions);
  if (result.error) return { error: toApiError(result.error) };
  return { data: result.data ?? null };
};

export const TAG_TYPES = [
  "Me",
  "Entitlements",
  "Branding",
  "Project",
  "Feedback",
  "Member",
  "Org",
  "Invitation",
  "Notification",
  "NotificationPrefs",
  "Webhook",
  "Delivery",
  "Token",
  "Tracker",
  "EmailSettings",
  "EmailTemplate",
  "Security",
  "License",
  "Round",
  "View",
] as const;
export type TagType = (typeof TAG_TYPES)[number];

/**
 * The one RTK Query API of the dashboard. Endpoints are injected per domain (`account`, `projects`,
 * `feedback`, `rounds`, `admin`), each building on the previous so the last one types every endpoint.
 * Lists provide `{ type, id: "LIST" }` plus one tag per row, details `{ type, id }`.
 */
export const baseApi = createApi({
  reducerPath: "api",
  baseQuery,
  tagTypes: TAG_TYPES,
  keepUnusedDataFor: 60,
  refetchOnReconnect: true,
  endpoints: () => ({}),
});

export const LIST = "LIST" as const;

/**
 * A mutation's `queryFulfilled` in `onQueryStarted`, without the rejection: on failure the caller's
 * `unwrap()` shows the error, and the cache update after it simply doesn't happen.
 */
export async function fulfilled<T>(query: Promise<{ data: T }>): Promise<T | null> {
  try {
    return (await query).data;
  } catch {
    return null;
  }
}
