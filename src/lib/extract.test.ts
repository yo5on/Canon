import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, extract, ExtractError, fromHex, locate, MAX_FILE_BYTES, sniff, textColours, validateUpload } from "./extract";

const fx = (n: string) => new Uint8Array(readFileSync(path.join(__dirname, "__fixtures__", n)));

async function fails(name: string, buf: Uint8Array) {
  try {
    await extract(name, buf);
  } catch (e) {
    expect(e).toBeInstanceOf(ExtractError);
    return (e as ExtractError).message;
  }
  throw new Error("expected extraction to fail");
}

describe("file validation", () => {
  it("identifies files by magic bytes, not by name", () => {
    expect(sniff(fx("brochure.pdf"))?.kind).toBe("pdf");
    expect(sniff(fx("newsletter.docx"))?.kind).toBe("docx");
    expect(sniff(fx("banner.png"))).toEqual({ kind: "image", mime: "image/png" });
    expect(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe("image/jpeg");
    expect(sniff(fx("notes.txt"))).toBeNull();
    // a PDF renamed to .png is still a PDF
    expect(validateUpload("banner.png", 100, fx("brochure.pdf")).kind).toBe("pdf");
  });

  it("rejects empty, oversized and unsupported files with readable messages", () => {
    expect(() => validateUpload("a.pdf", 0, new Uint8Array())).toThrow(/empty/);
    expect(() => validateUpload("a.pdf", MAX_FILE_BYTES + 1, fx("brochure.pdf"))).toThrow(/limit is 10 MB/);
    expect(() => validateUpload("notes.txt", 34, fx("notes.txt"))).toThrow(/Unsupported file/);
    expect(() => validateUpload("old.doc", 34, fx("notes.txt"))).toThrow(/\.doc files/);
  });
});

describe("PDF extraction", () => {
  it("extracts text page by page and maps offsets back to pages", async () => {
    const { body, extraction } = await extract("brochure.pdf", fx("brochure.pdf"));
    expect(extraction.kind).toBe("pdf");
    expect(extraction.pages).toBe(2);
    expect(body).toContain("Our revolutionary dashboard helps users ship campaigns in minutes.");
    const at = body.indexOf("more than 5,000 customers");
    expect(at).toBeGreaterThan(0);
    expect(locate(extraction.segments, at)?.label).toBe("Page 2");
    expect(locate(extraction.segments, body.indexOf("revolutionary"))?.label).toBe("Page 1");
  });

  it("refuses a corrupt PDF without crashing", async () => {
    expect(await fails("broken.pdf", fx("corrupt.pdf"))).toMatch(/could not be read|no text layer/);
  });
});

describe("DOCX extraction", () => {
  it("extracts paragraphs with paragraph references", async () => {
    const { body, extraction } = await extract("newsletter.docx", fx("newsletter.docx"));
    expect(body).toContain("Trusted by over 1,000 customers");
    expect(locate(extraction.segments, body.indexOf("Our users"))?.label).toBe("Paragraph 3");
  });

  it("refuses a zip that is not a Word document", async () => {
    expect(await fails("x.docx", fx("not-a-docx.docx"))).toMatch(/Word document/);
  });
});

describe("image OCR and measurements", () => {
  it("reads the banner text, measures line contrast and the palette", async () => {
    const { body, extraction } = await extract("banner.png", fx("banner.png"));
    expect(body).toMatch(/revolutionary dashboard/i);
    expect(body).toMatch(/Trusted by over 1,000 customers/i);
    const img = extraction.image!;
    expect([img.width, img.height]).toEqual([1200, 628]);
    // brand green dominates; the orange badge is measured with its region
    expect(img.palette[0].hex).toBe("#28645A");
    const orange = img.palette.find((p) => p.hex.startsWith("#F"));
    expect(orange?.region.x).toBeGreaterThanOrEqual(850);
    const line = (t: RegExp) => extraction.segments.find((s) => t.test(body.slice(s.start, s.end)))!;
    expect(line(/revolutionary/i).contrast).toBeGreaterThan(6); // white on green ≈ 6.9:1
    expect(line(/Trusted/i).contrast).toBeLessThan(3); // #6E9C93 on #28645A ≈ 2.3:1
    expect(line(/Trusted/i).region!.y).toBeGreaterThan(380);
  }, 60_000);

  it("accepts an image with no text and says so", async () => {
    const { body, extraction } = await extract("blank.png", fx("blank.png"));
    expect(body).toBe("");
    expect(extraction.warnings.join(" ")).toMatch(/No readable text/);
  }, 60_000);
});

describe("colour maths", () => {
  it("matches WCAG reference values", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio(fromHex("#FFFFFF")!, fromHex("#28645A")!)).toBeCloseTo(6.86, 1);
    expect(fromHex("nope")).toBeNull();
  });

  it("separates text from background in a two-colour region", () => {
    const px: number[] = [];
    for (let i = 0; i < 100; i++) px.push(...(i < 20 ? [255, 255, 255] : [40, 100, 90]));
    const tc = textColours(Uint8Array.from(px), 3)!;
    expect(tc.fg).toBe("#FFFFFF");
    expect(tc.bg).toBe("#28645A");
  });
});
