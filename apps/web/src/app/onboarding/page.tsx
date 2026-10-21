import type { Metadata } from "next";
import { Logo } from "@/components/logo";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Set up your workspace" };

export default function OnboardingPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center px-4 py-12">
      <Logo className="mb-8" />
      <div className="w-full max-w-md">
        <OnboardingForm />
      </div>
    </div>
  );
}
