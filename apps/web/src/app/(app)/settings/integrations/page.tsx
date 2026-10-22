import type { Metadata } from "next";
import { Suspense } from "react";
import { IntegrationsSettings } from "./integrations-settings";

export const metadata: Metadata = { title: "Integrations" };

export default function IntegrationsPage() {
  return (
    <Suspense>
      <IntegrationsSettings />
    </Suspense>
  );
}
