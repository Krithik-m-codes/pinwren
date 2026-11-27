import type { Metadata } from "next";
import { AuditSettings } from "./audit-settings";

export const metadata: Metadata = { title: "Audit log" };

export default function AuditPage() {
  return <AuditSettings />;
}
