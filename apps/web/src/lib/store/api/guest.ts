import type {
  GuestPortalAccess,
  GuestPortalResponse,
  GuestReply,
  GuestReplyCreate,
  GuestThreadResponse,
} from "@pinwren/core";
import { api } from "./index";

type GuestArgs = { key: string; access: GuestPortalAccess };
type ThreadArgs = GuestArgs & { id: string };
const path = (key: string) => `/guest/${encodeURIComponent(key)}/feedback`;
const credentials = (access: GuestPortalAccess) => ({
  "x-pinwren-reporter-tokens": access.reporterTokens.join(","),
  "x-pinwren-page-tokens": access.pageTokens.join(","),
});

export const guestApi = api.injectEndpoints({
  endpoints: (build) => ({
    guestPortal: build.query<GuestPortalResponse, GuestArgs>({
      query: ({ key, access }) => ({ url: path(key), headers: credentials(access), cache: "no-store" }),
      keepUnusedDataFor: 0,
      providesTags: (_result, _error, { key }) => [{ type: "Guest", id: key }],
    }),
    guestThread: build.query<GuestThreadResponse, ThreadArgs>({
      query: ({ key, access, id }) => ({
        url: `${path(key)}/${encodeURIComponent(id)}`,
        headers: credentials(access),
        cache: "no-store",
      }),
      keepUnusedDataFor: 0,
      providesTags: (_result, _error, { key }) => [{ type: "Guest", id: key }],
    }),
    guestReply: build.mutation<{ comment: GuestReply }, ThreadArgs & GuestReplyCreate>({
      query: ({ key, access, id, body }) => ({
        url: `${path(key)}/${encodeURIComponent(id)}/comments`,
        method: "POST",
        headers: credentials(access),
        cache: "no-store",
        body: { body },
      }),
      invalidatesTags: (_result, error, { key }) => (error ? [] : [{ type: "Guest", id: key }]),
    }),
  }),
});

export const { useGuestPortalQuery, useGuestThreadQuery, useGuestReplyMutation } = guestApi;
