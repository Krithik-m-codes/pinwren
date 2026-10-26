import "server-only";
import { headers } from "next/headers";
import { en } from "./en";
import { type AppLocale, type Catalog, pickLocale } from "./translate";

/** One dynamic import per language, so a reader's bundle and payload carry only their own. */
const LOADERS: Record<Exclude<AppLocale, "en">, () => Promise<{ default: Catalog }>> = {
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

/** The language to render this request in: the account's choice, else the browser's, else English. */
export async function requestLocale(preferred: string | null | undefined): Promise<AppLocale> {
  return pickLocale(preferred, (await headers()).get("accept-language"));
}

export async function loadCatalog(locale: AppLocale): Promise<Catalog> {
  if (locale === "en") return {};
  return (await LOADERS[locale]()).default;
}

export { en };
