import { getAuth } from "@pinwren/api";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getSession } from "@/lib/server/session";
import { Accept, AuthFirst, InvitationProblem } from "./accept-invitation";

export const metadata: Metadata = { title: "Join workspace" };

/**
 * Invitation emails link here (wave-1 §8). The page frame is prerendered; who is signed in and what the
 * invitation says are read on the server and stream in.
 */
export default function AcceptInvitationPage({ params }: PageProps<"/accept-invitation/[id]">) {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <Invitation params={params} />
    </Suspense>
  );
}

async function Invitation({ params }: { params: PageProps<"/accept-invitation/[id]">["params"] }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return <AuthFirst />;
  // Request time only: Better Auth checks the invitation against the clock.
  await connection();
  // Better Auth checks the invitation belongs to the signed-in address and is still pending.
  const found = await getAuth()
    .api.getInvitation({ headers: await headers(), query: { id } })
    .then((inv) => ({ ok: true as const, inv }))
    .catch((e: unknown) => ({
      ok: false as const,
      message: e instanceof Error && e.message ? e.message : "Invitation not found",
    }));
  if (!found.ok) return <InvitationProblem email={session.user.email} message={found.message} />;
  const { inv } = found;
  return (
    <Accept
      id={id}
      email={session.user.email}
      invitation={{
        organizationId: inv.organizationId,
        organizationName: inv.organizationName,
        inviterEmail: inv.inviterEmail,
        email: inv.email,
        role: inv.role,
      }}
    />
  );
}

function CardSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-3 py-6">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-9 w-full" />
      </CardContent>
    </Card>
  );
}
