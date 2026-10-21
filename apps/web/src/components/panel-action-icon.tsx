import type { PanelAction } from "@pinwren/core";
import { ArrowUpRight, Bot, ExternalLink, Link2, type LucideIcon, Ticket, Zap } from "lucide-react";

export const PANEL_ACTION_ICON_META: Record<
  NonNullable<PanelAction["icon"]>,
  { icon: LucideIcon; label: string }
> = {
  link: { icon: Link2, label: "Link" },
  ticket: { icon: Ticket, label: "Ticket" },
  bot: { icon: Bot, label: "Bot" },
  external: { icon: ExternalLink, label: "External" },
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
