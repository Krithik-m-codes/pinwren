import { customFieldsApi } from "./custom-fields";

/**
 * The dashboard's RTK Query API with every endpoint (base → account → projects → feedback → rounds →
 * admin; each module injects into the previous one). Import hooks from here.
 */
export const api = customFieldsApi;

export const {
  // account
  useMeQuery,
  useEntitlementsQuery,
  useBillingQuery,
  useStartCheckoutMutation,
  useOpenBillingPortalMutation,
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
  useCheckInstallMutation,
  useLazyActionSecretQuery,
  useRotateActionSecretMutation,
  useLazyIdentitySecretQuery,
  useRotateIdentitySecretMutation,
  useTrackersQuery,
  useCreateTrackerMutation,
  useUpdateTrackerMutation,
  useTestTrackerMutation,
  useRegisterTrackerWebhookMutation,
  useRestartTrackerHandshakeMutation,
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
  useAgentBriefQuery,
  useReproTestQuery,
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
  useTranslateFeedbackMutation,
  useApplyAiTriageMutation,
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
  useAiSettingsQuery,
  useUpdateAiSettingsMutation,
  useTestAiSettingsMutation,
  useProjectAiQuery,
  useUpdateProjectAiMutation,
  // automation + AI label suggestions
  useAutomationRulesQuery,
  useCreateAutomationRuleMutation,
  useUpdateAutomationRuleMutation,
  useDeleteAutomationRuleMutation,
  useTestAutomationRuleMutation,
  useAutomationRunsQuery,
  useAiLabelSuggestionsQuery,
  useDecideLabelSuggestionMutation,
  useBulkAiLabelsMutation,
  // custom fields (form builder)
  useCustomFieldsQuery,
  useSaveCustomFieldsMutation,
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
export type {
  AutomationRule,
  AutomationRun,
  AutomationRunResult,
  AutomationTestResult,
  LabelSuggestion,
} from "./automation";

// Releases and regressions (ADR 0036). Injected into the same API; its hooks are exported from its own module.
export {
  useDeleteReleaseMutation,
  useRecordReleaseMutation,
  useReleasesQuery,
  useUpdateReleaseMutation,
} from "./releases";
export type { RecordedRelease, Release } from "./releases";
