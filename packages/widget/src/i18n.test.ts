import { afterEach, describe, expect, it } from "vitest";
import { type Catalog, LOCALES, pickLocale, setCatalog, t, tn } from "./i18n";
import de from "./locales/de";
import { en } from "./locales/en";
import es from "./locales/es";
import fr from "./locales/fr";
import hi from "./locales/hi";
import it_ from "./locales/it";
import ja from "./locales/ja";
import nl from "./locales/nl";
import ptBR from "./locales/pt-BR";
import zh from "./locales/zh";

const CATALOGS: Record<string, Catalog> = { de, es, fr, hi, it: it_, ja, nl, "pt-BR": ptBR, zh };

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

  for (const [code, cat] of Object.entries(CATALOGS)) {
    it(`${code}: same keys and placeholders as English, nothing left untranslated by accident`, () => {
      expect(Object.keys(cat).sort()).toEqual(keys);
      for (const k of keys as (keyof Catalog)[]) {
        expect(placeholders(cat[k]), `${code}.${k}`).toEqual(placeholders(en[k]));
        expect(cat[k].trim(), `${code}.${k}`).not.toBe("");
      }
      const same = keys.filter((k) => cat[k as keyof Catalog] === en[k as keyof Catalog]);
      // A few strings are legitimately identical (brand line, keyboard hints, "Bug" in some languages).
      expect(same.length, `${code} untranslated: ${same.join(", ")}`).toBeLessThan(12);
    });
  }
});

describe("t / tn", () => {
  afterEach(() => setCatalog("en", en));

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
});
