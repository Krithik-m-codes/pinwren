// RFC 4180 CSV for round exports. Cells that a spreadsheet would read as a formula (=, +, -, @, tab,
// CR) get a leading apostrophe, so a reporter can't plant `=HYPERLINK(…)` in someone's Excel.

const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s =
    value instanceof Date ? value.toISOString() : typeof value === "string" ? value : JSON.stringify(value);
  if (FORMULA.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  // BOM so Excel opens UTF-8 correctly; CRLF line ends per RFC 4180.
  return `\uFEFF${[header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
