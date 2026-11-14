// Multimodal intake (Round 3 · Improvement 1). Turns an uploaded PDF, DOCX or image into the plain text body that the
// existing pipeline checks, plus segments that map every body offset back to a page, paragraph or image region.
// File type is decided by magic bytes, never by the name or the browser's MIME type. Server-only.
import { createHash } from "node:crypto";
import path from "node:path";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_PAGES = 60;
export const MAX_BODY_CHARS = 40_000;
const MAX_IMAGE_PIXELS = 40_000_000;

export type FileKind = "pdf" | "docx" | "image";

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Segment {
  label: string; // "Page 2", "Paragraph 4", "Line 1"
  start: number; // offsets into the extracted body
  end: number;
  region?: Region; // image lines only
  confidence?: number; // OCR, 0–100
  fg?: string; // image lines: measured text and background colours
  bg?: string;
  contrast?: number;
}

export interface PaletteColor {
  hex: string;
  share: number; // 0–1 of sampled pixels
  region: Region; // bounding box of the pixels nearest this colour, in image pixels
}

export interface Extraction {
  kind: FileKind;
  mime: string;
  method: string; // what produced the text, shown in the report
  segments: Segment[];
  pages?: number;
  image?: { width: number; height: number; palette: PaletteColor[]; ocr_confidence: number | null };
  warnings: string[];
}

export class ExtractError extends Error {
  constructor(
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** Identify the file by its first bytes. Returns null for anything Canon does not accept. */
export function sniff(buf: Uint8Array): { kind: FileKind; mime: string } | null {
  const b = (i: number) => buf[i];
  const ascii = (from: number, to: number) => String.fromCharCode(...buf.subarray(from, to));
  if (buf.length >= 5 && ascii(0, 5) === "%PDF-") return { kind: "pdf", mime: MIME.pdf };
  if (buf.length >= 8 && b(0) === 0x89 && ascii(1, 4) === "PNG") return { kind: "image", mime: MIME.png };
  if (buf.length >= 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return { kind: "image", mime: MIME.jpeg };
  if (buf.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { kind: "image", mime: MIME.webp };
  // DOCX is a zip; whether it really is a Word document is confirmed when mammoth opens word/document.xml.
  if (buf.length >= 4 && b(0) === 0x50 && b(1) === 0x4b && b(2) === 0x03 && b(3) === 0x04) return { kind: "docx", mime: MIME.docx };
  return null;
}

/** Size and type checks shared by the API route and its tests. */
export function validateUpload(name: string, size: number, buf: Uint8Array) {
  if (size === 0) throw new ExtractError("The file is empty.");
  if (size > MAX_FILE_BYTES) throw new ExtractError(`The file is ${(size / 1048576).toFixed(1)} MB. The limit is 10 MB.`, 413);
  const found = sniff(buf);
  const ext = path.extname(name).toLowerCase();
  if (!found) {
    if (ext === ".doc") throw new ExtractError("Old Word .doc files aren’t supported. Save it as .docx and upload again.", 415);
    throw new ExtractError("Unsupported file. Upload a PDF, a Word .docx, or a PNG, JPEG or WebP image.", 415);
  }
  return found;
}

export const sha256 = (buf: Uint8Array) => createHash("sha256").update(buf).digest("hex");

/** Joins text blocks into one body and records where each block landed. Blank blocks are kept as labels only. */
export function joinSegments(blocks: { label: string; text: string; extra?: Partial<Segment> }[], sep: string) {
  let body = "";
  const segments: Segment[] = [];
  for (const blk of blocks) {
    const text = blk.text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
    if (!text) continue;
    if (body) body += sep;
    segments.push({ label: blk.label, start: body.length, end: body.length + text.length, ...blk.extra });
    body += text;
  }
  return { body, segments };
}

/** Where an offset in the body came from, e.g. "Page 2". */
export function locate(segments: Segment[] | undefined, offset: number | null): Segment | null {
  if (!segments || offset === null) return null;
  return segments.find((s) => offset >= s.start && offset < s.end) ?? null;
}

function cap(body: string, warnings: string[]) {
  if (body.length <= MAX_BODY_CHARS) return body;
  warnings.push(`The extracted text was cut to the first ${MAX_BODY_CHARS.toLocaleString("en-GB")} characters.`);
  return body.slice(0, MAX_BODY_CHARS);
}

async function extractPdf(buf: Uint8Array): Promise<{ body: string; ex: Omit<Extraction, "kind" | "mime"> }> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  let pages: string[];
  let total: number;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    total = pdf.numPages;
    if (total > MAX_PDF_PAGES) throw new ExtractError(`This PDF has ${total} pages. The limit is ${MAX_PDF_PAGES}.`);
    pages = (await extractText(pdf, { mergePages: false })).text as string[];
  } catch (e) {
    if (e instanceof ExtractError) throw e;
    const msg = String((e as Error)?.message ?? e);
    if (/password/i.test(msg)) throw new ExtractError("This PDF is password-protected. Remove the password and upload again.");
    throw new ExtractError("This PDF could not be read. It may be damaged or not a real PDF.");
  }
  const { body, segments } = joinSegments(pages.map((text, i) => ({ label: `Page ${i + 1}`, text })), "\n\n");
  if (!body) throw new ExtractError("This PDF has no text layer (it may be a scan). Upload the pages as images to use OCR, or paste the text.");
  const warnings: string[] = [];
  const empty = pages.filter((p) => !p.trim()).length;
  if (empty) warnings.push(`${empty} of ${total} pages had no extractable text and were not checked.`);
  return { body: cap(body, warnings), ex: { method: "PDF text layer (unpdf / pdf.js)", segments, pages: total, warnings } };
}

async function extractDocx(buf: Uint8Array): Promise<{ body: string; ex: Omit<Extraction, "kind" | "mime"> }> {
  const mammoth = await import("mammoth");
  let value: string;
  let messages: { type: string; message: string }[];
  try {
    ({ value, messages } = await mammoth.extractRawText({ buffer: Buffer.from(buf) }));
  } catch {
    throw new ExtractError("This file could not be opened as a Word document. It may be damaged, or a zip that is not a .docx.");
  }
  const paras = value.split(/\n{2,}/);
  const { body, segments } = joinSegments(paras.map((text, i) => ({ label: `Paragraph ${i + 1}`, text })), "\n\n");
  if (!body) throw new ExtractError("This Word document contains no text.");
  const warnings = messages.filter((m) => m.type === "warning").slice(0, 3).map((m) => m.message);
  // Number paragraphs as they are shown, skipping empty ones.
  segments.forEach((s, i) => (s.label = `Paragraph ${i + 1}`));
  return { body: cap(body, warnings), ex: { method: "Word document text (mammoth)", segments, warnings } };
}

// ── Colour maths (WCAG 2.2 relative luminance) ───────────────────────────────
export const toHex = ([r, g, b]: number[]) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
export function fromHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
export const luminance = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export function contrastRatio(a: number[], b: number[]) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Text vs background colour in a region: split pixels at the median luminance; the smaller group is the text. */
export function textColours(rgb: Uint8Array | Buffer, channels: number) {
  const n = Math.floor(rgb.length / channels);
  if (n < 4) return null;
  const lum = new Float64Array(n);
  for (let i = 0; i < n; i++) lum[i] = luminance([rgb[i * channels], rgb[i * channels + 1], rgb[i * channels + 2]]);
  const sorted = Float64Array.from(lum).sort();
  // Use the extremes (10th / 90th percentile) so anti-aliased edges don't wash out the colours.
  const lo = sorted[Math.floor(n * 0.1)];
  const hi = sorted[Math.floor(n * 0.9)];
  const mid = (lo + hi) / 2;
  const dark = [0, 0, 0, 0];
  const light = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    if (lum[i] > lo && lum[i] < hi && Math.abs(lum[i] - mid) < (hi - lo) * 0.3) continue; // edge pixels
    const g = lum[i] <= mid ? dark : light;
    g[0] += rgb[i * channels];
    g[1] += rgb[i * channels + 1];
    g[2] += rgb[i * channels + 2];
    g[3]++;
  }
  if (!dark[3] || !light[3]) return null;
  const d = dark.slice(0, 3).map((v) => v / dark[3]);
  const l = light.slice(0, 3).map((v) => v / light[3]);
  const [fg, bg] = dark[3] < light[3] ? [d, l] : [l, d];
  return { fg: toHex(fg), bg: toHex(bg), contrast: Math.round(contrastRatio(fg, bg) * 100) / 100 };
}

/** Dominant colours by 4-bit-per-channel buckets on a downsampled copy, with the region each colour covers. */
export function dominantPalette(rgb: Uint8Array | Buffer, w: number, h: number, channels: number, scale: number, max = 6): PaletteColor[] {
  const buckets = new Map<number, { r: number; g: number; b: number; n: number; x0: number; y0: number; x1: number; y1: number }>();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels;
      const key = ((rgb[i] >> 4) << 8) | ((rgb[i + 1] >> 4) << 4) | (rgb[i + 2] >> 4);
      const k = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0, x0: x, y0: y, x1: x, y1: y };
      k.r += rgb[i];
      k.g += rgb[i + 1];
      k.b += rgb[i + 2];
      k.n++;
      k.x0 = Math.min(k.x0, x);
      k.y0 = Math.min(k.y0, y);
      k.x1 = Math.max(k.x1, x);
      k.y1 = Math.max(k.y1, y);
      buckets.set(key, k);
    }
  const total = w * h;
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .filter((k) => k.n / total >= 0.02)
    .slice(0, max)
    .map((k) => ({
      hex: toHex([k.r / k.n, k.g / k.n, k.b / k.n]),
      share: Math.round((k.n / total) * 1000) / 1000,
      region: {
        x: Math.round(k.x0 * scale),
        y: Math.round(k.y0 * scale),
        w: Math.round((k.x1 - k.x0 + 1) * scale),
        h: Math.round((k.y1 - k.y0 + 1) * scale),
      },
    }));
}

interface OcrLine {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/** OCR with tesseract.js and the bundled English model (no network). */
async function ocr(png: Buffer): Promise<{ lines: OcrLine[]; confidence: number }> {
  const { createWorker } = await import("tesseract.js");
  const os = await import("node:os");
  const worker = await createWorker("eng", 1, {
    langPath: path.join(process.cwd(), "node_modules/@tesseract.js-data/eng/4.0.0_best_int"),
    cachePath: os.tmpdir(),
    gzip: true,
  });
  try {
    const { data } = await worker.recognize(png, {}, { blocks: true, text: true });
    const lines: OcrLine[] = [];
    for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) lines.push({ text: l.text, confidence: l.confidence, bbox: l.bbox });
    return { lines, confidence: data.confidence };
  } finally {
    await worker.terminate();
  }
}

async function extractImage(buf: Uint8Array): Promise<{ body: string; ex: Omit<Extraction, "kind" | "mime"> }> {
  const sharp = (await import("sharp")).default;
  let img: import("sharp").Sharp;
  let width: number;
  let height: number;
  try {
    img = sharp(Buffer.from(buf), { limitInputPixels: MAX_IMAGE_PIXELS }).rotate().removeAlpha();
    const meta = await img.metadata();
    // rotate() applies EXIF orientation; swap for 90° orientations.
    const swap = (meta.orientation ?? 1) >= 5;
    width = (swap ? meta.height : meta.width) ?? 0;
    height = (swap ? meta.width : meta.height) ?? 0;
    if (!width || !height) throw new Error("no size");
  } catch {
    throw new ExtractError("This image could not be read. It may be damaged or too large (40 megapixels maximum).");
  }
  const warnings: string[] = [];
  if (width < 200 || height < 100) warnings.push("The image is very small, so text recognition may miss words.");

  const full = await img.clone().raw().toBuffer({ resolveWithObject: true });
  const step = Math.max(1, Math.ceil(Math.max(width, height) / 160));
  const small = await img.clone().resize(Math.ceil(width / step), Math.ceil(height / step), { fit: "fill", kernel: "nearest" }).raw().toBuffer({ resolveWithObject: true });
  const palette = dominantPalette(small.data, small.info.width, small.info.height, small.info.channels, width / small.info.width);

  // Local contrast enhancement so low-contrast text (the very text the contrast check must measure) is still read.
  const png = await img.clone().greyscale().clahe({ width: 64, height: 64, maxSlope: 6 }).png().toBuffer();
  let result: { lines: OcrLine[]; confidence: number };
  try {
    result = await ocr(png);
  } catch (e) {
    console.error("ocr failed:", (e as Error)?.message);
    throw new ExtractError("Text recognition failed on the server. Try again, or paste the text instead.", 502);
  }
  const blocks = result.lines
    .filter((l) => l.text.trim() && l.confidence >= 30)
    .map((l, i) => {
      const region = { x: l.bbox.x0, y: l.bbox.y0, w: l.bbox.x1 - l.bbox.x0, h: l.bbox.y1 - l.bbox.y0 };
      const crop = cropRaw(full.data, full.info.width, full.info.channels, region);
      const tc = crop ? textColours(crop, full.info.channels) : null;
      return { label: `Line ${i + 1}`, text: l.text.replace(/\s+/g, " "), extra: { region, confidence: Math.round(l.confidence), ...(tc ?? {}) } };
    });
  const { body, segments } = joinSegments(blocks, "\n");
  if (!body) warnings.push("No readable text was found in the image. Palette and alt-text checks still run.");
  else if (result.confidence < 60) warnings.push(`Text recognition confidence is low (${Math.round(result.confidence)}%). Check the extracted text below.`);
  return {
    body: cap(body, warnings),
    ex: {
      method: "OCR (tesseract.js, English model) + pixel measurements (sharp)",
      segments,
      image: { width, height, palette, ocr_confidence: body ? Math.round(result.confidence) : null },
      warnings,
    },
  };
}

function cropRaw(data: Buffer, w: number, channels: number, r: Region): Buffer | null {
  if (r.w <= 0 || r.h <= 0) return null;
  const out = Buffer.alloc(r.w * r.h * channels);
  for (let y = 0; y < r.h; y++) data.copy(out, y * r.w * channels, ((r.y + y) * w + r.x) * channels, ((r.y + y) * w + r.x + r.w) * channels);
  return out;
}

/** Validate and extract. Throws ExtractError with a message meant for the user. */
export async function extract(name: string, buf: Uint8Array): Promise<{ body: string; extraction: Extraction }> {
  const found = validateUpload(name, buf.length, buf);
  const run = found.kind === "pdf" ? extractPdf : found.kind === "docx" ? extractDocx : extractImage;
  const { body, ex } = await run(buf);
  return { body, extraction: { kind: found.kind, mime: found.mime, ...ex } };
}
