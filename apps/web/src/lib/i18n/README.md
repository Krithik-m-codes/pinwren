# Dashboard translation: how to convert a file

English lives in typed TypeScript (`en/*.ts`, merged by `en.ts`); every other language is a JSON file in
`catalogs/<code>.json`. A component asks for a string by key. **The English output must stay exactly what it was**
(same words, punctuation, ellipses, spacing): the Playwright tests find things by their English text.

## In a client component

```tsx
import { useI18n } from "@/lib/i18n/provider";

export function Example({ count }: { count: number }) {
  const { t, tn } = useI18n(); // or, when only t is needed: const t = useT();
  return (
    <>
      <h2>{t("projects1.title")}</h2>
      <Input placeholder={t("projects1.searchPlaceholder")} aria-label={t("projects1.searchLabel")} />
      <p>{t("projects1.savedAt", { time })}</p> {/* "Saved at {time}" */}
      <p>{tn("projects1.items", count)}</p> {/* keys projects1.items_one / projects1.items_other */}
    </>
  );
}
```

`useI18n` and `useT` come from `@/lib/i18n/provider`. Hooks follow the usual rules: call them at the top of the
component, not in callbacks or loops. Components rendered by a parent that already has `t` can take `t` as a prop
only if that is already how the file is shaped; otherwise just call the hook again.

## What to convert

Everything a person reads: JSX text, `label` / `description` / `title` / `placeholder` / `aria-label` / `alt` props,
tooltip and dialog text, table headers, empty and error states, button labels, `toast.*("…")` messages, fallbacks
like `errorMessage(e, "Couldn't save …")`, option labels, validation messages written in the file.

## What NOT to convert

Data from the API (names, titles, report text), code identifiers, `data-testid`, class names, URLs and paths,
keyboard keys and chords (`⌘K`, `g m`), product and brand names (Pinwren, GitHub, GitLab, Jira, Linear, Slack,
Anthropic, OpenAI, Ollama…), technical literals shown as code (`PINWREN_URL`, `<script …>`), `console.*` messages,
HTTP/error codes, and `export const metadata` / `generateMetadata` (server-only; leave them).

## Constants that hold labels

Module-level arrays and objects that carry labels keep a **key**, and translate where they render:

```tsx
const TABS = [{ id: "a", label: "projects1.tabA" }] as const satisfies readonly { id: string; label: Key }[];
// … {TABS.map((x) => <Tab key={x.id}>{t(x.label)}</Tab>)}
```

`import type { Key } from "@/lib/i18n/en";` gives the type of every key (a typo is a compile error).

## Sentences with markup or links inside

Never glue translated fragments into a sentence: word order differs between languages. Prefer one key with a
`{name}` placeholder for plain values. When a link or bold run sits inside a sentence, use three keys
(`before`, `link`, `after`) only if the placeholder approach cannot work, and keep each fragment a complete
phrase where you can. Words that are only a name or number are placeholders.

## Plurals

`tn("stem", n)` reads `stem_one` and `stem_other` (and `{n}` is filled in). Write both English forms:
`"items_one": "{n} item"`, `"items_other": "{n} items"`. Do not build a plural with `n === 1 ? … : …`.

## Keys

`<your prefix>.<camelCaseName>`, unique, descriptive of the string and not of where it appears. Add them to
**your own** `en/<prefix>.ts` file only. Keys are never reused across prefixes; a common word ("Cancel", "Save")
used in several files of your task is one key.

## Helpers that are not components

A plain function that returns user-visible text (a label builder, `notification-text.ts`, `settings-nav.ts`) cannot
call hooks. Give it a `t: TFn` parameter (`import type { TFn } from "@/lib/i18n/english";`), have callers pass the
`t` from `useT()`, and update its tests to pass `tEn` (`import { tEn } from "@/lib/i18n/english";`), which is
English with no React. Where a helper only returns a label for something fixed (a status, a kind), returning a
`Key` and letting the caller translate is simpler.

## Server components

A file without `"use client"` cannot call hooks. Leave its strings and list them in your report; they will be
handled separately.

## Check your work

`pnpm --filter @pinwren/web exec tsc --noEmit` (fix every error), then `npx prettier --write` on the files you
changed. Do not run Playwright, Docker or the dev server. Do not commit.
