"use client";

import {
  AtSign,
  Bell,
  BellRing,
  CircleDot,
  Flag,
  type LucideIcon,
  MailWarning,
  MessageSquare,
  Trash2,
  UserPlus,
  WebhookOff,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import type { NotificationItem } from "@/lib/api";
import { useT } from "@/lib/i18n/provider";
import { useEmailSettingsQuery } from "@/lib/store/api";
import { useViewer } from "@/lib/viewer";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  "feedback.created": BellRing,
  "feedback.assigned": UserPlus,
  "feedback.status_changed": CircleDot,
  "feedback.priority_changed": Flag,
  "feedback.deleted": Trash2,
  "comment.created": MessageSquare,
  "comment.mentioned": AtSign,
  "webhook.disabled": WebhookOff,
};

export function NotificationIcon({
  type,
  className,
}: {
  type: NotificationItem["type"];
  className?: string;
}) {
  const Icon = ICONS[type] ?? Bell;
  return <Icon aria-hidden className={className} />;
}

const COUNT = /^\(\d+\+?\) /;

/**
 * "(3) Inbox · Pinwren": the unread count in the tab title while the dashboard is open. Next.js rewrites the
 * title on navigation, so the prefix is re-applied whenever the <head> changes.
 */
export function useUnreadTitle(unread: number) {
  useEffect(() => {
    const apply = () => {
      const base = document.title.replace(COUNT, "");
      const next = unread > 0 ? `(${unread > 99 ? "99+" : unread}) ${base}` : base;
      if (document.title !== next) document.title = next;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      document.title = document.title.replace(COUNT, "");
    };
  }, [unread]);
}

const BANNER_KEY = "pinwren:email-banner-dismissed";
let hiddenThisView = false;
const bannerListeners = new Set<() => void>();
const subscribeBanner = (l: () => void) => {
  bannerListeners.add(l);
  return () => bannerListeners.delete(l);
};
function bannerDismissed(): boolean {
  if (hiddenThisView) return true;
  try {
    return sessionStorage.getItem(BANNER_KEY) === "1";
  } catch {
    return false;
  }
}
function dismissBanner() {
  hiddenThisView = true;
  try {
    sessionStorage.setItem(BANNER_KEY, "1");
  } catch {
    // storage blocked: hidden until the next page load
  }
  for (const l of bannerListeners) l();
}

/**
 * For the instance admin (the first account, BugPin model): SMTP isn't set up, so invitations, new-report
 * emails and reporter emails are skipped — with the way to fix it. Dismissible for this browser session.
 */
export function EmailSetupBanner() {
  const t = useT();
  const { instanceAdmin } = useViewer();
  const settings = useEmailSettingsQuery(undefined, { skip: !instanceAdmin });
  const dismissed = useSyncExternalStore(subscribeBanner, bannerDismissed, () => true);
  if (!instanceAdmin || dismissed || !settings.data || settings.data.email.configured) return null;
  return (
    <div
      role="status"
      data-testid="email-setup-banner"
      className="flex flex-wrap items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-800 dark:text-amber-300"
    >
      <MailWarning className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">{t("components1.emailNotSetUpBanner")}</span>
      <Link href="/settings/email" className="font-medium underline-offset-4 hover:underline">
        {t("components1.setUpSmtp")}
      </Link>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={t("components1.dismiss")}
        className="text-current"
        onClick={dismissBanner}
      >
        <X />
      </Button>
    </div>
  );
}

/**
 * Inline notice where email is promised (Settings › Notifications): only the bell works until SMTP is set
 * up. Instance admins get the link; everyone else learns who to ask.
 */
export function EmailNotConfiguredNotice({ className }: { className?: string }) {
  const t = useT();
  const { instanceAdmin } = useViewer();
  return (
    <div
      role="status"
      data-testid="email-not-configured"
      className={cn(
        "flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300",
        className,
      )}
    >
      <MailWarning className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0 flex-1">
        {t("components1.emailNotSetUpNotice")}{" "}
        {instanceAdmin ? (
          <Link href="/settings/email" className="font-medium underline underline-offset-4">
            {t("components1.setUpSmtp")}
          </Link>
        ) : (
          t("components1.askAdminSmtp")
        )}
      </p>
    </div>
  );
}
