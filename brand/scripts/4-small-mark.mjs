import { readFileSync, writeFileSync } from "node:fs";
import { optimize } from "svgo";
import sharp from "sharp";
const p = JSON.parse(readFileSync("paths.json", "utf8"));
const Y0 = 380,
  TIP_X = 427.2,
  TIP_Y = 587,
  STRETCH = 72,
  NARROW = 0.2;
// potrace writes every point as an absolute "x y" pair, so each pair can be moved on its own.
const mapPairs = (d, f) =>
  d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x, y) => {
    const [nx, ny] = f(+x, +y);
    return `${nx.toFixed(1)} ${ny.toFixed(1)}`;
  });
const pin = (x, y) => {
  if (y <= Y0) return [x, y];
  const t = (y - Y0) / (TIP_Y - Y0);
  return [TIP_X + (x - TIP_X) * (1 - NARROW * t), y + STRETCH * t];
};
const eye = p.mark.navy.split(/(?=M )/)[0];
const ECX = 550.5,
  ECY = 268.5,
  ES = 1.3;
const big = (x, y) => [ECX + (x - ECX) * ES, ECY + (y - ECY) * ES];
const sil = mapPairs(p.mark.silhouette, pin),
  org = mapPairs(p.mark.orange, pin);
const body = `<mask id="f"><path fill="#fff" d="${sil}"/><path fill="#000" fill-rule="evenodd" d="${org}"/></mask><path fill="#F04424" d="${sil}"/><circle cx="542" cy="262" r="82" fill="#FFFFFF" mask="url(#f)"/><path fill="#17243A" d="${mapPairs(eye, big)}"/>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="150 128 560 560" role="img" aria-label="Pinwren"><title>Pinwren</title>${body}</svg>`;
const o = optimize(svg, {
  multipass: true,
  floatPrecision: 0,
  plugins: [{ name: "preset-default", params: { overrides: { removeViewBox: false } } }],
}).data;
writeFileSync(process.env.OUT ?? "../pinwren-mark-small.svg", o + "\n");
console.log(o.length);
const tiles = [];
for (const s of [16, 24, 32, 48, 128])
  tiles.push(await sharp(Buffer.from(o), { density: 600 }).resize(s, s).png().toBuffer());
let left = 10;
const comp = [];
for (const t of tiles) {
  const m = await sharp(t).metadata();
  comp.push({
    input: await sharp(t)
      .resize(m.width * 3, m.height * 3, { kernel: "nearest" })
      .png()
      .toBuffer(),
    left,
    top: 10,
  });
  left += m.width * 3 + 20;
}
await sharp({ create: { width: left, height: 410, channels: 4, background: "#ffffff" } })
  .composite(comp)
  .png()
  .toFile("small.png");
