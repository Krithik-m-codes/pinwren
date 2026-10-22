import type { Metadata } from "next";
import { LicenseSettings } from "./license-settings";

export const metadata: Metadata = { title: "Licence" };

export default function LicensePage() {
  return <LicenseSettings />;
}
