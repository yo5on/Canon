import type { Extraction } from "@/lib/extract";
import { Badge } from "@/components/ui";

export interface SourceVersion {
  source_kind: "text" | "pdf" | "docx" | "image";
  source_name: string | null;
  source_bytes: number | null;
  source_sha256: string | null;
  extraction: Extraction | null;
  alt_text: string | null;
}

type Boxed = { n: number; region: { x: number; y: number; w: number; h: number; image_w: number; image_h: number }; label: string };

const KIND = { pdf: "PDF", docx: "Word document", image: "Image", text: "Pasted text" } as const;

/** The original file behind this version: what it was, how its text was extracted, and where findings sit on it. */
export function SourcePanel({ itemId, v, imageUrl, boxes }: { itemId: string; v: SourceVersion; imageUrl: string | null; boxes: Boxed[] }) {
  const ex = v.extraction;
  return (
    <section className="mb-5 rounded border border-line px-4 py-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="label">Original file</span>
        <span className="font-medium">{v.source_name}</span>
        <Badge tone="muted">{KIND[v.source_kind]}</Badge>
        {v.source_bytes !== null && <span className="text-muted">{(v.source_bytes / 1024).toFixed(0)} KB</span>}
        {ex?.pages && <span className="text-muted">{ex.pages} pages</span>}
        {ex?.image && (
          <span className="text-muted">
            {ex.image.width}×{ex.image.height}px{ex.image.ocr_confidence !== null && ` · OCR confidence ${ex.image.ocr_confidence}%`}
          </span>
        )}
        <a href={`/api/items/${itemId}/source`} className="text-accent hover:underline">
          Download original
        </a>
      </div>
      {ex && (
        <p className="mt-1 text-xs text-muted">
          Text extracted by {ex.method} into {ex.segments.length} {v.source_kind === "pdf" ? "page" : v.source_kind === "docx" ? "paragraph" : "line"} segment
          {ex.segments.length === 1 ? "" : "s"}. Findings show where in the file they came from. SHA-256 {v.source_sha256?.slice(0, 12)}…
        </p>
      )}
      {ex?.warnings.map((w) => (
        <p key={w} className="mt-1 rounded border border-amber/30 bg-amber/10 px-2 py-1 text-xs text-amber">
          {w}
        </p>
      ))}
      {v.source_kind === "image" && (
        <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          {imageUrl ? (
            <figure className="relative w-full overflow-hidden rounded border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from private storage */}
              <img src={imageUrl} alt={v.alt_text || "Uploaded image (no alt text provided)"} className="block h-auto w-full" />
              {boxes.map((b) => (
                <a
                  key={b.n}
                  href={`#f-${b.n}`}
                  title={b.label}
                  className="absolute rounded-sm border-2 border-danger bg-danger/10"
                  style={{ left: `${(b.region.x / b.region.image_w) * 100}%`, top: `${(b.region.y / b.region.image_h) * 100}%`, width: `${(b.region.w / b.region.image_w) * 100}%`, height: `${(b.region.h / b.region.image_h) * 100}%` }}
                >
                  <span className="absolute -left-0.5 -top-5 rounded-sm bg-danger px-1 font-mono text-[10px] text-white">{b.n}</span>
                </a>
              ))}
            </figure>
          ) : (
            <p className="text-xs text-muted">The image preview is unavailable right now. Download the original instead.</p>
          )}
          <div className="text-xs">
            <p className="label mb-1.5">Measured colours</p>
            <ul className="space-y-1">
              {ex?.image?.palette.map((c) => (
                <li key={c.hex} className="flex items-center gap-2">
                  <span className="inline-block h-4 w-4 rounded-sm border border-line" style={{ background: c.hex }} />
                  <span className="font-mono">{c.hex}</span>
                  <span className="text-muted">{Math.round(c.share * 100)}%</span>
                </li>
              ))}
            </ul>
            <p className="label mb-1 mt-3">Alt text</p>
            <p className={v.alt_text ? "" : "text-muted"}>{v.alt_text || "None provided"}</p>
          </div>
        </div>
      )}
    </section>
  );
}
