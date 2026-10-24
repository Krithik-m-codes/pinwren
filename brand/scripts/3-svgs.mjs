import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { optimize } from "svgo";
const p = JSON.parse(readFileSync("paths.json", "utf8"));
const OUT = "..";
mkdirSync(OUT, { recursive: true });
const ORANGE = "#F04424",
  NAVY = "#17243A",
  WHITE = "#FFFFFF";
const svg = (viewBox, body, title) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>`;
const path = (d, fill, rule = "evenodd") => `<path fill="${fill}" fill-rule="${rule}" d="${d}"/>`;
const mark = ({ face, bird, detail }) =>
  (face ? path(p.mark.silhouette, face, "nonzero") : "") +
  path(p.mark.orange, bird) +
  path(p.mark.navy, detail);
const word = ({ letters, dot }) => path(p.word.navy, letters) + path(p.word.orange, dot);
const FULL = "145 120 1906 482"; // mark x159–694, word x710–2037, y136–586
const MARK = "126 61 600 600";
const files = {
  "pinwren-logo.svg": svg(
    FULL,
    mark({ face: WHITE, bird: ORANGE, detail: NAVY }) + word({ letters: NAVY, dot: ORANGE }),
    "Pinwren",
  ),
  "pinwren-logo-dark.svg": svg(
    FULL,
    mark({ face: WHITE, bird: ORANGE, detail: NAVY }) + word({ letters: WHITE, dot: ORANGE }),
    "Pinwren",
  ),
  "pinwren-logo-mono.svg": svg(
    FULL,
    mark({ bird: NAVY, detail: NAVY }) + word({ letters: NAVY, dot: NAVY }),
    "Pinwren",
  ),
  "pinwren-logo-reversed.svg": svg(
    FULL,
    `<rect x="145" y="120" width="1906" height="482" fill="${NAVY}"/>` +
      mark({ bird: WHITE, detail: WHITE }) +
      word({ letters: WHITE, dot: WHITE }),
    "Pinwren",
  ),
  "pinwren-mark.svg": svg(MARK, mark({ face: WHITE, bird: ORANGE, detail: NAVY }), "Pinwren"),
  "pinwren-mark-mono.svg": svg(MARK, mark({ bird: NAVY, detail: NAVY }), "Pinwren"),
};
for (const [name, s] of Object.entries(files)) {
  const o = optimize(s, {
    multipass: true,
    floatPrecision: 1,
    plugins: [{ name: "preset-default", params: { overrides: { removeViewBox: false } } }],
  }).data;
  writeFileSync(`${OUT}/${name}`, o + "\n");
  console.log(name, o.length);
}
