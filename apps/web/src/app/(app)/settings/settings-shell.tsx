"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { useT } from "@/lib/i18n/provider";
import { SETTINGS_PAGES, visibleSettingsPages } from "@/lib/settings-nav";
import { useMeQuery } from "@/lib/store/api";
import { cn } from "@/lib/utils";

/** Settings: one main column with a section nav — a rail on desktop, a scrolling strip on phones. */
export function SettingsShell({ children }: { children: React.ReactNode }) {
  const t = useT();
  const pathname = usePathname();
  const me = useMeQuery(undefined).data;
  // Hide what the user can't change: branding and templates are for workspace admins, SMTP and
  // security for instance admins. The command palette uses the same list and filter (lib/settings-nav).
  const nav = visibleSettingsPages({ role: me?.role, instanceAdmin: !!me?.instanceAdmin });
  const current = SETTINGS_PAGES.find((n) => n.href === pathname) ?? SETTINGS_PAGES[0];

  return (
    <>
      <PageHeader
        title={
          <span>
            {t("settings2.settings")}
            <span className="text-muted-foreground"> / {current && t(current.labelKey)}</span>
          </span>
        }
      />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 pb-16 md:flex-row md:gap-8">
        <nav
          aria-label={t("settings2.settings")}
          className="-mx-4 shrink-0 overflow-x-auto px-4 md:mx-0 md:w-48 md:px-0"
        >
          <ul className="flex gap-1 md:flex-col">
            {nav.map(({ href, labelKey, icon: Icon, access }) => {
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
                    {t(labelKey)}
                    {access === "instance" && (
                      <span className="ml-auto hidden text-[10px] tracking-wide text-muted-foreground uppercase md:inline">
                        {t("settings2.adminBadge")}
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
