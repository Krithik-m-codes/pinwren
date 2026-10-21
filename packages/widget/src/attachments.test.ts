import { describe, expect, it } from "vitest";
import { fileName, MAX_BYTES, sanitizeAttachments, validateFiles } from "./attachments";

const f = (name: string, type: string, size = 1000) => ({ name, type, size });

describe("validateFiles", () => {
  it("accepts images and PDFs up to 5 MB", () => {
    const files = [
      f("a.png", "image/png"),
      f("b.jpg", "image/jpeg"),
      f("c.pdf", "application/pdf", MAX_BYTES),
    ];
    expect(validateFiles(0, files)).toEqual({ accepted: files, errors: [] });
    expect(validateFiles(0, [f("d.webp", "image/webp"), f("e.gif", "image/gif")]).accepted).toHaveLength(2);
  });

  it("rejects other types and oversized files with a reason each", () => {
    const r = validateFiles(0, [
      f("x.svg", "image/svg+xml"),
      f("big.png", "image/png", MAX_BYTES + 1),
      f("z.exe", ""),
    ]);
    expect(r.accepted).toEqual([]);
    expect(r.errors).toEqual([
      "x.svg: only images and PDFs can be attached",
      "big.png is larger than 5 MB",
      "z.exe: only images and PDFs can be attached",
    ]);
  });

  it("stops at 3 files in total, counting those already attached", () => {
    const r = validateFiles(2, [f("1.png", "image/png"), f("2.png", "image/png"), f("3.png", "image/png")]);
    expect(r.accepted.map((x) => x.name)).toEqual(["1.png"]);
    expect(r.errors).toEqual(["You can attach up to 3 files"]); // reported once
  });
});

describe("fileName", () => {
  it("names pasted clipboard images, keeps real names", () => {
    const now = new Date("2026-10-21T09:05:07Z");
    expect(fileName(f("image.png", "image/png"), now)).toBe("pasted-2026-10-21-09-05-07.png");
    expect(fileName(f("", "image/jpeg"), now)).toBe("pasted-2026-10-21-09-05-07.jpeg");
    expect(fileName(f("receipt.png", "image/png"), now)).toBe("receipt.png");
  });
});

describe("sanitizeAttachments", () => {
  it("drops records whose type or data URL don't match, and caps at 3", () => {
    const ok = { name: "a.png", contentType: "image/png", dataUrl: "data:image/png;base64,AAAA", size: 3 };
    const lies = { ...ok, dataUrl: "data:text/html;base64,AAAA" };
    const html = { ...ok, contentType: "text/html", dataUrl: "data:text/html;base64,AAAA" };
    expect(sanitizeAttachments([ok, lies, html, null])).toEqual([ok]);
    expect(sanitizeAttachments([ok, ok, ok, ok])).toHaveLength(3);
    expect(sanitizeAttachments("x")).toEqual([]);
  });
});
