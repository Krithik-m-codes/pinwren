"use client";

import { useSetupStatus } from "../(auth)/auth-shared";
import { Skeleton } from "@/components/ui/skeleton";
import { CloudOnboarding } from "./cloud-onboarding";
import { OnboardingForm } from "./onboarding-form";
import { PendingInvitations } from "./pending-invitations";

/** Cloud accounts arrive with a workspace and take the guided steps; a self-hosted server asks for one. */
export function OnboardingGate() {
  const setup = useSetupStatus();
  if (!setup.data) return <Skeleton className="h-96 rounded-xl" />;
  if (setup.data.cloud) return <CloudOnboarding />;
  return (
    <>
      <PendingInvitations />
      <OnboardingForm />
    </>
  );
}
