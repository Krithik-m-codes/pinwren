import { z } from "zod";
import type { DemoConfig } from "@/lib/demo/config";

// The widget playground's options (SitePing-style): where feedback goes, how the widget looks and which
// features are on. They live in this browser only (localStorage) and are applied two ways: init options
// (accent, locale, theme, identity) and overrides on the project's `/w/config` (position, capture, modes).

export const MODES = [
  { value: "server", label: "Server API", hint: "Feedback goes to the demo API (resets every 10 minutes)." },
  {
    value: "local",
    label: "Local (this browser)",
    hint: "Feedback stays in this browser's IndexedDB; nothing is sent.",
  },
] as const;

export const THEMES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "auto", label: "Auto" },
] as const;

export const POSITIONS = [
  { value: "bottom-right", label: "Bottom right" },
  { value: "bottom-left", label: "Bottom left" },
] as const;

/** The widget's 11 languages, by their own names. */
export const LOCALES = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "it", label: "Italiano" },
  { value: "ja", label: "日本語" },
  { value: "hi", label: "हिन्दी" },
  { value: "nl", label: "Nederlands" },
  { value: "zh", label: "中文" },
  { value: "ru", label: "Русский" },
] as const;

export const ACCENTS = [
  { value: "#5b5bd6", label: "Indigo" },
  { value: "#7c3aed", label: "Violet" },
  { value: "#059669", label: "Emerald" },
  { value: "#e11d48", label: "Rose" },
  { value: "#ea580c", label: "Orange" },
] as const;

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
export const playgroundSettings = z.object({
  mode: z.enum(["server", "local"]).catch("server"),
  theme: z.enum(["light", "dark", "auto"]).catch("auto"),
  locale: z.enum(["en", "es", "fr", "de", "pt-BR", "it", "ja", "hi", "nl", "zh", "ru"]).catch("en"),
  position: z.enum(["bottom-right", "bottom-left"]).catch("bottom-right"),
  accent: z.string().regex(HEX).catch("#5b5bd6"),
  screenshots: z.boolean().catch(true),
  diagnostics: z.boolean().catch(true),
  rightClick: z.boolean().catch(true),
  identity: z.boolean().catch(false),
  bugs: z.boolean().catch(true),
  replay: z.boolean().catch(false),
});
export type PlaygroundSettings = z.infer<typeof playgroundSettings>;

export const DEFAULT_SETTINGS: PlaygroundSettings = playgroundSettings.parse({});

/** The visitor used by "Prefilled identity" (what `Pinwren.identify` would pass from a host app). */
export const DEMO_IDENTITY = { id: "demo-user-1", name: "Alex Rivera", email: "alex@example.com" };

const KEY = "pinwren:playground";

/** Saved options, or the defaults (bad or missing values fall back field by field). */
export function loadSettings(): PlaygroundSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? playgroundSettings.parse(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: PlaygroundSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // private browsing: the options last for this visit
  }
}

/** The project config the widget sees with the playground's switches applied. */
export function withPlayground(cfg: DemoConfig, s: PlaygroundSettings): DemoConfig {
  return {
    ...cfg,
    widget: {
      ...cfg.widget,
      launcher: { ...cfg.widget.launcher, position: s.position },
      rightClickComment: s.rightClick,
      modes: { ...cfg.widget.modes, bug: s.bugs },
    },
    capture: {
      ...cfg.capture,
      console: s.diagnostics ? "warnings" : "off",
      network: s.diagnostics ? "failures" : "off",
      screenshotOnComment: s.screenshots,
      replay: { ...cfg.capture.replay, enabled: s.replay },
    },
  };
}
