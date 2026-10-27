import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Logo } from "@/components/logo";
import { BrowserLocale } from "@/lib/i18n/browser-locale";
import { Skeleton } from "@/components/ui/skeleton";
import { getSession } from "@/lib/server/session";
import { OnboardingForm } from "./onboarding-form";
import { PendingInvitations } from "./pending-invitations";

export const metadata: Metadata = { title: "Set up your workspace" };

export default function OnboardingPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center px-4 py-12">
      <BrowserLocale />
      <Logo className="mb-8" />
      <div className="w-full max-w-md">
        <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
          <SignedIn />
        </Suspense>
      </div>
    </div>
  );
}

/**
 * Only for someone signed in (checked on the server); the form itself is a client component. Invitations
 * waiting for their address come first (wave-5 §3.1).
 */
async function SignedIn() {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=%2Fonboarding");
  return (
    <>
      <PendingInvitations />
      <OnboardingForm />
    </>
  );
}
