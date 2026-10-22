"use client";

import { isAdminRole, isViewerRole } from "@/lib/api";
import { useMeQuery, useMembersQuery } from "@/lib/store/api";

/**
 * The signed-in member as the dashboard needs it: id, role and what the role allows. `/api/me` is
 * fetched by the server for the first render (lib/server/session.ts) and seeded into RTK Query, so this
 * never waits on the network after the shell.
 */
export function useViewer() {
  const { data: me } = useMeQuery(undefined);
  const role = me?.role;
  return {
    me,
    userId: me?.user.id,
    role,
    isAdmin: isAdminRole(role),
    /** Viewers read everything; every control that changes something is hidden or read-only. */
    canWrite: !!me && !isViewerRole(role),
    isViewer: isViewerRole(role),
    instanceAdmin: !!me?.instanceAdmin,
  };
}

/** Members of the active workspace, for assignee pickers and avatars. */
export function useMembers() {
  const q = useMembersQuery(undefined);
  return q.data?.members ?? [];
}
