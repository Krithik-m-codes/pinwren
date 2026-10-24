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
  useInvitationsQuery,
  useInviteMemberMutation,
  useCancelInvitationMutation,
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
  useListFeedbackInfiniteQuery,
  useProjectFeedbackQuery,
  useFeedbackDetailQuery,
  useFeedbackDetailsQuery,
  useUpdateFeedbackMutation,
  useDeleteFeedbackMutation,
  useRestoreFeedbackMutation,
  usePurgeFeedbackMutation,
  useLazyReproductionQuery,
  useWatchFeedbackMutation,
  usePageLinkMutation,
  useMarkItemNotificationsReadMutation,
  useLabelsQuery,
  useCreateLabelMutation,
  useUpdateLabelMutation,
  useDeleteLabelMutation,
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

/**
 * Server-fetched data a client subtree starts with (see `HydrateQueries`): an endpoint, its argument and the
 * cached value (`{ pages, pageParams }` for the infinite `listFeedback`). Spelled out because RTK's own
 * `upsertQueryEntries` parameter type collapses to `never` once the API has an infinite query.
 */
export type HydrationEntries = {
  endpointName: keyof typeof api.endpoints;
  arg: unknown;
  value: unknown;
}[];

export { type ApiError, errorMessage, isApiError, isForbidden } from "./base";
