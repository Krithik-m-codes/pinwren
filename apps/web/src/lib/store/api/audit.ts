import type { AuditListQuery, AuditListResponse } from "@pinwren/core";
import { LIST } from "./base";
import { customFieldsApi } from "./custom-fields";

/** One page of the audit log (cursor from the previous page); filters are the API's. */
export type AuditPageArgs = Omit<AuditListQuery, "limit" | "cursor"> & { cursor?: string | undefined };

/** The audit log (F-092, ADR 0044): read-only, workspace Admins on Business / Enterprise. */
export const auditApi = customFieldsApi.injectEndpoints({
  endpoints: (build) => ({
    auditLog: build.query<AuditListResponse, AuditPageArgs>({
      query: (args) => {
        const q = new URLSearchParams();
        for (const [k, v] of Object.entries(args)) if (v) q.set(k, v);
        return `/audit?${q.toString()}`;
      },
      providesTags: [{ type: "Audit", id: LIST }],
    }),
  }),
});

export const { useAuditLogQuery } = auditApi;
