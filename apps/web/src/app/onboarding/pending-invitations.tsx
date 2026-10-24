"use client";

import { Users } from "lucide-react";
import { useState } from "react";
import { timeAgo } from "@/components/feedback-meta";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";
import { useMyInvitationsQuery } from "@/lib/store/api/people";

const ROLE_LABEL = { admin: "Admin", editor: "Editor", viewer: "Viewer" } as const;

/**
 * Someone invited this address (they may have signed up on /sign-up instead of from the email's link):
 * offer to join before creating a workspace of their own.
 */
export function PendingInvitations() {
  const { data, isLoading } = useMyInvitationsQuery(undefined);
  const [joining, setJoining] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (isLoading) return <Skeleton className="mb-4 h-28 rounded-xl" />;
  // Nothing waiting (or the lookup failed): workspace creation below is the way on either way.
  if (!data?.invitations.length) return null;

  async function join(id: string, organizationId: string) {
    setJoining(id);
    setError(null);
    const { error } = await authClient.organization.acceptInvitation({ invitationId: id });
    if (error) {
      setJoining(null);
      setError(error.message ?? "Couldn't accept the invitation");
      return;
    }
    await authClient.organization.setActive({ organizationId });
    // A full load: the app's server components read the new active workspace from the session.
    window.location.assign(new URL("/inbox", window.location.href).href);
  }

  return (
    <Card className="mb-4" data-testid="pending-invitations">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Users className="size-5 text-muted-foreground" /> You&apos;ve been invited
        </CardTitle>
        <CardDescription>Join your team&apos;s workspace, or set up your own below.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        <ul className="-my-1 divide-y" aria-label="Invitations">
          {data.invitations.map((inv) => (
            <li key={inv.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{inv.organizationName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {ROLE_LABEL[inv.appRole]}
                  {inv.inviterName && ` · invited by ${inv.inviterName}`} · expires {timeAgo(inv.expiresAt)}
                </p>
              </div>
              <Button size="sm" disabled={!!joining} onClick={() => void join(inv.id, inv.organizationId)}>
                {joining === inv.id ? "Joining…" : `Join ${inv.organizationName}`}
              </Button>
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
