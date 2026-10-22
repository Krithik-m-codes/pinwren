export const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Black or white text, whichever reads better on `hex` (WCAG relative luminance). */
export function contrastText(hex: string): string {
  const h = hex.length === 4 ? hex.replace(/^#(.)(.)(.)$/, "#$1$1$2$2$3$3") : hex;
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c = 0) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const l = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return l > 0.4 ? "#111118" : "#ffffff";
}
