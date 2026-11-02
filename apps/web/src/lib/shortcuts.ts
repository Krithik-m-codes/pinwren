import type { Route } from "next";
import type { Key } from "@/lib/i18n/en";

/** `g` then a letter, within a second: the go-to chords that work on every app screen. */
export const GO_CHORDS = {
  i: "/inbox",
  d: "/dashboard",
  p: "/projects",
  n: "/notifications",
  s: "/settings",
  m: "/inbox?assignee=me",
} as const satisfies Record<string, string>;

export type GoKey = keyof typeof GO_CHORDS;

export const goTarget = (key: string): Route | null =>
  Object.hasOwn(GO_CHORDS, key) ? GO_CHORDS[key as GoKey] : null;

/** One row of the help overlay: the keys (space = then, " / " = or) and what they do. */
export type ShortcutRow = [keys: string, label: Key];
export type ShortcutGroup = { title: Key; rows: ShortcutRow[] };

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "shortcuts.groupGlobal",
    rows: [
      ["⌘K", "inbox2.keyCommandPalette"],
      ["?", "inbox2.keyHelp"],
      ["g i", "shortcuts.goInbox"],
      ["g d", "shortcuts.goDashboard"],
      ["g p", "shortcuts.goProjects"],
      ["g n", "shortcuts.goNotifications"],
      ["g s", "shortcuts.goSettings"],
      ["g m", "inbox2.keyMyWork"],
    ],
  },
  {
    title: "shortcuts.groupInbox",
    rows: [
      ["j / k", "inbox2.keyNextPrevious"],
      ["Enter", "inbox2.keyOpen"],
      ["Esc", "inbox2.keyEscape"],
      ["x", "inbox2.keySelect"],
      ["e", "inbox2.keyResolve"],
      ["s", "inbox2.keyStatusMenu"],
      ["p", "inbox2.keyPriorityMenu"],
      ["a", "inbox2.keyAssignMenu"],
      ["l", "inbox2.keyLabelsMenu"],
      ["r", "inbox2.keyRename"],
      ["c", "inbox2.comment"],
      ["u", "inbox2.keyUndo"],
      ["/", "inbox2.keySearch"],
      ["m", "inbox2.keyMoveCard"],
    ],
  },
];
