// Confidentiality auto-redaction — masks sensitive spans (emails, amounts,
// dates, phones, SSNs, URLs, and known/organizational party names) before the
// document is sent to the LLM. Pure, deterministic, browser+Deno safe.
//
// Privilege and client-confidentiality are the #1 reason lawyers won't paste
// contracts into tools. Redaction is round-trippable: the model sees stable
// placeholders ([PARTY_1], [AMOUNT_2], …), and quotes it returns can be
// restored to the real text with restoreRedactions().

export type RedactionKind =
  | "email"
  | "money"
  | "date"
  | "phone"
  | "ssn"
  | "url"
  | "party";

export interface Redaction {
  kind: RedactionKind;
  original: string;
  placeholder: string;
  /** Offset of the first occurrence in the original text. */
  index: number;
}

export interface RedactionResult {
  redacted: string;
  redactions: Redaction[];
}

export interface RedactOptions {
  /** Exact party names to always mask (e.g. from party_vocabulary). */
  parties?: string[];
}

/** Placeholder label per kind (money reads better as AMOUNT). */
const LABEL: Record<RedactionKind, string> = {
  email: "EMAIL",
  money: "AMOUNT",
  date: "DATE",
  phone: "PHONE",
  ssn: "SSN",
  url: "URL",
  party: "PARTY",
};

interface Candidate {
  kind: RedactionKind;
  start: number;
  end: number;
  text: string;
  priority: number; // higher wins on overlap ties
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Order matters only for overlap priority, not correctness.
const PATTERNS: { kind: RedactionKind; re: RegExp; priority: number }[] = [
  { kind: "url", priority: 6, re: /\bhttps?:\/\/[^\s)]+/gi },
  { kind: "email", priority: 6, re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: "ssn", priority: 5, re: /\b\d{3}-\d{2}-\d{4}\b/g },
  {
    kind: "money",
    priority: 5,
    re: /(?:US\$|USD|EUR|GBP|\$|€|£)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|thousand|bn|mm|[mk]))?/gi,
  },
  {
    kind: "date",
    priority: 4,
    re:
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g,
  },
  { kind: "phone", priority: 3, re: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
  // Organizational names by corporate suffix. The leading-word repetition is
  // bounded ({0,6}) so a long run of Capitalized words with no trailing suffix
  // (e.g. `("A "*5000)+"!"`) can't drive catastrophic backtracking (ReDoS) — an
  // org name almost never has more than a handful of words before the suffix.
  {
    kind: "party",
    priority: 2,
    re:
      /\b[A-Z][\w&.'-]*(?:[ ,]+[A-Z][\w&.'-]*){0,6}[ ,]+(?:Inc|LLC|Ltd|Corp|Corporation|Company|Co|LP|LLP|PLC|GmbH)\b\.?/g,
  },
];

export function redactSensitive(text: string, opts: RedactOptions = {}): RedactionResult {
  const candidates: Candidate[] = [];

  // Explicit party names first — highest priority so they win overlaps.
  for (const name of opts.parties ?? []) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const re = new RegExp(escapeRegExp(trimmed), "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      candidates.push({ kind: "party", start: m.index, end: m.index + m[0].length, text: m[0], priority: 10 });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }

  for (const { kind, re, priority } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      candidates.push({ kind, start: m.index, end: m.index + m[0].length, text: m[0], priority });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }

  // Resolve overlaps: prefer earlier start, then higher priority, then longer.
  candidates.sort((a, b) =>
    a.start - b.start || b.priority - a.priority || (b.end - b.start) - (a.end - a.start)
  );
  const accepted: Candidate[] = [];
  let lastEnd = -1;
  for (const c of candidates) {
    if (c.start >= lastEnd) {
      accepted.push(c);
      lastEnd = c.end;
    }
  }

  // Assign placeholders (stable per kind+original, numbered by first appearance).
  const counters: Record<string, number> = {};
  const placeholderFor = new Map<string, string>();
  const redactions: Redaction[] = [];
  for (const c of accepted) {
    const key = `${c.kind}::${c.text}`;
    let placeholder = placeholderFor.get(key);
    if (!placeholder) {
      const label = LABEL[c.kind];
      counters[label] = (counters[label] ?? 0) + 1;
      placeholder = `[${label}_${counters[label]}]`;
      placeholderFor.set(key, placeholder);
      redactions.push({ kind: c.kind, original: c.text, placeholder, index: c.start });
    }
  }

  // Splice from the end so offsets stay valid.
  let redacted = text;
  for (const c of [...accepted].sort((a, b) => b.start - a.start)) {
    const placeholder = placeholderFor.get(`${c.kind}::${c.text}`)!;
    redacted = redacted.slice(0, c.start) + placeholder + redacted.slice(c.end);
  }

  return { redacted, redactions };
}

/**
 * Replace placeholders with their original values. Used to un-redact quotes the
 * model returns, or to fully restore a redacted document.
 */
export function restoreRedactions(text: string, redactions: Redaction[]): string {
  let out = text;
  // Longer placeholders first avoids any prefix ambiguity (defensive).
  for (const r of [...redactions].sort((a, b) => b.placeholder.length - a.placeholder.length)) {
    out = out.split(r.placeholder).join(r.original);
  }
  return out;
}

// A minimal structural view of a playbook rule's user-visible text fields.
// Declared locally (not imported from types.ts) so redact.ts stays a leaf
// module with no cross-imports; any object with these fields round-trips.
interface RestorableRule {
  preferred: string;
  alternates: { text: string }[];
  avoid: string;
  sample_language: string;
  source_quote: string;
}

/**
 * Un-redact every user-visible text field of a model-returned rule, so the UI
 * shows the real party names / amounts even though the AI only ever saw
 * placeholders. Quote verification runs server-side against the REDACTED text
 * (placeholders present on both sides), and the client restores for display.
 *
 * Pure: returns a new rule; leaves non-text fields (risk, confidence, …) and
 * the input untouched. A no-op when `redactions` is empty.
 */
export function restoreRuleFields<T extends RestorableRule>(
  rule: T,
  redactions: Redaction[],
): T {
  if (!redactions.length) return rule;
  const r = (s: string) => restoreRedactions(s, redactions);
  return {
    ...rule,
    preferred: r(rule.preferred),
    alternates: rule.alternates.map((a) => ({ ...a, text: r(a.text) })),
    avoid: r(rule.avoid),
    sample_language: r(rule.sample_language),
    source_quote: r(rule.source_quote),
  };
}
