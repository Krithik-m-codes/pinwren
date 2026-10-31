import type { Metadata } from "next";
import { Suspense } from "react";
import { BillingSettings } from "./billing-settings";

export const metadata: Metadata = { title: "Billing" };

export default function BillingPage() {
  // useSearchParams (the checkout return flag) needs a Suspense boundary under Cache Components.
  return (
    <Suspense>
      <BillingSettings />
    </Suspense>
  );
}
