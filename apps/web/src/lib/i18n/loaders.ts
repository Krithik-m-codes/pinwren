import type { AppLocale, Catalog } from "./translate";

/** One dynamic import per language: the server loads the reader's, and signed-out pages load the browser's. */
export const LOADERS: Record<Exclude<AppLocale, "en">, () => Promise<{ default: Catalog }>> = {
  es: () => import("./catalogs/es.json"),
  fr: () => import("./catalogs/fr.json"),
  de: () => import("./catalogs/de.json"),
  "pt-BR": () => import("./catalogs/pt-BR.json"),
  it: () => import("./catalogs/it.json"),
  ja: () => import("./catalogs/ja.json"),
  hi: () => import("./catalogs/hi.json"),
  nl: () => import("./catalogs/nl.json"),
  zh: () => import("./catalogs/zh.json"),
  ru: () => import("./catalogs/ru.json"),
};

export async function loadCatalog(locale: AppLocale): Promise<Catalog> {
  return locale === "en" ? {} : (await LOADERS[locale]()).default;
}
