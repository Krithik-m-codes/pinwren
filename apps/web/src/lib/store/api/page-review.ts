import { api } from "./index";
import { LIST } from "./base";
import type { PageLink } from "./feedback";

/**
 * Page Review (widget area, wave-5 contract §3.3): a short-lived re-pin link that opens the widget on the item's
 * page in re-pin mode, and re-grouping a project's pages after its URL rules changed.
 */
export const pageReviewApi = api.injectEndpoints({
  endpoints: (build) => ({
    repinLink: build.mutation<PageLink, string>({
      query: (id) => ({ url: `/feedback/${id}/page-link`, method: "POST", body: { repin: true } }),
    }),
    regroupPages: build.mutation<{ merged: number }, string>({
      query: (projectId) => ({ url: `/projects/${projectId}/pages/regroup`, method: "POST", body: {} }),
      // Items move between pages: every feedback list (Page Review groups by page URL) refetches.
      invalidatesTags: [{ type: "Feedback", id: LIST }],
    }),
  }),
});

export const { useRepinLinkMutation, useRegroupPagesMutation } = pageReviewApi;
