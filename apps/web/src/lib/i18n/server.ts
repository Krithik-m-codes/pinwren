import "server-only";
import { headers } from "next/headers";
import { type AppLocale, pickLocale } from "./translate";

export { loadCatalog } from "./loaders";

/** The language to render this request in: the account's choice, else the browser's, else English. */
export async function requestLocale(preferred: string | null | undefined): Promise<AppLocale> {
  return pickLocale(preferred, (await headers()).get("accept-language"));
}
