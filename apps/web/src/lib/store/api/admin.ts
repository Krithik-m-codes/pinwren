import type { EmailTemplateKey } from "@pinwren/core";
import type {
  EmailSettings,
  EmailTemplate,
  EmailTestResult,
  LicenseInfo,
  RenderedEmail,
  SecuritySettings,
  Webhook,
  WebhookDelivery,
  WebhookEvent,
  WebhookKind,
} from "@/lib/api";
import { LIST, fulfilled } from "./base";
import { roundsApi } from "./rounds";

export type WebhookCreate = {
  name?: string;
  url: string;
  kind: WebhookKind;
  events: WebhookEvent[];
  projectId?: string | null;
};
export type WebhookPatch = Partial<Pick<Webhook, "active" | "events" | "projectId" | "name">>;
export type UpdateCheckResult = { checked: boolean; reason?: string; state?: SecuritySettings["update"] };
type Draft = { subject?: string; body?: string };

/** Workspace integrations (webhooks) and instance administration: email, templates, security, licence. */
export const adminApi = roundsApi.injectEndpoints({
  endpoints: (build) => ({
    webhooks: build.query<{ webhooks: Webhook[] }, undefined>({
      query: () => "/webhooks",
      providesTags: [{ type: "Webhook", id: LIST }],
    }),
    webhook: build.query<{ webhook: Webhook }, string>({
      query: (id) => `/webhooks/${id}`,
      providesTags: (_r, _e, id) => [{ type: "Webhook", id }],
    }),
    createWebhook: build.mutation<{ webhook: Webhook; secret: string | null }, WebhookCreate>({
      query: (body) => ({ url: "/webhooks", method: "POST", body }),
      invalidatesTags: [{ type: "Webhook", id: LIST }],
    }),
    updateWebhook: build.mutation<{ webhook: Webhook }, { id: string; patch: WebhookPatch }>({
      query: ({ id, patch }) => ({ url: `/webhooks/${id}`, method: "PATCH", body: patch }),
      async onQueryStarted({ id }, { dispatch, queryFulfilled }) {
        const data = await fulfilled(queryFulfilled);
        if (data === null) return;
        void dispatch(adminApi.util.upsertQueryData("webhook", id, data));
      },
      invalidatesTags: [{ type: "Webhook", id: LIST }],
    }),
    testWebhook: build.mutation<{ delivery: WebhookDelivery }, string>({
      query: (id) => ({ url: `/webhooks/${id}/test`, method: "POST" }),
      invalidatesTags: (_r, _e, id) => [{ type: "Delivery", id }],
    }),
    rotateWebhookSecret: build.mutation<{ secret: string }, string>({
      query: (id) => ({ url: `/webhooks/${id}/rotate-secret`, method: "POST" }),
    }),
    deleteWebhook: build.mutation<unknown, string>({
      query: (id) => ({ url: `/webhooks/${id}`, method: "DELETE" }),
      invalidatesTags: [{ type: "Webhook", id: LIST }],
    }),
    deliveries: build.query<{ deliveries: WebhookDelivery[] }, string>({
      query: (webhookId) => `/webhooks/${webhookId}/deliveries?limit=50`,
      providesTags: (_r, _e, id) => [{ type: "Delivery", id }],
    }),
    redeliver: build.mutation<{ delivery: WebhookDelivery }, { deliveryId: string; webhookId: string }>({
      query: ({ deliveryId }) => ({ url: `/webhook-deliveries/${deliveryId}/redeliver`, method: "POST" }),
      invalidatesTags: (_r, _e, { webhookId }) => [{ type: "Delivery", id: webhookId }],
    }),

    emailSettings: build.query<{ email: EmailSettings }, undefined>({
      query: () => "/admin/settings/email",
      providesTags: ["EmailSettings"],
    }),
    updateEmailSettings: build.mutation<{ email: EmailSettings }, Record<string, unknown>>({
      query: (body) => ({ url: "/admin/settings/email", method: "PATCH", body }),
      async onQueryStarted(_b, { dispatch, queryFulfilled }) {
        const data = await fulfilled(queryFulfilled);
        if (data === null) return;
        void dispatch(adminApi.util.upsertQueryData("emailSettings", undefined, data));
      },
    }),
    sendTestEmail: build.mutation<EmailTestResult, { to?: string }>({
      query: (body) => ({ url: "/admin/settings/email/test", method: "POST", body }),
    }),

    emailTemplates: build.query<{ templates: EmailTemplate[] }, undefined>({
      query: () => "/email-templates",
      providesTags: [{ type: "EmailTemplate", id: LIST }],
    }),
    /** Rendered by the server exactly as it would be sent (variables escaped, Markdown sanitised). */
    previewEmailTemplate: build.query<{ preview: RenderedEmail }, { key: EmailTemplateKey; draft: Draft }>({
      query: ({ key, draft }) => ({ url: `/email-templates/${key}/preview`, method: "POST", body: draft }),
      keepUnusedDataFor: 30,
    }),
    saveEmailTemplate: build.mutation<
      { template: EmailTemplate },
      { key: EmailTemplateKey; draft: Required<Draft> }
    >({
      query: ({ key, draft }) => ({ url: `/email-templates/${key}`, method: "PUT", body: draft }),
      async onQueryStarted(_a, { dispatch, queryFulfilled }) {
        const data = await fulfilled(queryFulfilled);
        if (data === null) return;
        dispatch(
          adminApi.util.updateQueryData("emailTemplates", undefined, (d) => {
            d.templates = d.templates.map((t) => (t.key === data.template.key ? data.template : t));
          }),
        );
      },
    }),
    resetEmailTemplate: build.mutation<{ template: EmailTemplate }, EmailTemplateKey>({
      query: (key) => ({ url: `/email-templates/${key}`, method: "DELETE" }),
      async onQueryStarted(_k, { dispatch, queryFulfilled }) {
        const data = await fulfilled(queryFulfilled);
        if (data === null) return;
        dispatch(
          adminApi.util.updateQueryData("emailTemplates", undefined, (d) => {
            d.templates = d.templates.map((t) => (t.key === data.template.key ? data.template : t));
          }),
        );
      },
    }),
    testEmailTemplate: build.mutation<EmailTestResult, { key: EmailTemplateKey; draft: Draft }>({
      query: ({ key, draft }) => ({ url: `/email-templates/${key}/test`, method: "POST", body: draft }),
    }),

    securitySettings: build.query<{ security: SecuritySettings }, undefined>({
      query: () => "/admin/settings/security",
      providesTags: ["Security"],
    }),
    updateSecuritySettings: build.mutation<
      { security: SecuritySettings },
      Partial<Pick<SecuritySettings, "sessionDays" | "updateCheck">>
    >({
      query: (body) => ({ url: "/admin/settings/security", method: "PATCH", body }),
      async onQueryStarted(_b, { dispatch, queryFulfilled }) {
        const data = await fulfilled(queryFulfilled);
        if (data === null) return;
        void dispatch(adminApi.util.upsertQueryData("securitySettings", undefined, data));
      },
    }),
    runUpdateCheck: build.mutation<UpdateCheckResult, undefined>({
      query: () => ({ url: "/admin/update-check", method: "POST" }),
      invalidatesTags: ["Security", "Me"],
    }),

    /** Settings › Licence (instance admins, F-098). */
    license: build.query<{ license: LicenseInfo }, undefined>({
      query: () => "/admin/license",
      providesTags: ["License"],
    }),
    uploadLicense: build.mutation<{ license: LicenseInfo }, string>({
      query: (license) => ({ url: "/admin/license", method: "POST", body: { license } }),
      async onQueryStarted(_l, { dispatch, queryFulfilled }) {
        const data = await fulfilled(queryFulfilled);
        if (data === null) return;
        void dispatch(adminApi.util.upsertQueryData("license", undefined, data));
      },
      invalidatesTags: ["Entitlements"],
    }),
    removeLicense: build.mutation<{ license: LicenseInfo }, undefined>({
      query: () => ({ url: "/admin/license", method: "DELETE" }),
      async onQueryStarted(_v, { dispatch, queryFulfilled }) {
        const data = await fulfilled(queryFulfilled);
        if (data === null) return;
        void dispatch(adminApi.util.upsertQueryData("license", undefined, data));
      },
      invalidatesTags: ["Entitlements"],
    }),
  }),
});
