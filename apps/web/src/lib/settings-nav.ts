import {
  Award,
  CreditCard,
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
import type { Key } from "@/lib/i18n/en";
import { tEn } from "@/lib/i18n/english";

/**
 * Who sees a settings page: everyone (no `access`), workspace Admins (`org`), instance admins
 * (`instance`, self-host settings such as security and the licence), or either (`email`: SMTP for the
 * instance admin, the email templates for workspace Admins).
 */
export type SettingsAccess = "org" | "instance" | "email" | "cloud-org";

export type SettingsPage = {
  href: Route;
  /** English label (for tests and non-React code); the UI translates `labelKey`. */
  label: string;
  labelKey: Key;
  icon: LucideIcon;
  access?: SettingsAccess;
  /** Extra words the command palette matches. */
  keywords?: string[];
};

/** Every settings page, in nav order. The settings rail and the command palette both read this list. */
const PAGES: readonly Omit<SettingsPage, "label">[] = [
  {
    href: "/settings",
    labelKey: "other1.settingsProfile",
    icon: UserRound,
    keywords: ["account", "password", "avatar", "name", "email", "two-factor", "2fa", "sessions"],
  },
  {
    href: "/settings/workspace",
    labelKey: "other1.settingsWorkspace",
    icon: Building2,
    keywords: ["organisation", "organization", "rename", "leave", "transfer", "delete"],
  },
  {
    href: "/settings/members",
    labelKey: "other1.settingsUsers",
    icon: Users,
    keywords: ["members", "team", "add user", "invite", "roles", "admin", "editor", "viewer"],
  },
  {
    href: "/settings/notifications",
    labelKey: "other1.notifications",
    icon: Bell,
    keywords: ["email", "alerts", "reporter", "recipients", "templates", "digest"],
  },
  {
    href: "/settings/integrations",
    labelKey: "other1.settingsIntegrations",
    icon: Webhook,
    // Admins only (wave-5 contract §3.7, `integrations.manage`), like BugPin.
    access: "org",
    keywords: ["webhooks", "slack", "discord", "github", "gitlab"],
  },
  {
    href: "/settings/tokens",
    labelKey: "other1.settingsApiTokens",
    icon: KeyRound,
    keywords: ["api", "mcp", "keys"],
  },
  {
    href: "/settings/branding",
    labelKey: "other1.settingsBranding",
    icon: Palette,
    access: "org",
    keywords: ["logo", "colour"],
  },
  {
    href: "/settings/ai",
    labelKey: "other1.settingsAi",
    icon: Sparkles,
    access: "org",
    keywords: ["ai", "llm", "claude", "openai", "ollama", "triage", "summary"],
  },
  {
    href: "/settings/email",
    labelKey: "other1.email",
    icon: Mail,
    access: "email",
    keywords: ["smtp", "mail", "deliveries", "test email"],
  },
  {
    href: "/settings/security",
    labelKey: "other1.settingsSecurity",
    icon: ShieldCheck,
    access: "instance",
    keywords: ["sessions", "https", "updates"],
  },
  {
    href: "/settings/billing",
    labelKey: "billing.navLabel",
    icon: CreditCard,
    access: "cloud-org",
    keywords: ["plan", "subscription", "invoice", "payment", "upgrade", "usage", "limits"],
  },
  {
    href: "/settings/license",
    labelKey: "other1.settingsLicence",
    icon: Award,
    access: "instance",
    keywords: ["license", "enterprise"],
  },
];

export const SETTINGS_PAGES: readonly SettingsPage[] = PAGES.map((p) => ({ ...p, label: tEn(p.labelKey) }));

export type SettingsViewer = {
  role: string | null | undefined;
  instanceAdmin: boolean;
  /** Pinwren Cloud (billing exists only there). */
  cloud?: boolean;
};

/**
 * Hide what the user can't change (blueprint 06 §3.7: no "you can't" screens in the nav). The API refuses
 * the same things on its side; this only keeps the menus honest.
 */
export function canSeeSettingsPage(page: Pick<SettingsPage, "access">, viewer: SettingsViewer): boolean {
  const orgAdmin = isAdminRole(viewer.role);
  if (page.access === "org") return orgAdmin;
  if (page.access === "instance") return viewer.instanceAdmin;
  if (page.access === "email") return orgAdmin || viewer.instanceAdmin;
  if (page.access === "cloud-org") return orgAdmin && viewer.cloud === true;
  return true;
}

export const visibleSettingsPages = (viewer: SettingsViewer) =>
  SETTINGS_PAGES.filter((p) => canSeeSettingsPage(p, viewer));
