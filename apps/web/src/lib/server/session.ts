import "server-only";
import { getAuth, firstOrganizationFor } from "@pinwren/api";
import { cacheLife } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { MeResponse } from "@/lib/api";
import { serverApi } from "./api";

// Data access layer for the session (Next.js "Authentication with Cache Components"). Every read sits
// behind a <Suspense> boundary; the API still authorises every request itself — this decides what to
// render and where to send people.

export type SessionUser = { id: string; name: string; email: string; image: string | null };
export type Session = { user: SessionUser; activeOrgId: string | null };

/**
 * The Better Auth session, narrowed. `use cache: private` lets the client router keep the result for its
 * stale time (so per-session navigations are instant) without ever storing it on the server.
 */
export async function getSession(): Promise<Session | null> {
  "use cache: private";
  cacheLife({ stale: 60 });
  const s = await getAuth().api.getSession({ headers: await headers() });
  if (!s) return null;
  return {
    user: { id: s.user.id, name: s.user.name, email: s.user.email, image: s.user.image ?? null },
    activeOrgId: s.session.activeOrganizationId ?? null,
  };
}

/** A workspace the person belongs to (the first they joined), when none is active. */

export type Viewer =
  | { kind: "member"; me: MeResponse; session: Session }
  /** Signed in, with a workspace, but none active yet: the client activates it and refreshes. */
  | { kind: "activate"; orgId: string };

/**
 * The signed-in member of the active workspace (`/api/me`, the same check the API makes). No session →
 * sign-in; no workspace at all → onboarding.
 */
export async function requireViewer(): Promise<Viewer> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const me = await serverApi<MeResponse>("/me");
  if (me.ok) return { kind: "member", me: me.data, session };
  if (me.status === 401) redirect("/sign-in");
  // NO_ACTIVE_ORG (409) or NOT_A_MEMBER (403, removed from the active one): pick another workspace.
  const orgId = await firstOrganizationFor(session.user.id);
  if (!orgId || orgId === session.activeOrgId) redirect("/onboarding");
  return { kind: "activate", orgId };
}
