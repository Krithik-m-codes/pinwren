import { problem } from "@/lib/demo/http";

// The sample store's "Add to cart" calls this on purpose: a failing request for the widget's network
// capture to record, so demo bug reports show real diagnostics.
export function POST() {
  return problem(
    500,
    "PAYMENT_PROVIDER_TIMEOUT",
    "Payment provider timed out (this endpoint always fails in the demo)",
  );
}
