import type { Metadata } from "next";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Set up this instance" };

/** First-run setup (ADR 0021): claim instance administration with the token from the server log. */
export default function SetupPage() {
  return <SetupForm />;
}
