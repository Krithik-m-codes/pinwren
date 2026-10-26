import { common } from "./en/common";
import { inbox } from "./en/inbox";
import { notifications } from "./en/notifications";
import { projects } from "./en/projects";
import { settings } from "./en/settings";
import { shell } from "./en/shell";

// The dashboard's English strings: the source of every translation key. They are split by area (en/*.ts) so
// that work on one area never touches another. Keys are `area.name`; plural forms are `<stem>_one` and
// `<stem>_other` (read with `tn(stem, n)`); `{name}` is filled from the variables. Every other language is a
// JSON file in catalogs/<code>.json with exactly these keys (i18n.test.ts checks; `pnpm i18n:missing` lists
// what a language still lacks).

export const en = { ...shell, ...inbox, ...projects, ...settings, ...notifications, ...common } as const;

export type Key = keyof typeof en;
