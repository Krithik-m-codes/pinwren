import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Logo } from "@/components/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { getSession } from "@/lib/server/session";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Set up your workspace" };

export default function OnboardingPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center px-4 py-12">
      <Logo className="mb-8" />
      <div className="w-full max-w-md">
        <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
          <SignedIn />
        </Suspense>
      </div>
    </div>
  );
}

/** Only for someone signed in (checked on the server); the form itself is a client component. */
async function SignedIn() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return <OnboardingForm />;
}
