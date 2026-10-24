import type { Metadata } from "next";
import { MembersSettings } from "./members-settings";

export const metadata: Metadata = { title: "Users" };

export default function MembersPage() {
  return <MembersSettings />;
}
