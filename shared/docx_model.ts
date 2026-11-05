// Pure record → intermediate-structure mapper for the Word (.docx) export.
//
// This file MUST run in both browser and Deno: no `Deno.*`, and — critically —
// NO import of the runtime-heavy `docx` library. It only produces a plain JSON
// tree that the frontend adapter walks to emit `docx` objects. Keeping the
// mapping here means it is fully unit-tested offline; the actual .docx bytes
// are covered by E2E.

import type { PlaybookRecord, RiskLevel } from "./types.ts";

/** RYG risk → Word cell-shading hex (6 digits, no leading `#`). */
export const RISK_SHADE: Record<RiskLevel, string> = {
  green: "C6EFCE",
  yellow: "FFEB9C",
  red: "FFC7CE",
};

export const DOCX_FOOTER =
  "Draft generated with AI assistance — review before relying on it.";

/** One rule rendered as a Word section. Optional fields are omitted when empty. */
export interface DocxSection {
  topic: string;
  risk: RiskLevel;
  /** 6-digit hex (no `#`) for the risk chip's cell shading. */
  riskShade: string;
  /** Uppercase label for the risk chip, e.g. "GREEN". */
  riskLabel: string;
  preferred: string;
  /** Fallback ladder, ordered best-first (rank ascending). */
  fallbacks: string[];
  avoid?: string;
  escalate?: string;
  raiseMode?: string;
  sample?: string;
}

/** Plain JSON tree the frontend adapter turns into a `docx` Document. */
export interface DocxModel {
  title: string;
  meta: string;
  summary: string;
  sections: DocxSection[];
  footer: string;
}

function metaLine(record: PlaybookRecord): string {
  const parts: string[] = [];
  const side = record.brief.our_side?.trim();
  if (side && side.toLowerCase() !== "unknown") parts.push(side);
  const agreement = record.brief.contract_type?.trim() || record.agreement_type?.trim();
  if (agreement) parts.push(agreement);
  if (record.brief.audience) parts.push(record.brief.audience);
  return parts.join(" · ");
}

export function buildDocxModel(record: PlaybookRecord): DocxModel {
  const sections: DocxSection[] = record.rules.map((r) => {
    const fallbacks = [...r.alternates]
      .sort((a, b) => a.rank - b.rank)
      .map((a) => a.text);

    const section: DocxSection = {
      topic: r.topic,
      risk: r.risk,
      riskShade: RISK_SHADE[r.risk],
      riskLabel: r.risk.toUpperCase(),
      preferred: r.preferred,
      fallbacks,
    };

    if (r.avoid?.trim()) section.avoid = r.avoid;
    if (r.escalate_when?.trim()) section.escalate = r.escalate_when;
    if (r.raise_mode && r.raise_mode !== "either") section.raiseMode = r.raise_mode;
    if (r.sample_language?.trim()) section.sample = r.sample_language;

    return section;
  });

  return {
    title: record.name.trim() || "Untitled playbook",
    meta: metaLine(record),
    summary: record.summary ?? "",
    sections,
    footer: DOCX_FOOTER,
  };
}
