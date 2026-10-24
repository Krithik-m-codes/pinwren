import { readFileSync, writeFileSync } from "node:fs";
import { optimize } from "svgo";
const p = JSON.parse(readFileSync("paths.json", "utf8"));
const opt = (d) =>
  optimize(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`, {
    floatPrecision: 1,
    plugins: ["convertPathData"],
  }).data.match(/ d="([^"]+)"/)[1];
const out = {
  face: opt(p.mark.silhouette),
  bird: opt(p.mark.orange),
  detail: opt(p.mark.navy),
  letters: opt(p.word.navy),
  dot: opt(p.word.orange),
};
const ts = `// Generated from the traced logo (brand/scripts/trace.mjs). Edit the SVGs in brand/, not these strings.
// viewBox: full logo "${"145 120 1906 482"}", mark "126 61 600 600".
export const LOGO_VIEWBOX = "145 120 1906 482";
export const MARK_VIEWBOX = "126 61 600 600";
/** White face behind the bird (non-zero fill), so the mark reads on any background. */
export const MARK_FACE = ${JSON.stringify(out.face)};
/** The orange bird, pin and wing (even-odd fill). */
export const MARK_BIRD = ${JSON.stringify(out.bird)};
/** Eye and speech lines (navy). */
export const MARK_DETAIL = ${JSON.stringify(out.detail)};
/** "Pinwren" letters (even-odd fill). */
export const WORD_LETTERS = ${JSON.stringify(out.letters)};
/** The orange dot on the i. */
export const WORD_DOT = ${JSON.stringify(out.dot)};
`;
writeFileSync("brand-paths.ts", ts);
console.log(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])), ts.length);
