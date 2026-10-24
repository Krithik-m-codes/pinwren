import sharp from "sharp";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const B = "../";
mkdirSync(B + "png", { recursive: true });
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const svg = (f) => readFileSync(B + f);
const render = (f, w, h) =>
  sharp(svg(f), { density: 1200 })
    .resize(w, h ?? null, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png();
// Logos (transparent)
await render("pinwren-logo.svg", 1200).toFile(B + "png/pinwren-logo-1200.png");
await render("pinwren-logo.svg", 600).toFile(B + "png/pinwren-logo-600.png");
await render("pinwren-logo-dark.svg", 1200).toFile(B + "png/pinwren-logo-dark-1200.png");
await render("pinwren-logo-mono.svg", 1200).toFile(B + "png/pinwren-logo-mono-1200.png");
await render("pinwren-logo-reversed.svg", 1200).toFile(B + "png/pinwren-logo-reversed-1200.png");
await render("pinwren-mark.svg", 512, 512).toFile(B + "png/pinwren-mark-512.png");
// Email header logo: 2x for a 160 px slot.
await render("pinwren-logo.svg", 320).toFile(B + "png/pinwren-logo-email.png");
// Small mark + app icons (opaque white tile, mark at ~78 %)
const tile = async (size, scale, bg = WHITE) => {
  const inner = Math.round(size * scale);
  const mark = await render(
    size <= 48 ? "pinwren-mark-small.svg" : "pinwren-mark-small.svg",
    inner,
    inner,
  ).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: mark, gravity: "center" }])
    .png()
    .toBuffer();
};
for (const s of [16, 32, 48]) await render("pinwren-mark-small.svg", s, s).toFile(B + `png/favicon-${s}.png`);
writeFileSync(B + "png/apple-touch-icon.png", await tile(180, 0.78));
writeFileSync(B + "png/icon-192.png", await tile(192, 0.78));
writeFileSync(B + "png/icon-512.png", await tile(512, 0.78));
writeFileSync(B + "png/icon-512-maskable.png", await tile(512, 0.62));
// favicon.ico: PNG-compressed entries (16, 32, 48) — supported by every current browser.
const pngs = [16, 32, 48].map((s) => readFileSync(B + `png/favicon-${s}.png`));
const head = Buffer.alloc(6 + 16 * pngs.length);
head.writeUInt16LE(0, 0);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(pngs.length, 4);
let off = head.length;
pngs.forEach((p, i) => {
  const s = [16, 32, 48][i],
    e = 6 + 16 * i;
  head[e] = s;
  head[e + 1] = s;
  head[e + 2] = 0;
  head[e + 3] = 0;
  head.writeUInt16LE(1, e + 4);
  head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(p.length, e + 8);
  head.writeUInt32LE(off, e + 12);
  off += p.length;
});
writeFileSync(B + "favicon.ico", Buffer.concat([head, ...pngs]));
// GitHub social preview 1280×640
const logo = await render("pinwren-logo.svg", 860).toBuffer();
const text = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640"><text x="640" y="500" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="38" fill="#17243A">Pinned comments and annotated bug reports for any website</text><text x="640" y="556" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="28" fill="#4A5568">Open source · Self-hosted</text><rect x="0" y="628" width="1280" height="12" fill="#F04424"/></svg>`,
);
await sharp({ create: { width: 1280, height: 640, channels: 4, background: WHITE } })
  .composite([
    { input: logo, top: 150, left: 210 },
    { input: text, top: 0, left: 0 },
  ])
  .png()
  .toFile(B + "social-preview.png");
console.log("ok");
