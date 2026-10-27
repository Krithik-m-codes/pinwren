"use client";

import { useEffect } from "react";
import { loadCatalog } from "./loaders";
import { setShellLocale } from "./provider";
import { pickLocale } from "./translate";

/**
 * For pages with no signed-in account (sign-in, sign-up, invitations, onboarding): follow the browser's
 * language. The page arrives in English and switches as soon as the language file has loaded.
 */
export function BrowserLocale() {
  useEffect(() => {
    const locale = pickLocale(...navigator.languages);
    if (locale === "en") return;
    let live = true;
    void loadCatalog(locale)
      .then((catalog) => {
        if (live) setShellLocale(locale, catalog);
      })
      .catch(() => undefined); // English stays
    return () => {
      live = false;
    };
  }, []);
  return null;
}
