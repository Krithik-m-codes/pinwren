import { en, type Key } from "./en";
import { translate, type Vars } from "./translate";

/** A translate function, for helpers that are not components (they take one as a parameter). */
export type TFn = (key: Key, vars?: Vars) => string;

/** English only, with no React: for tests and for code that runs outside the component tree. */
export const tEn: TFn = (key, vars) => translate({}, en, key, vars);
