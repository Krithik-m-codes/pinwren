import type { Metadata } from "next";
import { NotificationSettings } from "./notification-settings";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationsPage() {
  return <NotificationSettings />;
}
