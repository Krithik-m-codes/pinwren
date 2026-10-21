import { en } from "./locales/en";

// Widget i18n (F-013). English ships in the core bundle; every other catalogue is a small separate file
// (`widget-i18n-<code>.js`, built next to widget.js) that registers itself on `window.__annotaI18n`, so a
// visitor only downloads their own language.

export type Key = keyof typeof en;
export type Catalog = Record<Key, string>;
type Vars = Record<string, string | number>;

export const LOCALES = ["en", "es", "fr", "de", "pt-BR", "it", "ja", "hi", "nl", "zh"] as const;
export type Locale = (typeof LOCALES)[number];

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

export function setCatalog(code: Locale, c: Partial<Catalog>) {
  lang = code;
  cat = c;
  rules = null;
}

export const locale = () => lang;

/** Translate; missing keys fall back to English, `{name}` placeholders are filled from `vars`. */
export function t(key: Key, vars?: Vars): string {
  const s = cat[key] ?? en[key];
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Plural form: picks `<base>_one` or `<base>_other` by the locale's plural rules. */
export function tn(base: string, n: number, vars?: Vars): string {
  let form = "other";
  try {
    rules ??= new Intl.PluralRules(lang);
    form = rules.select(n);
  } catch {
    form = n === 1 ? "one" : "other";
  }
  const key = (form === "one" ? `${base}_one` : `${base}_other`) as Key;
  return t(key in en ? key : (`${base}_other` as Key), { n, ...vars });
}

/** Load a non-English catalogue from `<endpoint>/widget-i18n-<code>.js`. Never throws; English stays on failure. */
export async function loadLocale(code: Locale, endpoint: string, timeoutMs = 3000): Promise<void> {
  if (code === "en") return setCatalog("en", en);
  const w = window as unknown as { __annotaI18n?: Record<string, Partial<Catalog>> };
  if (!w.__annotaI18n?.[code]) {
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
      console.warn("[annota]", err instanceof Error ? err.message : err);
    }
  }
  const c = w.__annotaI18n?.[code];
  if (c) setCatalog(code, c);
}
