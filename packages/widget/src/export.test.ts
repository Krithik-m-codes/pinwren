import { describe, expect, it } from "vitest";
import { BOM, cleanPageUrl, csvCell, deepLink, fileName, toCsv, toJson, toRows } from "./export";

const pin = (over: Partial<Parameters<typeof toRows>[0][number]> = {}) => ({
  id: "fb_1",
  number: 1,
  kind: "comment",
  status: "open",
  title: null,
  body: "Logo too small",
  reporterName: "Sarah Miller",
  createdAt: "2026-10-21T10:00:00.000Z",
  ...over,
});

describe("csvCell", () => {
  it("leaves plain values alone", () => {
    expect(csvCell("hello")).toBe("hello");
    expect(csvCell(42)).toBe("42");
    expect(csvCell("")).toBe("");
  });

  it("quotes delimiters, quotes and line breaks (RFC 4180)", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line 1\nline 2")).toBe('"line 1\nline 2"');
    expect(csvCell("cr\r\nlf")).toBe('"cr\r\nlf"');
  });

  it("neutralises cells a spreadsheet would run as a formula", () => {
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe('"\'=HYPERLINK(""http://evil"",""x"")"');
    expect(csvCell("+1+1")).toBe("'+1+1");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tcmd")).toBe("'\tcmd");
    expect(csvCell("\rcmd")).toBe('"\'\rcmd"');
    // Only a leading trigger counts; numbers are numbers.
    expect(csvCell("a=b")).toBe("a=b");
    expect(csvCell(-1)).toBe("-1");
  });
});

describe("rows, CSV and JSON", () => {
  const page = "https://lumen.example/shop?sort=price&pinwren=fb_9#grid";

  it("drops our own deep-link parameter from the page URL and builds per-item deep links", () => {
    expect(cleanPageUrl(page)).toBe("https://lumen.example/shop?sort=price#grid");
    expect(deepLink("https://lumen.example/shop?sort=price#grid", "fb_1")).toBe(
      "https://lumen.example/shop?sort=price&pinwren=fb_1#grid",
    );
    expect(deepLink("https://lumen.example/", "a b")).toBe("https://lumen.example/?pinwren=a+b");
  });

  it("maps pins to the contract's columns", () => {
    const [r] = toRows([pin({ title: "Logo", reporterName: null })], page);
    expect(r).toEqual({
      number: 1,
      kind: "comment",
      status: "open",
      title: "Logo",
      body: "Logo too small",
      author: "",
      created: "2026-10-21T10:00:00.000Z",
      pageUrl: "https://lumen.example/shop?sort=price#grid",
      deepLink: "https://lumen.example/shop?sort=price&pinwren=fb_1#grid",
    });
  });

  it("writes a UTF-8 BOM, a header row and CRLF-separated rows", () => {
    const csv = toCsv(
      toRows(
        [
          pin(),
          pin({ id: "fb_2", number: 2, body: 'Price says "₹0", should be ₹780\non mobile', kind: "bug" }),
        ],
        page,
      ),
    );
    expect(csv.startsWith(BOM)).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe("Number,Kind,Status,Title,Body,Author,Created,Page URL,Deep link");
    expect(lines[1]).toBe(
      "1,comment,open,,Logo too small,Sarah Miller,2026-10-21T10:00:00.000Z,https://lumen.example/shop?sort=price#grid,https://lumen.example/shop?sort=price&pinwren=fb_1#grid",
    );
    expect(csv).toContain('"Price says ""₹0"", should be ₹780\non mobile"');
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("guards every text column against formula injection", () => {
    const csv = toCsv(toRows([pin({ title: "=1+1", body: "@cmd", reporterName: "-Bob" })], page));
    expect(csv).toContain(",'=1+1,'@cmd,'-Bob,");
  });

  it("JSON keeps the raw values", () => {
    const data = JSON.parse(toJson(toRows([pin({ title: "=1+1" })], page)));
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe("=1+1");
    expect(data[0].deepLink).toContain("pinwren=fb_1");
  });

  it("names the file after the site and the day", () => {
    const d = new Date("2026-10-21T23:00:00Z");
    expect(fileName("https://www.lumen.example/shop", "csv", d)).toBe(
      "pinwren-www.lumen.example-2026-10-21.csv",
    );
    expect(fileName("not a url", "json", d)).toBe("pinwren-page-2026-10-21.json");
  });
});
