import { afterEach, describe, expect, it } from "vitest";
import { type Catalog, LOCALES, pickLocale, setCatalog, t, tn } from "./i18n";
import de from "./locales/de";
import { en as enCore } from "./locales/en";
import { enErrors } from "./locales/en-errors";
import { enFields } from "./locales/en-fields";
import { enRecord } from "./locales/en-record";
import { enPanel } from "./locales/en-panel";
import { enReport } from "./locales/en-report";
import { enShots } from "./locales/en-shots";
import es from "./locales/es";
import fr from "./locales/fr";
import hi from "./locales/hi";
import it_ from "./locales/it";
import ja from "./locales/ja";
import nl from "./locales/nl";
import ptBR from "./locales/pt-BR";
import ru from "./locales/ru";
import zh from "./locales/zh";
import deRecord from "./locales/de-record";
import deFields from "./locales/de-fields";
import esRecord from "./locales/es-record";
import esFields from "./locales/es-fields";
import frRecord from "./locales/fr-record";
import frFields from "./locales/fr-fields";
import hiRecord from "./locales/hi-record";
import hiFields from "./locales/hi-fields";
import itRecord from "./locales/it-record";
import itFields from "./locales/it-fields";
import jaRecord from "./locales/ja-record";
import jaFields from "./locales/ja-fields";
import nlRecord from "./locales/nl-record";
import nlFields from "./locales/nl-fields";
import ptBRRecord from "./locales/pt-BR-record";
import ptBRFields from "./locales/pt-BR-fields";
import ruRecord from "./locales/ru-record";
import ruFields from "./locales/ru-fields";
import zhRecord from "./locales/zh-record";
import zhFields from "./locales/zh-fields";

// The full English catalogue: the core's strings plus each lazy chunk's.
const en = { ...enCore, ...enPanel, ...enReport, ...enShots, ...enErrors, ...enRecord, ...enFields };
// Each language is its file plus the per-chunk files next to it; build.mjs merges them the same way.
const CATALOGS: Record<string, Catalog> = {
  de: { ...de, ...deRecord, ...deFields },
  es: { ...es, ...esRecord, ...esFields },
  fr: { ...fr, ...frRecord, ...frFields },
  hi: { ...hi, ...hiRecord, ...hiFields },
  it: { ...it_, ...itRecord, ...itFields },
  ja: { ...ja, ...jaRecord, ...jaFields },
  nl: { ...nl, ...nlRecord, ...nlFields },
  "pt-BR": { ...ptBR, ...ptBRRecord, ...ptBRFields },
  ru: { ...ru, ...ruRecord, ...ruFields },
  zh: { ...zh, ...zhRecord, ...zhFields },
};

describe("pickLocale", () => {
  it("prefers data-locale, then the browser's languages, then English", () => {
    expect(pickLocale("fr", ["de-DE"])).toBe("fr");
    expect(pickLocale(undefined, ["de-DE", "fr"])).toBe("de");
    expect(pickLocale(null, ["sv-SE", "nl-BE"])).toBe("nl");
    expect(pickLocale(undefined, ["sv", "ko"])).toBe("en");
    expect(pickLocale("", [])).toBe("en");
  });
  it("matches regions and base languages case-insensitively", () => {
    expect(pickLocale("pt-br", [])).toBe("pt-BR");
    expect(pickLocale("pt_PT", [])).toBe("pt-BR");
    expect(pickLocale("zh-TW", [])).toBe("zh");
    expect(pickLocale("JA-jp", [])).toBe("ja");
    expect(pickLocale("klingon", ["hi-IN"])).toBe("hi");
  });
});

describe("catalogues", () => {
  const keys = Object.keys(en).sort();
  const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

  it("ship every supported non-English locale", () => {
    expect(Object.keys(CATALOGS).sort()).toEqual(LOCALES.filter((l) => l !== "en").sort());
  });

  for (const [code, catalog] of Object.entries(CATALOGS)) {
    const cat = catalog as Record<string, string>;
    const eng = en as Record<string, string>;
    it(`${code}: same keys and placeholders as English, nothing left untranslated by accident`, () => {
      // Extra plural forms (`_few`, `_many`) are allowed only for a counted English string (`<base>_other`).
      for (const k of Object.keys(cat).filter((k) => !(k in en))) {
        const base = /^(\w+)_(few|many)$/.exec(k)?.[1];
        const other = base === undefined ? undefined : eng[`${base}_other`];
        expect(other, `${code}.${k} is not an English key`).toBeTypeOf("string");
        expect(placeholders(cat[k] ?? ""), `${code}.${k}`).toEqual(placeholders(other ?? ""));
      }
      expect(
        Object.keys(cat)
          .filter((k) => k in en)
          .sort(),
      ).toEqual(keys);
      for (const k of keys) {
        expect(placeholders(cat[k] ?? ""), `${code}.${k}`).toEqual(placeholders(eng[k] ?? ""));
        expect((cat[k] ?? "").trim(), `${code}.${k}`).not.toBe("");
      }
      const same = keys.filter((k) => cat[k] === eng[k]);
      // A few strings are legitimately identical (brand line, keyboard hints, "Bug" in some languages).
      expect(same.length, `${code} untranslated: ${same.join(", ")}`).toBeLessThan(12);
    });
  }
});

describe("t / tn", () => {
  afterEach(() => setCatalog("en", enCore));

  it("fills placeholders and falls back to English for missing keys", () => {
    expect(t("sent", { n: 4 })).toBe("#4 sent");
    setCatalog("fr", { sent: "#{n} envoyé" });
    expect(t("sent", { n: 4 })).toBe("#4 envoyé");
    expect(t("cancel")).toBe("Cancel");
  });

  it("picks plural forms by the locale's rules", () => {
    expect(tn("reply", 1)).toBe("1 reply");
    expect(tn("reply", 0)).toBe("0 replies");
    expect(tn("reply", 3)).toBe("3 replies");
    setCatalog("fr", fr);
    expect(tn("reply", 0)).toBe(fr.reply_one.replace("{n}", "0")); // French: 0 is singular
    setCatalog("ja", ja);
    expect(tn("reply", 1)).toBe(ja.reply_other.replace("{n}", "1"));
  });

  it("uses Russian few/many forms", () => {
    setCatalog("ru", ru);
    expect(tn("reply", 1)).toBe("1 ответ");
    expect(tn("reply", 3)).toBe("3 ответа");
    expect(tn("reply", 5)).toBe("5 ответов");
    expect(tn("reply", 11)).toBe("11 ответов");
    expect(tn("reply", 22)).toBe("22 ответа");
    expect(tn("files", 21)).toBe("21 вложение");
    expect(pickLocale(undefined, ["ru-RU"])).toBe("ru");
  });
});
