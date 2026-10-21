"use client";

import { useQuery } from "@tanstack/react-query";
import { Bell, KeyRound, Mail, Palette, ShieldCheck, UserRound, Users, Webhook } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { useMeInfo } from "@/lib/account-hooks";
import { api, type EmailSettings, isAdminRole, isForbidden } from "@/lib/api";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/settings", label: "Profile", icon: UserRound },
  { href: "/settings/members", label: "Members", icon: Users },
  { href: "/settings/notifications", label: "Notifications", icon: Bell },
  { href: "/settings/integrations", label: "Integrations", icon: Webhook },
  { href: "/settings/tokens", label: "API tokens", icon: KeyRound },
  { href: "/settings/branding", label: "Branding", icon: Palette, access: "org" },
  { href: "/settings/email", label: "Email", icon: Mail, access: "email" },
  { href: "/settings/security", label: "Security", icon: ShieldCheck, access: "instance" },
] as const;

export const emailSettingsKey = ["admin", "email"] as const;

export function useEmailSettings() {
  return useQuery({
    queryKey: emailSettingsKey,
    queryFn: () => api<{ email: EmailSettings }>("/admin/settings/email"),
    retry: (n, e) => !isForbidden(e) && n < 1,
  });
}

/** Settings: one main column with a section nav — a rail on desktop, a scrolling strip on phones. */
export function SettingsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const me = useMeInfo().data;
  const orgAdmin = isAdminRole(me?.role);
  const instanceAdmin = !!me?.instanceAdmin;
  // Hide what the user can't change: branding and templates are for workspace admins, SMTP and
  // security for instance admins (blueprint 06 §3.7: no "you can't" screens in the nav).
  const nav = NAV.filter((n) => {
    if (!("access" in n)) return true;
    if (n.access === "org") return orgAdmin;
    if (n.access === "instance") return instanceAdmin;
    return orgAdmin || instanceAdmin;
  });
  const current = NAV.find((n) => n.href === pathname) ?? NAV[0];

  return (
    <>
      <PageHeader
        title={
          <span>
            Settings<span className="text-muted-foreground"> / {current.label}</span>
          </span>
        }
      />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 pb-16 md:flex-row md:gap-8">
        <nav aria-label="Settings" className="-mx-4 shrink-0 overflow-x-auto px-4 md:mx-0 md:w-48 md:px-0">
          <ul className="flex gap-1 md:flex-col">
            {nav.map(({ href, label, icon: Icon, ...rest }) => {
              const active = pathname === href;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-8 items-center gap-2 rounded-md px-2.5 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
                      active && "bg-muted font-medium text-foreground",
                    )}
                  >
                    <Icon className="size-4" />
                    {label}
                    {"access" in rest && rest.access === "instance" && (
                      <span className="ml-auto hidden text-[10px] tracking-wide text-muted-foreground uppercase md:inline">
                        Admin
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </>
  );
}

export function SectionTitle({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-pretty text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
