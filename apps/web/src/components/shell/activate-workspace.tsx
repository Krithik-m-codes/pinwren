"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Logo } from "@/components/logo";
import { authClient } from "@/lib/auth-client";

/**
 * Signed in with a workspace but none active (first sign-in after joining, or removed from the active
 * one): make it active — a cookie only the auth client can set — then render the screen again.
 */
export function ActivateWorkspace({ orgId }: { orgId: string }) {
  const router = useRouter();
  useEffect(() => {
    void authClient.organization.setActive({ organizationId: orgId }).then(() => router.refresh());
  }, [orgId, router]);
  return (
    <div className="grid min-h-[60svh] place-items-center" aria-busy>
      <Logo className="animate-pulse opacity-60" />
    </div>
  );
}
