import { SettingsShell } from "./settings-shell";

export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return <SettingsShell>{children}</SettingsShell>;
}
