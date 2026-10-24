import type { Metadata } from "next";
import { WorkspaceSettings } from "./workspace-settings";

export const metadata: Metadata = { title: "Workspace" };

export default function WorkspacePage() {
  return <WorkspaceSettings />;
}
