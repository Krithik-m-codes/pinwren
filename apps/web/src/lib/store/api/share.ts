import type {
  RoundSignoffs,
  ShareComment,
  ShareLinkCreate,
  ShareLinkCreated,
  ShareLinkOut,
  ShareResponse,
  SignoffCreate,
  SignoffOut,
} from "@pinwren/core";
import { SHARE_TOKEN_HEADER, SHARE_UNLOCK_HEADER } from "@pinwren/core";
import type { ShareAccess } from "@/lib/share-access";
import { adminApi } from "./admin";

// Share links. Dashboard side: list / create / revoke the links of a report or a round, and a round's client
// sign-offs. Public side: what a link opens, its password unlock, comments and sign-off (credentials in headers).

const creds = (a: ShareAccess) => ({
  [SHARE_TOKEN_HEADER]: a.token,
  ...(a.unlock ? { [SHARE_UNLOCK_HEADER]: a.unlock } : {}),
});
const path = (key: string) => `/share/${encodeURIComponent(key)}`;

export type ShareTarget = { kind: "feedback" | "round"; id: string };
const targetTag = (t: ShareTarget) => ({ type: "Share" as const, id: `${t.kind}:${t.id}` });

export const shareApi = adminApi.injectEndpoints({
  endpoints: (build) => ({
    shareLinks: build.query<{ links: ShareLinkOut[] }, ShareTarget>({
      query: (t) => `/${t.kind === "feedback" ? "feedback" : "rounds"}/${t.id}/share-links`,
      providesTags: (_r, _e, t) => [targetTag(t)],
    }),
    createShareLink: build.mutation<ShareLinkCreated, ShareLinkCreate>({
      query: (body) => ({ url: "/share-links", method: "POST", body }),
      invalidatesTags: (_r, _e, body) => [
        targetTag(
          body.feedbackId
            ? { kind: "feedback", id: body.feedbackId }
            : { kind: "round", id: body.roundId ?? "" },
        ),
      ],
    }),
    revokeShareLink: build.mutation<unknown, { id: string; target: ShareTarget }>({
      query: ({ id }) => ({ url: `/share-links/${id}`, method: "DELETE" }),
      invalidatesTags: (_r, _e, { target }) => [targetTag(target)],
    }),
    roundSignoffs: build.query<RoundSignoffs, string>({
      query: (roundId) => `/rounds/${roundId}/signoffs`,
      providesTags: (_r, _e, roundId) => [{ type: "Round", id: `signoffs:${roundId}` }],
    }),

    // --- Public (no session) ---------------------------------------------------------------------------
    shareView: build.query<ShareResponse, { key: string; access: ShareAccess }>({
      query: ({ key, access }) => ({ url: path(key), headers: creds(access), cache: "no-store" }),
      keepUnusedDataFor: 0,
      providesTags: (_r, _e, { key }) => [{ type: "Share", id: `public:${key}` }],
    }),
    shareUnlock: build.mutation<{ unlock: string }, { key: string; access: ShareAccess; password: string }>({
      query: ({ key, access, password }) => ({
        url: `${path(key)}/unlock`,
        method: "POST",
        headers: creds(access),
        cache: "no-store",
        body: { password },
      }),
    }),
    shareComment: build.mutation<
      { comment: ShareComment },
      { key: string; access: ShareAccess; body: string; name: string }
    >({
      query: ({ key, access, body, name }) => ({
        url: `${path(key)}/comments`,
        method: "POST",
        headers: creds(access),
        cache: "no-store",
        body: { body, name },
      }),
      invalidatesTags: (_r, e, { key }) => (e ? [] : [{ type: "Share", id: `public:${key}` }]),
    }),
    shareSignoff: build.mutation<
      { signoff: Omit<SignoffOut, "email"> },
      { key: string; access: ShareAccess } & SignoffCreate
    >({
      query: ({ key, access, ...body }) => ({
        url: `${path(key)}/signoff`,
        method: "POST",
        headers: creds(access),
        cache: "no-store",
        body,
      }),
      // Round state changes: refresh the public view and any open dashboard round list.
      invalidatesTags: (_r, e, { key }) => (e ? [] : [{ type: "Share", id: `public:${key}` }]),
    }),
  }),
});

export const {
  useShareLinksQuery,
  useCreateShareLinkMutation,
  useRevokeShareLinkMutation,
  useRoundSignoffsQuery,
  useShareViewQuery,
  useShareUnlockMutation,
  useShareCommentMutation,
  useShareSignoffMutation,
} = shareApi;
export { creds as shareCredentialHeaders };
