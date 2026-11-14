// Builds the sample files judges can upload (public/samples) and the test fixtures (src/lib/__fixtures__).
// All content is about the fictional Canon Demo Co. Run: node scripts/make-samples.mjs
// The PDF is printed by headless Edge/Chrome (set BROWSER to its path if it isn't in the default place).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";

const out = "public/samples";
const fx = "src/lib/__fixtures__";
mkdirSync(out, { recursive: true });
mkdirSync(fx, { recursive: true });

// 1. Social banner PNG: on-brand green, white headline, one low-contrast line and an off-palette orange badge.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="628">
  <rect width="1200" height="628" fill="#28645A"/>
  <rect x="860" y="60" width="280" height="120" rx="12" fill="#F28C28"/>
  <text x="900" y="135" font-family="Arial" font-size="40" font-weight="700" fill="#FFFFFF">NEW</text>
  <text x="70" y="250" font-family="Arial" font-size="64" font-weight="700" fill="#FFFFFF">Our revolutionary dashboard</text>
  <text x="70" y="350" font-family="Arial" font-size="46" fill="#FFFFFF">Rated 4.8 out of 5 by customers</text>
  <text x="70" y="450" font-family="Arial" font-size="46" fill="#6E9C93">Trusted by over 1,000 customers</text>
  <text x="70" y="560" font-family="Arial" font-size="30" fill="#E6EFEB">canon-demo.example · fictional demo company</text>
</svg>`;
const png = await sharp(Buffer.from(svg)).png().toBuffer();
writeFileSync(`${out}/canon-demo-social-banner.png`, png);
writeFileSync(`${fx}/banner.png`, png);
writeFileSync(`${fx}/blank.png`, await sharp({ create: { width: 400, height: 200, channels: 3, background: "#28645A" } }).png().toBuffer());

// 2. Partner newsletter DOCX
const doc = new Document({
  creator: "Canon Demo Co. (fictional)",
  sections: [
    {
      children: [
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Partner newsletter · November")] }),
        new Paragraph("Trusted by over 1,000 customers — you'll wonder how you ever worked without it."),
        new Paragraph("Our users can now export approved campaigns straight to their calendar."),
        new Paragraph("Canon Demo Co. now serves more than 5,000 customers and is the fastest-growing platform in India."),
      ],
    },
  ],
});
const docx = await Packer.toBuffer(doc);
writeFileSync(`${out}/canon-demo-partner-newsletter.docx`, docx);
writeFileSync(`${fx}/newsletter.docx`, docx);

// 3. Two-page launch brochure PDF
const html = `<!doctype html><meta charset="utf-8"><style>
  body{font-family:Arial,sans-serif;margin:48px;color:#1C2321} h1{color:#28645A} .pb{break-after:page}
</style>
<section class="pb"><h1>Canon Demo Co. · Launch brochure</h1>
<p>Our revolutionary dashboard helps users ship campaigns in minutes.</p></section>
<section><h2>Why teams choose us</h2>
<p>Canon Demo Co. now serves more than 5,000 customers and is the fastest-growing platform in India.</p>
<p>Rated 4.8 out of 5 by customers, and now available in 12 countries.</p>
<p style="color:#888">Fictional demo company for Canon. Not a real offer.</p></section>`;
const tmp = path.join(tmpdir(), `canon-brochure-${Date.now()}.html`);
writeFileSync(tmp, html);
const browser =
  process.env.BROWSER ??
  ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
if (!browser) throw new Error("Set BROWSER to a Chrome or Edge executable to print the PDF");
const pdfPath = path.resolve(`${out}/canon-demo-launch-brochure.pdf`);
execFileSync(browser, ["--headless", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`, `file:///${tmp.replace(/\\/g, "/")}`], { stdio: "ignore" });
rmSync(tmp);
writeFileSync(`${fx}/brochure.pdf`, (await import("node:fs")).readFileSync(pdfPath));

// 4. Broken and unsupported fixtures for the error paths
writeFileSync(`${fx}/corrupt.pdf`, "%PDF-1.7\n1 0 obj << /Type /Catalog >> garbage without xref");
writeFileSync(`${fx}/not-a-docx.docx`, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 7)]));
writeFileSync(`${fx}/notes.txt`, "plain text is pasted, not uploaded");
console.log("samples written to", out, "and", fx);
