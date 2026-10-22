import type { Metadata } from "next";
import { SecuritySettingsForm } from "./security-settings";

export const metadata: Metadata = { title: "Security" };

export default function SecurityPage() {
  return <SecuritySettingsForm />;
}
