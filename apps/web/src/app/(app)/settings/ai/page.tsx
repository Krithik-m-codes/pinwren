import type { Metadata } from "next";
import { Suspense } from "react";
import { AiSettings } from "./ai-settings";

export const metadata: Metadata = { title: "AI Settings" };

export default function AiSettingsPage() {
  return (
    <Suspense>
      <AiSettings />
    </Suspense>
  );
}
