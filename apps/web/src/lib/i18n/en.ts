import { inbox1 } from "./en/inbox1";
import { inbox2 } from "./en/inbox2";
import { projects1 } from "./en/projects1";
import { projects2 } from "./en/projects2";
import { settings1 } from "./en/settings1";
import { settings2 } from "./en/settings2";
import { settings3 } from "./en/settings3";
import { components1 } from "./en/components1";
import { components2 } from "./en/components2";
import { other1 } from "./en/other1";
import { meta } from "./en/meta";
import { misc } from "./en/misc";
import { shell } from "./en/shell";
import { validation } from "./en/validation";

// The dashboard's English strings: the source of every translation key. They are split by area (en/*.ts) so
// that work on one area never touches another. Keys are `area.name`; plural forms are `<stem>_one` and
// `<stem>_other` (read with `tn(stem, n)`); `{name}` is filled from the variables. Every other language is a
// JSON file in catalogs/<code>.json with exactly these keys (i18n.test.ts checks; `I18N_REPORT=1` lists
// what a language still lacks).

export const en = {
  ...shell,
  ...inbox1,
  ...inbox2,
  ...projects1,
  ...projects2,
  ...settings1,
  ...settings2,
  ...settings3,
  ...components1,
  ...components2,
  ...other1,
  ...meta,
  ...misc,
  ...validation,
} as const;

export type Key = keyof typeof en;
