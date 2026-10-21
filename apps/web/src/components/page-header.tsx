"use client";

import { NotificationsBell } from "@/components/notifications-bell";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function PageHeader({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur">
      <SidebarTrigger className="-ml-1" />
      <h1 className="min-w-0 truncate text-sm font-semibold">{title}</h1>
      <div className="ml-auto flex items-center gap-2">
        {children}
        <NotificationsBell />
      </div>
    </header>
  );
}
