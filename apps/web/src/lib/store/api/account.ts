import type { BillingInfo, BillingInterval, Entitlements } from "@pinwren/core";
import type {
  ApiToken,
  ApiTokenScope,
  Invitation,
  MeResponse,
  Member,
  NotificationItem,
  NotificationPreference,
  OrgBranding,
} from "@/lib/api";
import type { authClient as AuthClient } from "@/lib/auth-client";
import { type ApiError, baseApi, LIST, fulfilled } from "./base";

export type NotificationsResponse = { items: NotificationItem[]; unreadCount: number };
export type BrandingPatch = Partial<
  Pick<OrgBranding, "productName" | "accent" | "logoAssetId" | "faviconAssetId">
>;
/** A Better Auth organisation role (`member.role`); the dashboard shows Admin / Editor / Viewer. */
export type OrgRole = "owner" | "admin" | "member" | "viewer";

type AuthResult<T> = { data: T | null; error: { message?: string | undefined; status?: number } | null };

/** Better Auth client calls as RTK Query results. Imported lazily so the store also runs outside a browser. */
async function auth<T>(call: (client: typeof AuthClient) => Promise<AuthResult<T>>) {
  const { authClient } = await import("@/lib/auth-client");
  const res = await call(authClient);
  if (res.error || res.data === null) {
    const error: ApiError = {
      status: res.error?.status ?? 400,
      code: "AUTH_ERROR",
      message: res.error?.message ?? "Request failed",
    };
    return { error };
  }
  // Better Auth hands back Date objects; the store keeps plain JSON (as the API returns it).
  return { data: JSON.parse(JSON.stringify(res.data)) as T };
}

/** The signed-in person, their workspace and its members; notifications, preferences and API tokens. */
export const accountApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    me: build.query<MeResponse, undefined>({ query: () => "/me", providesTags: ["Me"] }),
    entitlements: build.query<Entitlements, undefined>({
      query: () => "/me/entitlements",
      providesTags: ["Entitlements"],
    }),
    /** Settings � Billing (Cloud, workspace admins). */
    billing: build.query<BillingInfo, undefined>({
      query: () => "/billing",
      providesTags: ["Billing"],
    }),
    startCheckout: build.mutation<{ url: string }, BillingInterval>({
      query: (interval) => ({ url: "/billing/checkout", method: "POST", body: { interval } }),
    }),
    openBillingPortal: build.mutation<{ url: string }, undefined>({
      query: () => ({ url: "/billing/portal", method: "POST", body: {} }),
    }),
    branding: build.query<{ branding: OrgBranding }, undefined>({
      query: () => "/branding",
      providesTags: ["Branding"],
      keepUnusedDataFor: 300,
    }),
    updateBranding: build.mutation<{ branding: OrgBranding }, BrandingPatch>({
      query: (body) => ({ url: "/branding", method: "PATCH", body }),
      async onQueryStarted(_patch, { dispatch, queryFulfilled }) {
        const data = await fulfilled(queryFulfilled);
        if (data === null) return;
        void dispatch(accountApi.util.upsertQueryData("branding", undefined, data));
      },
    }),
    uploadBrandAsset: build.mutation<{ asset: { id: string; url: string } }, { dataUrl: string }>({
      query: (body) => ({ url: "/branding/assets", method: "POST", body }),
    }),

    members: build.query<{ members: Member[] }, undefined>({
      query: () => "/members",
      providesTags: [{ type: "Member", id: LIST }],
    }),
    invitations: build.query<{ invitations: Invitation[] }, undefined>({
      query: () => "/invitations",
      providesTags: [{ type: "Invitation", id: LIST }],
    }),
    inviteMember: build.mutation<unknown, { email: string; role: "admin" | "member" | "viewer" }>({
      queryFn: ({ email, role }) =>
        // The client plugin types only Better Auth's built-in roles; the server also defines `viewer`.
        auth(
          (c) =>
            c.organization.inviteMember({ email, role: role as "member" }) as Promise<AuthResult<unknown>>,
        ),
      invalidatesTags: [{ type: "Invitation", id: LIST }],
    }),
    cancelInvitation: build.mutation<unknown, string>({
      queryFn: (invitationId) =>
        auth((c) => c.organization.cancelInvitation({ invitationId }) as Promise<AuthResult<unknown>>),
      invalidatesTags: [{ type: "Invitation", id: LIST }],
    }),

    notifications: build.query<NotificationsResponse, undefined>({
      query: () => "/notifications?limit=30",
      providesTags: ["Notification"],
    }),
    markNotificationsRead: build.mutation<
      { updated: number },
      { ids: string[] } | { feedbackId: string } | { all: true }
    >({
      query: (body) => ({ url: "/notifications/read", method: "POST", body }),
      // The bell clears at once; the server's answer (or a rollback) follows.
      async onQueryStarted(body, { dispatch, queryFulfilled }) {
        const now = new Date().toISOString();
        const patch = dispatch(
          accountApi.util.updateQueryData("notifications", undefined, (draft) => {
            const ids = "ids" in body ? new Set(body.ids) : null;
            const item = "feedbackId" in body ? body.feedbackId : null;
            let cleared = 0;
            for (const n of draft.items) {
              if (n.readAt || (ids && !ids.has(n.id)) || (item && n.feedbackId !== item)) continue;
              n.readAt = now;
              cleared++;
            }
            draft.unreadCount = ids || item ? Math.max(0, draft.unreadCount - cleared) : 0;
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          patch.undo();
        }
      },
      invalidatesTags: ["Notification"],
    }),
    /** `emailConfigured`: SMTP is set up on the server (else only the bell notifies). */
    notificationPrefs: build.query<
      { preferences: NotificationPreference[]; emailConfigured: boolean },
      undefined
    >({
      query: () => "/notification-preferences",
      providesTags: ["NotificationPrefs"],
    }),
    updateNotificationPrefs: build.mutation<
      unknown,
      Partial<Omit<NotificationPreference, "projectName">> & { projectId: string }
    >({
      query: (body) => ({ url: "/notification-preferences", method: "PUT", body }),
      async onQueryStarted(body, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          accountApi.util.updateQueryData("notificationPrefs", undefined, (draft) => {
            const p = draft.preferences.find((x) => x.projectId === body.projectId);
            if (p) Object.assign(p, body);
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          patch.undo();
        }
      },
    }),

    tokens: build.query<{ tokens: ApiToken[] }, undefined>({
      query: () => "/tokens",
      providesTags: [{ type: "Token", id: LIST }],
    }),
    createToken: build.mutation<
      { token: ApiToken; secret: string },
      { name: string; scopes: ApiTokenScope[]; expiresInDays?: number }
    >({
      query: (body) => ({ url: "/tokens", method: "POST", body }),
      invalidatesTags: [{ type: "Token", id: LIST }],
    }),
    revokeToken: build.mutation<unknown, string>({
      query: (id) => ({ url: `/tokens/${id}`, method: "DELETE" }),
      invalidatesTags: [{ type: "Token", id: LIST }],
    }),
  }),
});
