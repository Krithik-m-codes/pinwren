import type { Metadata } from "next";
import { Suspense } from "react";
import { IntegrationsSettings } from "./integrations-settings";
import { SlackSettings } from "./slack-settings";

export const metadata: Metadata = { title: "Integrations" };

export default function IntegrationsPage() {
  return (
    <Suspense>
      <div className="grid gap-6">
        <SlackSettings />
        <IntegrationsSettings />
      </div>
    </Suspense>
  );
}
