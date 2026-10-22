import type { Metadata } from "next";
import { EmailPageContent } from "./email-page";

export const metadata: Metadata = { title: "Email" };

export default function EmailPage() {
  return <EmailPageContent />;
}
