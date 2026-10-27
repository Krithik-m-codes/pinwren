"use client";

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { en, type Key } from "./en";
import {
  type AppLocale,
  type Catalog,
  indexByText,
  plural,
  translate,
  translateMessage,
  type Vars,
} from "./translate";

const BY_TEXT = indexByText(en);

// Where a component finds its language. Page content sits under <I18nProvider>, which the server fills in
// (so the server HTML is already in the reader's language). The sidebar is part of the prerendered shell and
// cannot know the language on the server: it follows a small store the provider updates after hydration,
// so it starts in English and switches a moment later.

type State = { locale: AppLocale; catalog: Catalog };
const ENGLISH: State = { locale: "en", catalog: {} };

let shell: State = ENGLISH;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
/** For pages with no account: show `locale` in the shell and everything outside an <I18nProvider>. */
export function setShellLocale(locale: AppLocale, catalog: Catalog) {
  setShell({ locale, catalog });
  document.documentElement.lang = locale;
}

const setShell = (next: State) => {
  if (shell.locale === next.locale && shell.catalog === next.catalog) return;
  shell = next;
  for (const fn of listeners) fn();
};

/** `tm()` for code that is not a component (the api layer's `errorMessage`): follows the shell's language. */
export const translateNow = (message: string) => translateMessage(shell.catalog, en, BY_TEXT, message);

const Context = createContext<State | null>(null);

export function I18nProvider({
  locale,
  catalog,
  children,
}: {
  locale: AppLocale;
  /** The language's strings; empty for English, which is built in. */
  catalog: Catalog;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ locale, catalog }), [locale, catalog]);
  useEffect(() => {
    setShell(value);
    document.documentElement.lang = value.locale;
  }, [value]);
  return <Context value={value}>{children}</Context>;
}

export function useI18n() {
  const fromTree = useContext(Context);
  const fromShell = useSyncExternalStore(
    subscribe,
    () => shell,
    () => ENGLISH,
  );
  const { locale, catalog } = fromTree ?? fromShell;
  return useMemo(
    () => ({
      locale,
      /** Translate `key`; `{name}` placeholders come from `vars`. */
      t: (key: Key, vars?: Vars) => translate(catalog, en, key, vars),
      /** A counted phrase: `<stem>_one` / `_other` (and `_few` / `_many` where the language has them). */
      tn: (stem: string, n: number, vars?: Vars) => plural(catalog, en, locale, stem, n, vars),
      /** Translate a message written as English text (validation errors); other text is returned unchanged. */
      tm: (message: string) => translateMessage(catalog, en, BY_TEXT, message),
    }),
    [locale, catalog],
  );
}

export const useT = () => useI18n().t;
