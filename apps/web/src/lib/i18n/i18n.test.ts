import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { en } from "./en";
import { fill, LOCALES, pickLocale, plural, translate } from "./translate";

// Every language file must have exactly English's keys, with the same {placeholders}. Run with
// I18N_REPORT=1 to write `.i18n/en.json` and `.i18n/missing-<code>.json` (what each language still lacks)
// instead of failing — that is the work list for a translation pass.

const dir = fileURLToPath(new URL("./catalogs/", import.meta.url));
const out = fileURLToPath(new URL("../../../.i18n/", import.meta.url));
const english = en as Record<string, string>;
const others = LOCALES.filter((l) => l !== "en");
const load = (code: string) =>
  JSON.parse(readFileSync(`${dir}${code}.json`, "utf8")) as Record<string, string>;
const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
/** `stem_one` → `stem`; Russian-style `_few` / `_many` forms exist only for languages that need them. */
const EXTRA_FORM = /_(few|many)$/;

describe.skipIf(!process.env.I18N_REPORT)("translation work list", () => {
  it("writes what each language lacks", () => {
    mkdirSync(out, { recursive: true });
    writeFileSync(`${out}en.json`, `${JSON.stringify(english, null, 2)}\n`);
    for (const code of others) {
      const have = load(code);
      const missing = Object.fromEntries(Object.entries(english).filter(([k]) => !(k in have)));
      writeFileSync(`${out}missing-${code}.json`, `${JSON.stringify(missing, null, 2)}\n`);
      console.log(`${code}: ${Object.keys(missing).length} of ${Object.keys(english).length} missing`);
    }
  });
});

describe.skipIf(!!process.env.I18N_REPORT)("catalogues", () => {
  for (const code of others) {
    describe(code, () => {
      const cat = load(code);
      it("has every English key", () => {
        expect(Object.keys(english).filter((k) => !(k in cat))).toEqual([]);
      });
      it("has no key English lacks", () => {
        expect(Object.keys(cat).filter((k) => !(k in english) && !EXTRA_FORM.test(k))).toEqual([]);
      });
      it("keeps the {placeholders} of every string", () => {
        const bad = Object.entries(cat)
          .filter(([k, v]) => k in english && vars(v).join() !== vars(english[k] ?? "").join())
          .map(([k]) => k);
        expect(bad).toEqual([]);
      });
      it("has no empty strings", () => {
        expect(Object.entries(cat).filter(([, v]) => !v.trim())).toEqual([]);
      });
    });
  }
});

describe("translate", () => {
  it("fills placeholders and leaves unknown ones", () => {
    expect(fill("{n} items in {where}", { n: 3 })).toBe("3 items in {where}");
  });
  it("falls back to English, then to the key", () => {
    expect(translate({}, { a: "Hello" }, "a")).toBe("Hello");
    expect(translate({ a: "Hallo" }, { a: "Hello" }, "a")).toBe("Hallo");
    expect(translate({}, {}, "missing.key")).toBe("missing.key");
  });
  it("picks the plural form of the language", () => {
    const e = { x_one: "{n} item", x_other: "{n} items" };
    expect(plural({}, e, "en", "x", 1)).toBe("1 item");
    expect(plural({}, e, "en", "x", 5)).toBe("5 items");
    const ru = { x_one: "{n} штука", x_few: "{n} штуки", x_many: "{n} штук", x_other: "{n} штуки" };
    expect(plural(ru, e, "ru", "x", 2)).toBe("2 штуки");
    expect(plural(ru, e, "ru", "x", 5)).toBe("5 штук");
    expect(plural(ru, e, "ru", "x", 21)).toBe("21 штука");
  });
  it("chooses a language from preferences and Accept-Language", () => {
    expect(pickLocale("de", "fr")).toBe("de");
    expect(pickLocale(null, "pt-PT,pt;q=0.9,en;q=0.8")).toBe("pt-BR");
    expect(pickLocale(undefined, "zh-TW")).toBe("zh");
    expect(pickLocale(null, "sv,da;q=0.8")).toBe("en");
    expect(pickLocale(null, null)).toBe("en");
  });
});
