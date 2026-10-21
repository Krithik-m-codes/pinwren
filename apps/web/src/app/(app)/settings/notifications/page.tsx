import type { Metadata } from "next";
import { NotificationSettings } from "./notification-settings";

// Signed-in screens render after the client confirms the session (ADR 0012), so there is no
// static shell for Next to validate instant navigation against.
export const instant = false;

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationsPage() {
  return <NotificationSettings />;
}
