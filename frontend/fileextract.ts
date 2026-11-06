// Client-side file text extraction (browser-only, dynamically imported).

// Files are parsed CLIENT-SIDE and never uploaded/stored server-side
// (privilege / confidentiality). mammoth (.docx) and pdfjs (.pdf) are heavy and
// browser-only, so they are dynamically imported on demand — this keeps the
// top-level module Deno-transpilable and off the critical path. The pure
// dispatch/fallback decisions live in ../shared/ingest.ts (unit-tested).

const MAMMOTH_URL = "https://esm.sh/mammoth@1.8.0";
const PDFJS_VERSION = "4.7.76";
const PDFJS_URL = `https://esm.sh/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`;
const PDFJS_WORKER_URL =
  `https://esm.sh/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;

interface MammothModule {
  extractRawText?: (opts: { arrayBuffer: ArrayBuffer }) => Promise<{ value?: string }>;
  default?: { extractRawText?: MammothModule["extractRawText"] };
}

interface PdfTextItem {
  str?: string;
}

interface PdfJsModule {
  GlobalWorkerOptions?: { workerSrc: string };
  getDocument?: (opts: { data: Uint8Array; isEvalSupported: boolean }) => {
    promise: Promise<{
      numPages: number;
      getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: PdfTextItem[] }> }>;
    }>;
  };
  default?: PdfJsModule;
}

/** Extract raw text from a .docx via mammoth's browser build. */
async function extractDocxText(file: File): Promise<string> {
  const mammoth = await import(/* @vite-ignore */ MAMMOTH_URL) as MammothModule;
  const arrayBuffer = await file.arrayBuffer();
  const extract = mammoth.extractRawText ?? mammoth.default?.extractRawText;
  if (!extract) throw new Error("docx extractor unavailable");
  const result = await extract({ arrayBuffer });
  return String(result?.value ?? "");
}

/** Extract + concatenate page text from a PDF via pdfjs. */
async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import(/* @vite-ignore */ PDFJS_URL) as PdfJsModule;
  // Point the worker at the matching esm.sh build. pdfjs wraps a cross-origin
  // workerSrc in a blob worker; if that ever fails, the call-site try/catch
  // routes the user to the paste box (graceful fallback), so we never block.
  try {
    if (pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
  } catch (_e) { /* ignore — fallback handled by caller */ }
  const data = new Uint8Array(await file.arrayBuffer());
  const getDocument = pdfjs.getDocument ?? pdfjs.default?.getDocument;
  if (!getDocument) throw new Error("pdf extractor unavailable");
  const doc = await getDocument({ data, isEvalSupported: false }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = content.items
      .map((it) => (typeof it?.str === "string" ? it.str : ""))
      .join(" ");
    pages.push(line);
  }
  return pages.join("\n\n");
}


export { extractDocxText, extractPdfText };
