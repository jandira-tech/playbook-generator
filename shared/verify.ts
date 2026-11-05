// Pinpoint citation verification — grounds a rule's `source_quote` against the
// actual document. Deterministic, pure, and browser+Deno safe (no imports).
//
// Why: `source_quote` is free text the model may paraphrase or invent. Lawyers
// must be able to check the AI's work against the instrument itself. We verify
// each quote and label it exact / normalized / fuzzy / not_found so unverifiable
// grounding is flagged instead of silently trusted.

export type QuoteStatus =
  | "exact" // verbatim substring of the source
  | "normalized" // matches after whitespace/case/smart-quote normalization
  | "fuzzy" // strong token overlap with some passage (likely paraphrase)
  | "not_found" // not grounded in the document
  | "empty"; // no quote provided

export interface QuoteVerification {
  status: QuoteStatus;
  /** 0..1 confidence of the best match (1 = exact/normalized). */
  similarity: number;
  /** Verbatim substring from the ORIGINAL source, if located. */
  matched_text: string | null;
  /** [start, end) char offsets into the ORIGINAL source, if located. */
  span: [number, number] | null;
}

/** Token overlap at/above this counts as fuzzy grounding rather than not_found. */
export const FUZZY_THRESHOLD = 0.6;

function normChar(ch: string): string {
  // Smart quotes → ascii, dashes → hyphen, then lowercase.
  if (ch === "“" || ch === "”" || ch === "„" || ch === "″") return '"';
  if (ch === "‘" || ch === "’" || ch === "‚" || ch === "′") return "'";
  if (ch === "–" || ch === "—" || ch === "−") return "-";
  return ch.toLowerCase();
}

/**
 * Normalize a string and keep a map from each normalized-char index back to the
 * index of the originating char in the source. Whitespace runs collapse to a
 * single space mapped to the first whitespace char.
 */
function normalizeWithMap(s: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let prevSpace = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (/\s/.test(c)) {
      if (!prevSpace) {
        norm += " ";
        map.push(i);
        prevSpace = true;
      }
      continue;
    }
    prevSpace = false;
    norm += normChar(c);
    map.push(i);
  }
  return { norm, map };
}

function normalizeStr(s: string): string {
  return normalizeWithMap(s).norm.trim();
}

interface Token {
  text: string; // lowercased word/number
  start: number; // offset in original source
  end: number; // offset in original source (exclusive)
}

function tokenize(s: string): Token[] {
  const tokens: Token[] = [];
  const re = /[A-Za-z0-9]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    tokens.push({ text: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function verifyQuote(source: string, quote: string): QuoteVerification {
  const q = (quote ?? "").trim();
  if (!q) return { status: "empty", similarity: 0, matched_text: null, span: null };

  // 1) Exact verbatim substring.
  const exactIdx = source.indexOf(q);
  if (exactIdx >= 0) {
    return {
      status: "exact",
      similarity: 1,
      matched_text: source.slice(exactIdx, exactIdx + q.length),
      span: [exactIdx, exactIdx + q.length],
    };
  }

  // 2) Normalized substring (case / spacing / smart quotes / dashes).
  const { norm: nSource, map } = normalizeWithMap(source);
  const nQuote = normalizeStr(q);
  if (nQuote) {
    const nIdx = nSource.indexOf(nQuote);
    if (nIdx >= 0) {
      const start = map[nIdx];
      const end = map[nIdx + nQuote.length - 1] + 1;
      return {
        status: "normalized",
        similarity: 1,
        matched_text: source.slice(start, end),
        span: [start, end],
      };
    }
  }

  // 3) Fuzzy: best token-overlap window of the source vs the quote's tokens.
  const srcTokens = tokenize(source);
  const qTokens = tokenize(q);
  if (qTokens.length === 0 || srcTokens.length === 0) {
    return { status: "not_found", similarity: 0, matched_text: null, span: null };
  }
  const qSet = new Set(qTokens.map((t) => t.text));
  const win = Math.min(qTokens.length, srcTokens.length);
  let best = 0;
  let bestStart = -1;
  for (let i = 0; i + win <= srcTokens.length; i++) {
    const windowSet = new Set<string>();
    for (let j = i; j < i + win; j++) windowSet.add(srcTokens[j].text);
    const score = jaccard(qSet, windowSet);
    if (score > best) {
      best = score;
      bestStart = i;
    }
  }

  if (best >= FUZZY_THRESHOLD && bestStart >= 0) {
    const start = srcTokens[bestStart].start;
    const end = srcTokens[bestStart + win - 1].end;
    return {
      status: "fuzzy",
      similarity: Number(best.toFixed(3)),
      matched_text: source.slice(start, end),
      span: [start, end],
    };
  }

  return {
    status: "not_found",
    similarity: Number(best.toFixed(3)),
    matched_text: null,
    span: null,
  };
}

/** Attach a verification verdict to each rule (computed against the full doc). */
export function annotateQuoteVerification<T extends { source_quote: string }>(
  source: string,
  rules: T[],
): (T & { source_quote_verification: QuoteVerification })[] {
  return rules.map((r) => ({
    ...r,
    source_quote_verification: verifyQuote(source, r.source_quote),
  }));
}
