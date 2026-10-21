import { en } from "./locales/en";
import type { enPanel } from "./locales/en-panel";
import type { enReport } from "./locales/en-report";

// Widget i18n (F-013). The core's English ships in widget.js and each lazy chunk brings its own English
// (`addEnglish`); every other catalogue is a small separate file (`widget-i18n-<code>.js`, built next to
// widget.js) that registers itself on `window.__pinwrenI18n`, so a visitor only downloads their own language.

export type English = typeof en & typeof enPanel & typeof enReport;
export type Key = keyof English;
/** English plural forms are `_one`/`_other`; languages with more forms (Russian: 2–4 vs 5–20) add `_few`/`_many`. */
type ExtraPlural = Record<`${string}_few` | `${string}_many`, string>;
export type Catalog = Record<Key, string> & ExtraPlural;
type Vars = Record<string, string | number>;

export const LOCALES = ["en", "es", "fr", "de", "pt-BR", "it", "ja", "hi", "nl", "zh", "ru"] as const;
export type Locale = (typeof LOCALES)[number];

/** English fallback: the core's strings plus whatever the loaded chunks registered. */
let base: Partial<Record<Key, string>> = en;
let cat: Partial<Catalog> = en;
let lang: Locale = "en";
let rules: Intl.PluralRules | null = null;

/** First supported locale from `data-locale`, then the browser's languages; English otherwise. */
export function pickLocale(attr: string | undefined | null, langs: readonly string[]): Locale {
  for (const raw of [attr, ...langs]) {
    if (!raw) continue;
    const want = raw.trim().replace("_", "-").toLowerCase();
    const exact = LOCALES.find((l) => l.toLowerCase() === want);
    if (exact) return exact;
    // "pt" / "pt-PT" → pt-BR, "zh-TW" → zh, "fr-CA" → fr: the base language is better than English.
    const base = want.split("-")[0];
    const near = LOCALES.find((l) => l.toLowerCase().split("-")[0] === base);
    if (near) return near;
  }
  return "en";
}

/** A chunk's English strings (the fallback for keys a translation lacks, and the English UI itself). */
export function addEnglish(strings: Partial<Record<Key, string>>) {
  base = { ...base, ...strings };
  if (lang === "en") cat = base;
}

export function setCatalog(code: Locale, c: Partial<Catalog>) {
  lang = code;
  cat = c;
  rules = null;
}

export const locale = () => lang;

/** Translate; missing keys fall back to English, `{name}` placeholders are filled from `vars`. */
export function t(key: Key, vars?: Vars): string {
  return fill(cat[key] ?? base[key] ?? key, vars);
}

const fill = (s: string, vars?: Vars) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;

/** Plural form by the locale's rules: `<base>_<form>` when the catalogue has it, else `_one` / `_other`. */
export function tn(stem: string, n: number, vars?: Vars): string {
  let form = "other";
  try {
    rules ??= new Intl.PluralRules(lang);
    form = rules.select(n);
  } catch {
    form = n === 1 ? "one" : "other";
  }
  const exact = (cat as Record<string, string | undefined>)[`${stem}_${form}`];
  if (exact && form !== "one" && form !== "other") return fill(exact, { n, ...vars });
  const key = (form === "one" ? `${stem}_one` : `${stem}_other`) as Key;
  return t(key in base || key in cat ? key : (`${stem}_other` as Key), { n, ...vars });
}

/** Load a non-English catalogue from `<endpoint>/widget-i18n-<code>.js`. Never throws; English stays on failure. */
export async function loadLocale(code: Locale, endpoint: string, timeoutMs = 3000): Promise<void> {
  if (code === "en") {
    setCatalog("en", base);
    return;
  }
  const w = window as unknown as { __pinwrenI18n?: Record<string, Partial<Catalog>> };
  if (!w.__pinwrenI18n?.[code]) {
    try {
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement("script");
        s.src = `${endpoint}/widget-i18n-${code}.js`;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`locale ${code} unavailable`));
        setTimeout(() => reject(new Error(`locale ${code} timed out`)), timeoutMs);
        document.head.append(s);
      });
    } catch (err) {
      console.warn("[pinwren]", err instanceof Error ? err.message : err);
    }
  }
  const c = w.__pinwrenI18n?.[code];
  if (c) setCatalog(code, c);
}
