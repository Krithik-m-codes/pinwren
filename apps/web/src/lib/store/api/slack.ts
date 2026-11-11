import type {
  SlackConnectionUpdate,
  SlackRouteCreate,
  SlackRouteEvent,
  SlackRouteUpdate,
  SlackTest,
} from "@pinwren/core";
import { adminApi } from "./admin";

// Interactive Slack (F-071): the app's connection, channel routes, member mapping and the test button.
// Own module with its own hooks (imported from here) so the shared `api` chain stays untouched.

export type SlackConnection = {
  id: string;
  teamId: string;
  teamName: string;
  teamUrl: string | null;
  botUserId: string | null;
  /** Last four characters of the bot token; the token itself is never returned. */
  tokenHint: string;
  active: boolean;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SlackRoute = {
  id: string;
  /** null = every project. */
  projectId: string | null;
  channelId: string;
  channelName: string | null;
  events: SlackRouteEvent[];
};

export type SlackMember = {
  userId: string;
  name: string;
  email: string;
  role: string;
  linked: boolean;
  linkId: string | null;
  slackUserId: string | null;
  source: "email" | "manual" | null;
};

export type SlackState = {
  connection: SlackConnection | null;
  routes: SlackRoute[];
  members: SlackMember[];
  requestUrls: { interactivity: string; commands: string };
  scopes: { scope: string; why: string }[];
  /** A Slack app manifest (JSON) with shortcuts, command, scopes and URLs filled in. */
  manifest: string;
};

export type SlackChannel = { id: string; name: string; isMember: boolean; isPrivate: boolean };
export type SlackTestResult = { ok: boolean; message: string; channelId?: string | null };

const TAG = { type: "Webhook" as const, id: "slack" };

export const slackApi = adminApi.injectEndpoints({
  endpoints: (build) => ({
    slackState: build.query<SlackState, undefined>({
      query: () => "/slack",
      providesTags: [TAG],
    }),
    connectSlack: build.mutation<{ connection: SlackConnection }, SlackConnectionUpdate>({
      query: (body) => ({ url: "/slack", method: "PUT", body }),
      invalidatesTags: [TAG],
    }),
    disconnectSlack: build.mutation<unknown, undefined>({
      query: () => ({ url: "/slack", method: "DELETE" }),
      invalidatesTags: [TAG],
    }),
    slackChannels: build.query<{ channels: SlackChannel[]; error: string | null }, undefined>({
      query: () => "/slack/channels",
      providesTags: [TAG],
    }),
    createSlackRoute: build.mutation<{ route: SlackRoute }, SlackRouteCreate>({
      query: (body) => ({ url: "/slack/routes", method: "POST", body }),
      invalidatesTags: [TAG],
    }),
    updateSlackRoute: build.mutation<{ route: SlackRoute }, { id: string; patch: SlackRouteUpdate }>({
      query: ({ id, patch }) => ({ url: `/slack/routes/${id}`, method: "PATCH", body: patch }),
      invalidatesTags: [TAG],
    }),
    deleteSlackRoute: build.mutation<unknown, string>({
      query: (id) => ({ url: `/slack/routes/${id}`, method: "DELETE" }),
      invalidatesTags: [TAG],
    }),
    testSlack: build.mutation<SlackTestResult, SlackTest>({
      query: (body) => ({ url: "/slack/test", method: "POST", body }),
      invalidatesTags: [TAG],
    }),
    syncSlackMembers: build.mutation<{ linked: number; scanned: number }, undefined>({
      query: () => ({ url: "/slack/sync-members", method: "POST" }),
      invalidatesTags: [TAG],
    }),
    unlinkSlackUser: build.mutation<unknown, string>({
      query: (id) => ({ url: `/slack/links/${id}`, method: "DELETE" }),
      invalidatesTags: [TAG],
    }),
    claimSlackLink: build.mutation<{ linked: boolean; teamName: string }, string>({
      query: (token) => ({ url: "/slack/link", method: "POST", body: { token } }),
      invalidatesTags: [TAG],
    }),
  }),
});

export const {
  useSlackStateQuery,
  useConnectSlackMutation,
  useDisconnectSlackMutation,
  useSlackChannelsQuery,
  useCreateSlackRouteMutation,
  useUpdateSlackRouteMutation,
  useDeleteSlackRouteMutation,
  useTestSlackMutation,
  useSyncSlackMembersMutation,
  useUnlinkSlackUserMutation,
  useClaimSlackLinkMutation,
} = slackApi;
