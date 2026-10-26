import type {
  AppLocale,
  EmailDeliveryStatus,
  EmailDigestFrequency,
  EmailSettingsUpdate,
  ProjectNotifications,
  ProjectNotificationsUpdate,
} from "@pinwren/core";
import type { EmailTestResult, NotificationItem } from "@/lib/api";
import { fulfilled } from "./base";
import { api } from "./index";

// Notifications and email (wave-5 contract §3.2): the notifications page, personal email settings
// (digest, pause), Settings › Notifications › General / Reporter per project, and the SMTP delivery log.
// Injected into the dashboard's one API, so tags and the store are shared; hooks are exported from here.

export type NotificationsPage = { items: NotificationItem[]; unreadCount: number; nextCursor: string | null };
export type NotificationsPageArgs = { unread: boolean; projectId: string | null };
export type UserPreferences = {
  emailDigest: EmailDigestFrequency;
  emailPaused: boolean;
  /** The dashboard language; null = follow the browser. */
  locale: AppLocale | null;
};
export type ProjectNotificationsResponse = {
  notifications: ProjectNotifications;
  members: { userId: string; name: string; email: string }[];
};
export type EmailDelivery = {
  id: string;
  to: string;
  templateKey: string;
  subject: string;
  status: EmailDeliveryStatus;
  error: string | null;
  attempts: number;
  createdAt: string;
  sentAt: string | null;
};
export type EmailDeliveries = { items: EmailDelivery[]; skippedNotConfigured: number };

/** `/notifications` query string for one page of the notifications page. */
export function notificationsQueryString(
  args: NotificationsPageArgs,
  before: string | null,
  limit = 30,
): string {
  const sp = new URLSearchParams({ limit: String(limit) });
  if (args.unread) sp.set("unread", "1");
  if (args.projectId) sp.set("projectId", args.projectId);
  if (before) sp.set("before", before);
  return sp.toString();
}

export const notificationsApi = api.injectEndpoints({
  endpoints: (build) => ({
    /** The notifications page: All / Unread, per project, newest first, a page at a time. */
    notificationsPage: build.infiniteQuery<NotificationsPage, NotificationsPageArgs, string | null>({
      infiniteQueryOptions: {
        initialPageParam: null,
        getNextPageParam: (last) => last.nextCursor,
      },
      query: ({ queryArg, pageParam }) => `/notifications?${notificationsQueryString(queryArg, pageParam)}`,
      providesTags: ["Notification"],
    }),

    userPreferences: build.query<{ preferences: UserPreferences }, undefined>({
      query: () => "/me/preferences",
      providesTags: [{ type: "NotificationPrefs", id: "ME" }],
    }),
    updateUserPreferences: build.mutation<{ preferences: UserPreferences }, Partial<UserPreferences>>({
      query: (body) => ({ url: "/me/preferences", method: "PATCH", body }),
      async onQueryStarted(body, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          notificationsApi.util.updateQueryData("userPreferences", undefined, (d) => {
            Object.assign(d.preferences, body);
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          patch.undo();
        }
      },
    }),

    projectNotifications: build.query<ProjectNotificationsResponse, string>({
      query: (projectId) => `/projects/${projectId}/notifications`,
      providesTags: (_r, _e, projectId) => [{ type: "NotificationPrefs", id: `project:${projectId}` }],
    }),
    updateProjectNotifications: build.mutation<
      { notifications: ProjectNotifications },
      { projectId: string; patch: ProjectNotificationsUpdate }
    >({
      query: ({ projectId, patch }) => ({
        url: `/projects/${projectId}/notifications`,
        method: "PATCH",
        body: patch,
      }),
      async onQueryStarted({ projectId }, { dispatch, queryFulfilled }) {
        const data = await fulfilled(queryFulfilled);
        if (data === null) return;
        dispatch(
          notificationsApi.util.updateQueryData("projectNotifications", projectId, (d) => {
            d.notifications = data.notifications;
          }),
        );
      },
      // The project payload carries `notifyReporter` too (Privacy tab).
      invalidatesTags: (_r, _e, { projectId }) => [{ type: "Project", id: projectId }],
    }),

    /** Test SMTP with the form's unsaved values (omitted fields: the saved ones). */
    testSmtp: build.mutation<EmailTestResult, { to?: string; config?: EmailSettingsUpdate }>({
      query: (body) => ({ url: "/admin/settings/email/test", method: "POST", body }),
      invalidatesTags: [{ type: "EmailSettings", id: "DELIVERIES" }],
    }),
    emailDeliveries: build.query<EmailDeliveries, EmailDeliveryStatus | null>({
      query: (status) => `/admin/settings/email/deliveries?limit=50${status ? `&status=${status}` : ""}`,
      providesTags: [{ type: "EmailSettings", id: "DELIVERIES" }],
    }),
    resendDelivery: build.mutation<{ delivery: EmailDelivery }, string>({
      query: (id) => ({ url: `/admin/settings/email/deliveries/${id}/resend`, method: "POST" }),
      invalidatesTags: [{ type: "EmailSettings", id: "DELIVERIES" }],
    }),
    resendSkipped: build.mutation<{ queued: number }, undefined>({
      query: () => ({ url: "/admin/settings/email/deliveries/resend-skipped", method: "POST" }),
      invalidatesTags: [{ type: "EmailSettings", id: "DELIVERIES" }],
    }),
  }),
});

export const {
  useNotificationsPageInfiniteQuery,
  useUserPreferencesQuery,
  useUpdateUserPreferencesMutation,
  useProjectNotificationsQuery,
  useUpdateProjectNotificationsMutation,
  useTestSmtpMutation,
  useEmailDeliveriesQuery,
  useResendDeliveryMutation,
  useResendSkippedMutation,
} = notificationsApi;
