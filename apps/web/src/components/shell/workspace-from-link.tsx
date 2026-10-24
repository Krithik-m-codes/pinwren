"use client";

import { Lock } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { here } from "@/lib/routes";

/**
 * Email and chat links carry the item's workspace (`/inbox?org=<orgId>&item=<id>`, wave-5 §3.1). When it
 * isn't the active one, switch to it (Better Auth refuses anyone who isn't a member) and load the same
 * address again without `org`; otherwise say the item belongs to a workspace you can't open.
 */
export function WorkspaceFromLink({ orgId }: { orgId: string }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const target = params.get("org");
  const [denied, setDenied] = useState<string | null>(null);
  const switching = !!target && target !== orgId && denied !== target;

  useEffect(() => {
    if (!target || target === orgId) return;
    let cancelled = false;
    void authClient.organization.setActive({ organizationId: target }).then(({ error }) => {
      if (cancelled) return;
      if (error) {
        setDenied(target);
        return;
      }
      const url = new URL(window.location.href);
      url.searchParams.delete("org");
      // A full load: the store, the router cache and the server components belong to the old workspace.
      window.location.replace(url.href);
    });
    return () => {
      cancelled = true;
    };
  }, [target, orgId]);

  if (switching) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm" aria-busy>
        <div className="grid justify-items-center gap-3 text-sm text-muted-foreground">
          <Logo className="animate-pulse opacity-60" />
          Opening the item&apos;s workspace…
        </div>
      </div>
    );
  }
  if (!target || denied !== target) return null;
  return (
    <div
      role="alert"
      data-testid="workspace-denied"
      className="flex flex-wrap items-center gap-2 border-b bg-muted px-4 py-2 text-sm"
    >
      <Lock className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        You don&apos;t have access to this item&apos;s workspace. Ask one of its Admins to add you.
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          const next = new URLSearchParams(params);
          next.delete("org");
          next.delete("item");
          router.replace(here(pathname, next));
        }}
      >
        Dismiss
      </Button>
    </div>
  );
}
