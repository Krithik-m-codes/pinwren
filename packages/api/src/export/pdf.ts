// A small text-only PDF 1.4 writer for round exports (F-055). Standard Type 1 fonts (Helvetica) need no
// embedding, so there are no font files to ship or bundle and no headless browser. Untrusted text can't
// inject PDF syntax: every string is reduced to WinAnsi bytes and written as an escaped literal
// (`\\`, `\(`, `\)`, octal for bytes ≥ 128), and nothing but text is ever drawn.

export type PdfItem = {
  heading: string;
  meta: string;
  body: string;
};
export type PdfDocument = { title: string; subtitle: string; items: PdfItem[] };

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 48;
const TEXT_W = PAGE_W - 2 * MARGIN;
const MAX_BODY = 2000;

// Helvetica advance widths (1/1000 em) for ASCII 32–126, from the standard AFM.
// prettier-ignore
const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556,
  556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278,
  500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469,
  556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500,
  278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
/** Bold is a little wider; measuring with a margin keeps lines inside the box. */
const BOLD_FACTOR = 1.1;

// Unicode → WinAnsiEncoding for the characters people actually type that aren't in Latin-1.
const WIN_ANSI: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

/** Text → WinAnsi byte values; anything the standard fonts can't show becomes "?". */
export function toWinAnsi(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 63;
    if (cp >= 32 && cp <= 126) out.push(cp);
    else if (cp >= 160 && cp <= 255) out.push(cp);
    else if (WIN_ANSI[cp] !== undefined) out.push(WIN_ANSI[cp]);
    else if (cp === 9) out.push(32);
    else out.push(63);
  }
  return out;
}

/** A PDF literal string `( … )` holding exactly these bytes. */
export function pdfString(text: string): string {
  let s = "(";
  for (const b of toWinAnsi(text)) {
    if (b === 0x5c || b === 0x28 || b === 0x29) s += `\\${String.fromCharCode(b)}`;
    else if (b >= 128) s += `\\${b.toString(8).padStart(3, "0")}`;
    else s += String.fromCharCode(b);
  }
  return `${s})`;
}

function measure(text: string, size: number, bold: boolean): number {
  let units = 0;
  for (const b of toWinAnsi(text)) units += b >= 32 && b <= 126 ? (WIDTHS[b - 32] ?? 556) : 556;
  return (units / 1000) * size * (bold ? BOLD_FACTOR : 1);
}

/** Greedy word wrap; words longer than a line are cut. */
export function wrap(text: string, size: number, width: number, bold = false): string[] {
  const lines: string[] = [];
  for (const para of text.replace(/\r\n?/g, "\n").split("\n")) {
    let line = "";
    for (const word of para.split(/ +/)) {
      let w = word;
      while (measure(w, size, bold) > width) {
        let cut = w.length - 1;
        while (cut > 1 && measure(w.slice(0, cut), size, bold) > width) cut--;
        if (line) {
          lines.push(line);
          line = "";
        }
        lines.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      const next = line ? `${line} ${w}` : w;
      if (measure(next, size, bold) <= width) line = next;
      else {
        lines.push(line);
        line = w;
      }
    }
    lines.push(line);
  }
  return lines;
}

type Run = { x: number; y: number; size: number; bold: boolean; gray: boolean; text: string };

/** Lay the document out on A4 pages and serialise it. */
export function renderPdf(doc: PdfDocument, now = new Date()): Uint8Array<ArrayBuffer> {
  const pages: Run[][] = [[]];
  let y = PAGE_H - MARGIN;
  const page = () => pages[pages.length - 1] ?? [];
  const ensure = (h: number) => {
    if (y - h < MARGIN + 16) {
      pages.push([]);
      y = PAGE_H - MARGIN;
    }
  };
  const block = (text: string, size: number, bold: boolean, gray: boolean, after = 0) => {
    const leading = size * 1.35;
    for (const line of wrap(text, size, TEXT_W, bold)) {
      ensure(leading);
      y -= leading;
      page().push({ x: MARGIN, y, size, bold, gray, text: line });
    }
    y -= after;
  };

  block(doc.title, 18, true, false, 2);
  block(doc.subtitle, 9, false, true, 14);
  if (!doc.items.length) block("No feedback in this round.", 10, false, true);
  for (const item of doc.items) {
    ensure(48);
    block(item.heading, 11, true, false, 1);
    if (item.meta) block(item.meta, 8, false, true, 3);
    const body = item.body.length > MAX_BODY ? `${item.body.slice(0, MAX_BODY - 1)}…` : item.body;
    block(body, 9.5, false, false, 12);
  }

  // Objects: 1 catalog, 2 page tree, 3 Helvetica, 4 Helvetica-Bold, 5 info, then page + content pairs.
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 6 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  const stamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  objects[5] = `<< /Title ${pdfString(doc.title)} /Producer (Pinwren) /CreationDate (D:${stamp}Z) >>`;
  pages.forEach((runs, i) => {
    const id = pageIds[i] ?? 0;
    const footer: Run = {
      x: MARGIN,
      y: MARGIN - 18,
      size: 8,
      bold: false,
      gray: true,
      text: `${doc.title} · page ${i + 1} of ${pages.length}`,
    };
    const ops = [...runs, footer].map(
      (r) =>
        `BT /${r.bold ? "F2" : "F1"} ${r.size} Tf ${r.gray ? "0.45 g" : "0.1 g"} ${r.x.toFixed(2)} ${r.y.toFixed(2)} Td ${pdfString(r.text)} Tj ET`,
    );
    const content = ops.join("\n");
    objects[id] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${id + 1} 0 R >>`;
    objects[id + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });

  // Everything above is 7-bit ASCII, so string length = byte length for the xref offsets.
  let out = "%PDF-1.4\n%âãÏÓ\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out, "latin1");
    out += `${id} 0 obj\n${objects[id] ?? "null"}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++)
    out += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}
