import type { CustomRole, CustomRoleCreate, CustomRoleList, CustomRoleUpdate } from "@pinwren/core";
import { LIST } from "./base";
import { auditApi } from "./audit";

/**
 * Custom roles (F-093, ADR 0045). Changing a role changes what its members may do, so the member list and
 * "me" are refreshed with it.
 */
export const rolesApi = auditApi.injectEndpoints({
  endpoints: (build) => ({
    roles: build.query<CustomRoleList, undefined>({
      query: () => "/roles",
      providesTags: [{ type: "Role", id: LIST }],
    }),
    createRole: build.mutation<{ role: CustomRole }, CustomRoleCreate>({
      query: (body) => ({ url: "/roles", method: "POST", body }),
      invalidatesTags: [{ type: "Role", id: LIST }],
    }),
    updateRole: build.mutation<{ role: CustomRole }, { id: string } & CustomRoleUpdate>({
      query: ({ id, ...body }) => ({ url: `/roles/${encodeURIComponent(id)}`, method: "PATCH", body }),
      invalidatesTags: [{ type: "Role", id: LIST }, { type: "Member", id: LIST }, "Me"],
    }),
    deleteRole: build.mutation<null, string>({
      query: (id) => ({ url: `/roles/${encodeURIComponent(id)}`, method: "DELETE" }),
      invalidatesTags: [{ type: "Role", id: LIST }],
    }),
  }),
});

export const { useRolesQuery, useCreateRoleMutation, useUpdateRoleMutation, useDeleteRoleMutation } =
  rolesApi;
