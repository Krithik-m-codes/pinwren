import type { Metadata } from "next";
import { Suspense } from "react";
import { DemoInbox } from "@/components/demo/demo-inbox";

export const metadata: Metadata = {
  title: "Demo inbox",
  description: "The feedback you left on the Pinwren demo page, in a read-only copy of the triage inbox.",
  alternates: { canonical: "/demo/inbox" },
};

export default function DemoInboxPage() {
  return (
    <Suspense
      fallback={
        <div className="container-page py-10" aria-busy="true">
          <div className="h-96 animate-pulse rounded-2xl bg-muted/60" />
        </div>
      }
    >
      <DemoInbox />
    </Suspense>
  );
}
