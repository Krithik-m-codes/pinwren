import { adminApi } from "./admin";

/**
 * The dashboard's RTK Query API with every endpoint (base → account → projects → feedback → rounds →
 * admin; each module injects into the previous one). Import hooks from here.
 */
export const api = adminApi;

export const {
  // account
  useMeQuery,
  useEntitlementsQuery,
  useBrandingQuery,
  useUpdateBrandingMutation,
  useUploadBrandAssetMutation,
  useMembersQuery,
  useFullOrgQuery,
  useInvitationsQuery,
  useInviteMemberMutation,
  useCancelInvitationMutation,
  useUpdateMemberRoleMutation,
  useRemoveMemberMutation,
  useUpdateProfileMutation,
  useNotificationsQuery,
  useMarkNotificationsReadMutation,
  useNotificationPrefsQuery,
  useUpdateNotificationPrefsMutation,
  useTokensQuery,
  useCreateTokenMutation,
  useRevokeTokenMutation,
  // projects
  useProjectsQuery,
  useProjectQuery,
  useCreateProjectMutation,
  useUpdateProjectMutation,
  useRotateProjectKeyMutation,
  useLazyActionSecretQuery,
  useRotateActionSecretMutation,
  useLazyIdentitySecretQuery,
  useRotateIdentitySecretMutation,
  useTrackersQuery,
  useCreateTrackerMutation,
  useUpdateTrackerMutation,
  useTestTrackerMutation,
  useLazyTrackerWebhookSecretQuery,
  useDeleteTrackerMutation,
  // feedback
  useListFeedbackQuery,
  useProjectFeedbackQuery,
  useFeedbackDetailQuery,
  useFeedbackDetailsQuery,
  useThumbnailQuery,
  useUpdateFeedbackMutation,
  useDeleteFeedbackMutation,
  useAddCommentMutation,
  useEditCommentMutation,
  useDeleteCommentMutation,
  useRunPanelActionMutation,
  useCreateIssueMutation,
  // rounds + views
  useRoundsQuery,
  useCreateRoundMutation,
  useUpdateRoundMutation,
  useDeleteRoundMutation,
  useViewsQuery,
  useCreateViewMutation,
  useUpdateViewMutation,
  useDeleteViewMutation,
  // admin
  useWebhooksQuery,
  useWebhookQuery,
  useCreateWebhookMutation,
  useUpdateWebhookMutation,
  useTestWebhookMutation,
  useRotateWebhookSecretMutation,
  useDeleteWebhookMutation,
  useDeliveriesQuery,
  useRedeliverMutation,
  useEmailSettingsQuery,
  useUpdateEmailSettingsMutation,
  useSendTestEmailMutation,
  useEmailTemplatesQuery,
  usePreviewEmailTemplateQuery,
  useSaveEmailTemplateMutation,
  useResetEmailTemplateMutation,
  useTestEmailTemplateMutation,
  useSecuritySettingsQuery,
  useUpdateSecuritySettingsMutation,
  useRunUpdateCheckMutation,
  useLicenseQuery,
  useUploadLicenseMutation,
  useRemoveLicenseMutation,
} = api;

/** Server-fetched data a client subtree starts with (see `HydrateQueries`). */
export type HydrationEntries = Parameters<typeof api.util.upsertQueryEntries>[0];

export { type ApiError, errorMessage, isApiError, isForbidden } from "./base";
