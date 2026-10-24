import sharp from "sharp";
import potrace from "potrace";
import { readFileSync, writeFileSync } from "node:fs";
const SRC = "../source/pinwren-logo-original.png";
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const X0 = 140,
  X1 = 705,
  Y0 = 120,
  Y1 = 600; // mark region with margin
const w = X1 - X0,
  h = Y1 - Y0;
const ink = new Uint8Array(w * h);
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++) {
    const i = (y + Y0) * W + (x + X0);
    const r = data[i * 4],
      g = data[i * 4 + 1],
      b = data[i * 4 + 2],
      a = data[i * 4 + 3];
    ink[y * w + x] = a > 128 && ((r > 170 && g < 150 && b < 130 && r - g > 80) || r + g + b < 260) ? 1 : 0;
  }
// Flood the background from the region border; unreached non-ink pixels are inside the mark.
const seen = new Uint8Array(w * h);
const q = [];
for (let x = 0; x < w; x++) {
  q.push(x, (h - 1) * w + x);
}
for (let y = 0; y < h; y++) {
  q.push(y * w, y * w + w - 1);
}
while (q.length) {
  const p = q.pop();
  if (seen[p] || ink[p]) continue;
  seen[p] = 1;
  const x = p % w,
    y = (p / w) | 0;
  if (x > 0) q.push(p - 1);
  if (x < w - 1) q.push(p + 1);
  if (y > 0) q.push(p - w);
  if (y < h - 1) q.push(p + w);
}
const out = Buffer.alloc(W * H, 255);
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++) {
    const p = y * w + x;
    if (!seen[p]) out[(y + Y0) * W + x + X0] = 0;
  } // inner area + ink = full silhouette
const sil = await sharp(out, { raw: { width: W, height: H, channels: 1 } })
  .png()
  .toBuffer();
const trace = (buf) =>
  new Promise((res, rej) =>
    potrace.trace(buf, { threshold: 128, turdSize: 30, optTolerance: 0.5 }, (e, svg) =>
      e ? rej(e) : res(svg),
    ),
  );
const d = [...(await trace(sil)).matchAll(/ d="([^"]+)"/g)].map((m) => m[1]).join(" ");
const p = JSON.parse(readFileSync("paths.json", "utf8"));
p.mark.silhouette = d;
writeFileSync("paths.json", JSON.stringify(p));
console.log("silhouette", d.length);
