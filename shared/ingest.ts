// Client-side document ingestion: dispatch + fallback decisioning.
//
// Lawyers receive agreements as .docx / PDF, not pasted text. Files are parsed
// CLIENT-SIDE ONLY (mammoth for .docx, pdfjs for PDF) — never uploaded or stored
// server-side (privilege / confidentiality, same reason as the redaction module).
//
// This module is PURE and Deno-safe so it can be unit-tested: it decides which
// extractor a file needs, whether the extracted text is too thin to trust
// (scanned/image PDF or a parse failure), and the user-facing message. The
// browser-only mammoth/pdfjs calls live in frontend/index.tsx and are covered
// by agent-browser E2E — they are deliberately NOT imported here.

export type Extractor = "docx" | "pdf" | "text" | "unsupported";

/** Reason we fell back to the paste box. */
export type FallbackReason = "empty" | "error" | "unsupported";

/** Below this many trimmed characters, extracted text is treated as failed. */
export const MIN_EXTRACTED_CHARS = 20;

const TEXT_EXTENSIONS = [".txt", ".md", ".markdown", ".rtf", ".csv"];

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Last dotted extension, lower-cased (empty string when there is none). */
function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return "";
  return filename.slice(dot).toLowerCase();
}

/**
 * Decide which extractor a file needs. Extension is the primary signal (browsers
 * frequently mislabel .docx as application/octet-stream); MIME is only consulted
 * when the extension is missing or unknown. Note: legacy `.doc` is unsupported —
 * mammoth handles the OOXML `.docx` container, not the old binary format.
 */
export function pickExtractor(filename: string, mime = ""): Extractor {
  const ext = extensionOf(filename);
  if (ext === ".docx") return "docx";
  if (ext === ".pdf") return "pdf";
  if (TEXT_EXTENSIONS.includes(ext)) return "text";

  // Extension missing OR unrecognized (e.g. `.xyz`, or a browser that dropped
  // the name) → fall back to the browser-provided MIME type. A recognized
  // extension above always wins over MIME (browsers mislabel .docx often).
  const m = mime.toLowerCase();
  if (m === DOCX_MIME) return "docx";
  if (m === "application/pdf") return "pdf";
  if (m.startsWith("text/")) return "text";

  return "unsupported";
}

/**
 * True when extracted text is empty, whitespace-only, or too short to be a real
 * document — the tell-tale of a scanned/image PDF or a parser that produced
 * nothing. Callers use this to keep the paste box and show a fallback message.
 */
export function needsFallback(
  extractedText: string,
  minChars = MIN_EXTRACTED_CHARS,
): boolean {
  return extractedText.trim().length < minChars;
}

/** Suffix a message with the filename when we know it. */
function withFile(base: string, filename?: string): string {
  return filename ? `${base} (${filename})` : base;
}

/**
 * User-facing message for a failed/unsupported ingestion. Never blocks the
 * user — every variant steers them to the always-available paste box.
 */
export function fallbackMessage(
  reason: FallbackReason,
  filename?: string,
): string {
  if (reason === "unsupported") {
    return withFile(
      "Unsupported file type — upload a .docx, .pdf, or .txt file, or paste the text below.",
      filename,
    );
  }
  // "empty" and "error" share the same guidance: extraction produced nothing
  // usable (scanned or protected file?), so paste instead.
  return withFile(
    "Couldn't extract text (scanned or protected file?) — paste the text instead.",
    filename,
  );
}
