import {
  Award,
  Bell,
  Building2,
  KeyRound,
  type LucideIcon,
  Mail,
  Palette,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
  Webhook,
} from "lucide-react";
import type { Route } from "next";
import { isAdminRole } from "@/lib/api";

/**
 * Who sees a settings page: everyone (no `access`), workspace Admins (`org`), instance admins
 * (`instance`, self-host settings such as security and the licence), or either (`email`: SMTP for the
 * instance admin, the email templates for workspace Admins).
 */
export type SettingsAccess = "org" | "instance" | "email";

export type SettingsPage = {
  href: Route;
  label: string;
  icon: LucideIcon;
  access?: SettingsAccess;
  /** Extra words the command palette matches. */
  keywords?: string[];
};

/** Every settings page, in nav order. The settings rail and the command palette both read this list. */
export const SETTINGS_PAGES: readonly SettingsPage[] = [
  {
    href: "/settings",
    label: "Profile",
    icon: UserRound,
    keywords: ["account", "password", "avatar", "name", "email", "two-factor", "2fa", "sessions"],
  },
  {
    href: "/settings/workspace",
    label: "Workspace",
    icon: Building2,
    keywords: ["organisation", "organization", "rename", "leave", "transfer", "delete"],
  },
  {
    href: "/settings/members",
    label: "Users",
    icon: Users,
    keywords: ["members", "team", "add user", "invite", "roles", "admin", "editor", "viewer"],
  },
  {
    href: "/settings/notifications",
    label: "Notifications",
    icon: Bell,
    keywords: ["email", "alerts", "reporter", "recipients", "templates", "digest"],
  },
  {
    href: "/settings/integrations",
    label: "Integrations",
    icon: Webhook,
    // Admins only (wave-5 contract §3.7, `integrations.manage`), like BugPin.
    access: "org",
    keywords: ["webhooks", "slack", "discord", "github", "gitlab"],
  },
  { href: "/settings/tokens", label: "API tokens", icon: KeyRound, keywords: ["api", "mcp", "keys"] },
  {
    href: "/settings/branding",
    label: "Branding",
    icon: Palette,
    access: "org",
    keywords: ["logo", "colour"],
  },
  {
    href: "/settings/ai",
    label: "AI",
    icon: Sparkles,
    access: "org",
    keywords: ["ai", "llm", "claude", "openai", "ollama", "triage", "summary"],
  },
  {
    href: "/settings/email",
    label: "Email",
    icon: Mail,
    access: "email",
    keywords: ["smtp", "mail", "deliveries", "test email"],
  },
  {
    href: "/settings/security",
    label: "Security",
    icon: ShieldCheck,
    access: "instance",
    keywords: ["sessions", "https", "updates"],
  },
  {
    href: "/settings/license",
    label: "Licence",
    icon: Award,
    access: "instance",
    keywords: ["license", "enterprise"],
  },
];

export type SettingsViewer = { role: string | null | undefined; instanceAdmin: boolean };

/**
 * Hide what the user can't change (blueprint 06 §3.7: no "you can't" screens in the nav). The API refuses
 * the same things on its side; this only keeps the menus honest.
 */
export function canSeeSettingsPage(page: Pick<SettingsPage, "access">, viewer: SettingsViewer): boolean {
  const orgAdmin = isAdminRole(viewer.role);
  if (page.access === "org") return orgAdmin;
  if (page.access === "instance") return viewer.instanceAdmin;
  if (page.access === "email") return orgAdmin || viewer.instanceAdmin;
  return true;
}

export const visibleSettingsPages = (viewer: SettingsViewer) =>
  SETTINGS_PAGES.filter((p) => canSeeSettingsPage(p, viewer));
