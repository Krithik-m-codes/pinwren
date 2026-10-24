import type { AppRole } from "@pinwren/core";
import type { MeResponse, Member, SetupStatus } from "@/lib/api";
import type { authClient as AuthClient } from "@/lib/auth-client";
import { type ApiError, baseApi, LIST } from "./base";

// Accounts (wave-5 contract §3.1): first-run state, Users (Add User, roles, reset links), the signed-in
// person's own account, workspaces and instance administrators. Injected on its own so the shared
// endpoint modules stay untouched; import the hooks from here.

export type MyInvitation = {
  id: string;
  organizationId: string;
  organizationName: string;
  role: string | null;
  appRole: AppRole;
  expiresAt: string;
  inviterName: string | null;
};

export type Workspace = { id: string; name: string; slug: string; logo?: string | null };

/** A signed-in device (Better Auth `listSessions`). */
export type AccountSession = {
  id: string;
  token: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt: string;
  expiresAt: string;
};

export type InstanceAdmin = { id: string; name: string; email: string; source: "env" | "dashboard" };

export type AddedMember = {
  id: string;
  userId: string;
  name: string;
  email: string;
  appRole: AppRole;
  createdAt: string;
};

type AuthResult<T> = { data: T | null; error: { message?: string | undefined; status?: number } | null };

/** A Better Auth client call as an RTK Query result (imported lazily: the store also runs outside a browser). */
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
  return { data: JSON.parse(JSON.stringify(res.data)) as T };
}

export const peopleApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    /** Public: is there an account yet, may strangers sign up, can email go out (`GET /api/setup`). */
    setupStatus: build.query<SetupStatus, undefined>({ query: () => "/setup", keepUnusedDataFor: 30 }),

    addMember: build.mutation<
      { member: AddedMember },
      { name: string; email: string; password: string; role: AppRole }
    >({
      query: (body) => ({ url: "/members", method: "POST", body }),
      invalidatesTags: [{ type: "Member", id: LIST }, "Org"],
    }),
    setMemberRole: build.mutation<{ member: Member }, { userId: string; role: AppRole }>({
      query: ({ userId, role }) => ({
        url: `/members/${encodeURIComponent(userId)}`,
        method: "PATCH",
        body: { role },
      }),
      invalidatesTags: [{ type: "Member", id: LIST }, "Org"],
    }),
    removeMemberById: build.mutation<null, string>({
      query: (userId) => ({ url: `/members/${encodeURIComponent(userId)}`, method: "DELETE" }),
      invalidatesTags: [{ type: "Member", id: LIST }, "Org"],
    }),
    memberResetLink: build.mutation<{ url: string; expiresAt: string }, string>({
      query: (userId) => ({ url: `/members/${encodeURIComponent(userId)}/reset-link`, method: "POST" }),
    }),

    myInvitations: build.query<{ invitations: MyInvitation[] }, undefined>({
      query: () => "/me/invitations",
      providesTags: [{ type: "Invitation", id: "MINE" }],
    }),
    saveProfile: build.mutation<{ user: MeResponse["user"] }, { name: string }>({
      query: (body) => ({ url: "/me/profile", method: "PATCH", body }),
      invalidatesTags: ["Me", { type: "Member", id: LIST }, "Org"],
    }),
    uploadAvatar: build.mutation<{ image: string }, { dataUrl: string }>({
      query: (body) => ({ url: "/me/avatar", method: "POST", body }),
      invalidatesTags: ["Me", { type: "Member", id: LIST }, "Org"],
    }),
    removeAvatar: build.mutation<{ image: null }, undefined>({
      query: () => ({ url: "/me/avatar", method: "DELETE" }),
      invalidatesTags: ["Me", { type: "Member", id: LIST }, "Org"],
    }),
    /** Without SMTP: change the address with the password (`POST /api/me/email`). */
    changeEmailWithPassword: build.mutation<
      { user: MeResponse["user"] },
      { newEmail: string; password: string }
    >({
      query: (body) => ({ url: "/me/email", method: "POST", body }),
      invalidatesTags: ["Me", { type: "Member", id: LIST }, "Org"],
    }),

    /** Where this account is signed in; the current one comes from `currentSession`. */
    sessions: build.query<{ sessions: AccountSession[]; currentId: string | null }, undefined>({
      async queryFn() {
        const list = await auth((c) => c.listSessions() as Promise<AuthResult<AccountSession[]>>);
        if ("error" in list) return { error: list.error };
        const current = await auth(
          (c) => c.getSession() as Promise<AuthResult<{ session: { id: string } } | null>>,
        );
        return {
          data: {
            sessions: list.data,
            currentId: "data" in current ? (current.data?.session.id ?? null) : null,
          },
        };
      },
      providesTags: [{ type: "Me", id: "SESSIONS" }],
    }),
    revokeSession: build.mutation<unknown, string>({
      queryFn: (token) => auth((c) => c.revokeSession({ token }) as Promise<AuthResult<unknown>>),
      invalidatesTags: [{ type: "Me", id: "SESSIONS" }],
    }),
    revokeOtherSessions: build.mutation<unknown, undefined>({
      queryFn: () => auth((c) => c.revokeOtherSessions() as Promise<AuthResult<unknown>>),
      invalidatesTags: [{ type: "Me", id: "SESSIONS" }],
    }),

    workspaces: build.query<Workspace[], undefined>({
      queryFn: () => auth((c) => c.organization.list() as Promise<AuthResult<Workspace[]>>),
      providesTags: ["Org"],
    }),
    renameWorkspace: build.mutation<{ workspace: { id: string; name: string } }, { name: string }>({
      query: (body) => ({ url: "/workspace", method: "PATCH", body }),
      invalidatesTags: ["Org"],
    }),
    transferOwnership: build.mutation<{ ownerId: string }, { userId: string }>({
      query: (body) => ({ url: "/workspace/transfer", method: "POST", body }),
      invalidatesTags: ["Me", { type: "Member", id: LIST }, "Org"],
    }),
    deleteWorkspace: build.mutation<null, { confirm: string }>({
      query: (body) => ({ url: "/workspace", method: "DELETE", body }),
    }),

    instanceAdmins: build.query<{ admins: InstanceAdmin[]; pendingEmails: string[] }, undefined>({
      query: () => "/admin/instance-admins",
      providesTags: [{ type: "Security", id: "ADMINS" }],
    }),
    addInstanceAdmin: build.mutation<{ ok: true }, string>({
      query: (userId) => ({ url: "/admin/instance-admins", method: "POST", body: { userId } }),
      invalidatesTags: [{ type: "Security", id: "ADMINS" }],
    }),
    removeInstanceAdmin: build.mutation<null, string>({
      query: (userId) => ({ url: `/admin/instance-admins/${encodeURIComponent(userId)}`, method: "DELETE" }),
      invalidatesTags: [{ type: "Security", id: "ADMINS" }, "Me"],
    }),
  }),
});

export const {
  useSetupStatusQuery,
  useAddMemberMutation,
  useSetMemberRoleMutation,
  useRemoveMemberByIdMutation,
  useMemberResetLinkMutation,
  useMyInvitationsQuery,
  useSaveProfileMutation,
  useUploadAvatarMutation,
  useRemoveAvatarMutation,
  useChangeEmailWithPasswordMutation,
  useSessionsQuery,
  useRevokeSessionMutation,
  useRevokeOtherSessionsMutation,
  useWorkspacesQuery,
  useRenameWorkspaceMutation,
  useTransferOwnershipMutation,
  useDeleteWorkspaceMutation,
  useInstanceAdminsQuery,
  useAddInstanceAdminMutation,
  useRemoveInstanceAdminMutation,
} = peopleApi;
