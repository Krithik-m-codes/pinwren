import type { PanelAction } from "@pinwren/core";
import type { Key } from "@/lib/i18n/en";
import { ArrowUpRight, Bot, ExternalLink, Link2, type LucideIcon, Ticket, Zap } from "lucide-react";

export const PANEL_ACTION_ICON_META: Record<
  NonNullable<PanelAction["icon"]>,
  { icon: LucideIcon; label: string; labelKey: Key }
> = {
  link: { icon: Link2, label: "Link", labelKey: "components1.iconLink" },
  ticket: { icon: Ticket, label: "Ticket", labelKey: "components1.iconTicket" },
  bot: { icon: Bot, label: "Bot", labelKey: "components1.iconBot" },
  external: { icon: ExternalLink, label: "External", labelKey: "components1.iconExternal" },
};

/** The icon an action shows: its own, or one for its kind. */
export function PanelActionIcon({
  action,
  className,
}: {
  action: Pick<PanelAction, "icon" | "kind">;
  className?: string;
}) {
  const Icon = action.icon
    ? PANEL_ACTION_ICON_META[action.icon].icon
    : action.kind === "webhook"
      ? Zap
      : ArrowUpRight;
  return <Icon className={className} aria-hidden />;
}
