import type { CustomFieldDef, CustomFieldInputRaw } from "@pinwren/core";
import { automationApi } from "./automation";
import { LIST } from "./base";

/** Custom form fields of a project (ADR 0029): read by everyone who sees the project, saved by Admins. */
export const customFieldsApi = automationApi.injectEndpoints({
  endpoints: (build) => ({
    customFields: build.query<{ fields: CustomFieldDef[] }, string>({
      query: (projectId) => `/projects/${projectId}/custom-fields`,
      providesTags: (_r, _e, projectId) => [
        { type: "CustomField", id: projectId },
        { type: "CustomField", id: LIST },
      ],
    }),
    /** Replace the whole form: fields missing from `fields` are deleted together with their answers. */
    saveCustomFields: build.mutation<
      { fields: CustomFieldDef[] },
      { projectId: string; fields: CustomFieldInputRaw[] }
    >({
      query: ({ projectId, fields }) => ({
        url: `/projects/${projectId}/custom-fields`,
        method: "PUT",
        body: { fields },
      }),
      // Removed fields take their answers with them, so open items and lists reload.
      invalidatesTags: (_r, _e, { projectId }) => [
        { type: "CustomField", id: projectId },
        { type: "Feedback", id: LIST },
        "Feedback",
      ],
    }),
  }),
});
