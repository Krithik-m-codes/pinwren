import sharp from "sharp";
import potrace from "potrace";
import { writeFileSync } from "node:fs";
const SRC = "../source/pinwren-logo-original.png";
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const SPLIT = 705;
const isOrange = (r, g, b) => r > 170 && g < 150 && b < 130 && r - g > 80;
const isNavy = (r, g, b) => r + g + b < 260;
const bbox = { mark: [W, H, 0, 0], word: [W, H, 0, 0] };
function mask(pred, region) {
  const out = Buffer.alloc(W * H, 255);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const r = data[i * 4],
        g = data[i * 4 + 1],
        b = data[i * 4 + 2],
        a = data[i * 4 + 3];
      const inRegion = region === "mark" ? x < SPLIT : x >= SPLIT;
      if (inRegion && a > 128 && pred(r, g, b)) {
        out[i] = 0;
        const bb = bbox[region];
        bb[0] = Math.min(bb[0], x);
        bb[1] = Math.min(bb[1], y);
        bb[2] = Math.max(bb[2], x);
        bb[3] = Math.max(bb[3], y);
      }
    }
  return sharp(out, { raw: { width: W, height: H, channels: 1 } })
    .png()
    .toBuffer();
}
const trace = (buf) =>
  new Promise((res, rej) =>
    potrace.trace(buf, { threshold: 128, turdSize: 30, optTolerance: 0.5, alphaMax: 1 }, (e, svg) =>
      e ? rej(e) : res(svg),
    ),
  );
const pathOf = (svg) => [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]).join(" ");
const out = {};
for (const region of ["mark", "word"]) {
  out[region] = {
    orange: pathOf(await trace(await mask(isOrange, region))),
    navy: pathOf(await trace(await mask(isNavy, region))),
  };
}
out.bbox = bbox;
writeFileSync("paths.json", JSON.stringify(out));
console.log(
  JSON.stringify(bbox),
  Object.fromEntries(
    Object.entries(out)
      .filter(([k]) => k !== "bbox")
      .map(([k, v]) => [k, [v.orange.length, v.navy.length]]),
  ),
);
