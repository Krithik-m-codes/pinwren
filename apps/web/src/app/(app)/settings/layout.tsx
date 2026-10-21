import { SettingsShell } from "./settings-shell";

// Signed-in screens render after the client confirms the session (ADR 0012), so there is no
// static shell for Next to validate instant navigation against.
export const instant = false;

export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return <SettingsShell>{children}</SettingsShell>;
}
