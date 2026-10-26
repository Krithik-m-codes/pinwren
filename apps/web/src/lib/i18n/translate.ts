import { LOCALES, type AppLocale } from "@pinwren/core";

// Dashboard translation, pure and framework-free: the catalogue lookup, `{placeholder}` filling, plural
// forms and choosing a language. React glue is in provider.tsx; English lives in en.ts and is the source of
// every key (a missing key in another language falls back to English, then to the key itself).

export type Vars = Record<string, string | number>;
/** A language's strings. Languages with more plural forms than English add `<stem>_few` / `<stem>_many`. */
export type Catalog = Readonly<Record<string, string>>;

export { LOCALES };
export type { AppLocale };

/** The language names as their speakers write them, for the language picker. */
export const LOCALE_NAMES: Record<AppLocale, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  "pt-BR": "Português (Brasil)",
  it: "Italiano",
  ja: "日本語",
  hi: "हिन्दी",
  nl: "Nederlands",
  zh: "中文",
  ru: "Русский",
};

/** The first supported language in `candidates` (`de`, `pt-BR`, `fr-CA`, an Accept-Language list); else English. */
export function pickLocale(...candidates: (string | null | undefined)[]): AppLocale {
  for (const raw of candidates.flatMap((c) => (c ? c.split(",") : []))) {
    const want = raw.split(";")[0]?.trim().replace("_", "-").toLowerCase();
    if (!want) continue;
    const exact = LOCALES.find((l) => l.toLowerCase() === want);
    if (exact) return exact;
    // "pt" / "pt-PT" → pt-BR, "zh-TW" → zh, "fr-CA" → fr: the base language beats English.
    const base = want.split("-")[0];
    const near = LOCALES.find((l) => l.toLowerCase().split("-")[0] === base);
    if (near) return near;
  }
  return "en";
}

export function fill(s: string, vars?: Vars): string {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Look `key` up in `cat`, then in English; `{name}` placeholders come from `vars`. */
export function translate(cat: Catalog, english: Catalog, key: string, vars?: Vars): string {
  return fill(cat[key] ?? english[key] ?? key, vars);
}

/** Plural form by the language's rules: `<stem>_<form>` when present, else `_other`; `{n}` is filled in. */
export function plural(
  cat: Catalog,
  english: Catalog,
  locale: AppLocale,
  stem: string,
  n: number,
  vars?: Vars,
): string {
  let form = n === 1 ? "one" : "other";
  try {
    form = new Intl.PluralRules(locale).select(n);
  } catch {
    // keep the English rule
  }
  const pick = (c: Catalog) => c[`${stem}_${form}`] ?? c[`${stem}_other`];
  return fill(pick(cat) ?? pick(english) ?? stem, { n, ...vars });
}
