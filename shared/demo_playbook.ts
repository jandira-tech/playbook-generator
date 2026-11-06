import type { PlaybookRecord } from "./types.ts";

/** Stable lineage for the public sample. Submissions must not append versions to it. */
export const DEMO_FAMILY_ID = "demo-sample-nda";

const TERM_QUOTE =
  "This Agreement commences on the Effective Date and continues for three (3) years. Confidentiality obligations survive for five (5) years after disclosure; trade secrets survive as long as they remain trade secrets.";
const USE_QUOTE =
  "Recipient shall use Confidential Information solely to evaluate a potential business relationship and shall not disclose it to any third party except employees and advisors with a need to know who are bound by confidentiality obligations at least as protective as this Agreement.";
const COMPELLED_QUOTE =
  "Recipient may disclose Confidential Information to the extent required by law, provided Recipient gives prompt written notice (where legally permitted) and cooperates with efforts to seek protective treatment.";

/** Fictional sample stored in SQLite so the public library has a playbook to open. */
export function demoPlaybook(): PlaybookRecord {
  return {
    name: "Sample mutual NDA",
    brief: {
      intent: "full_playbook",
      focus: "",
      name: "Sample mutual NDA",
      audience: "legal",
      our_side: "disclosing party",
      contract_type: "mutual NDA",
      granularity: "default",
      notes: "Sample stored for the public demo. Acme Corp and Recipient are fictional.",
      governing_law: "Delaware",
    },
    summary:
      "Sample playbook for a fictional mutual NDA. It is stored in this val's SQLite database so the library has a record to open.",
    ai_notes: "Written as a demo record. It was not produced by a live model call.",
    source_filename: "sample-mutual-nda.txt",
    source_excerpt: [TERM_QUOTE, USE_QUOTE, COMPELLED_QUOTE].join("\n\n"),
    agreement_type: "mutual NDA",
    party_vocabulary: "Acme Corp is the disclosing party. Recipient is the counterparty.",
    vault_only: false,
    links: [],
    rules: [
      {
        id: "demo-term",
        topic: "Term and survival",
        preferred: "Three-year agreement term. Confidentiality survives five years, and trade secrets survive while they remain trade secrets.",
        alternates: [
          { rank: 1, text: "Two-year survival for ordinary confidential information, with trade secrets surviving while secret.", risk: "yellow" },
        ],
        avoid: "A survival period shorter than two years, or trade secrets that expire with the agreement.",
        risk: "green",
        sample_language: TERM_QUOTE,
        escalate_when: "The other side asks for survival under two years, or for trade secrets to expire on a fixed date.",
        source_quote: TERM_QUOTE,
        raise_mode: "proactive",
        confidence: 1,
        rationale: "The sample keeps a short relationship term and a longer duty for information that stays secret.",
      },
      {
        id: "demo-use",
        topic: "Use and disclosure",
        preferred: "Use is limited to evaluating a potential business relationship. Disclosure is limited to people who need to know and are bound by terms at least as protective.",
        alternates: [
          { rank: 1, text: "Allow disclosure to affiliates that are bound by the same obligations.", risk: "yellow" },
        ],
        avoid: "Use for any business purpose, or disclosure to advisors who are not bound.",
        risk: "green",
        sample_language: USE_QUOTE,
        escalate_when: "The draft allows a residual right to use remembered information, or disclosure without a need to know.",
        source_quote: USE_QUOTE,
        raise_mode: "proactive",
        confidence: 1,
        rationale: "The sample ties use to one purpose and keeps onward disclosure inside a bound group.",
      },
      {
        id: "demo-compelled",
        topic: "Compelled disclosure",
        preferred: "Disclosure required by law is allowed after prompt notice, where notice is legally permitted, and with cooperation on protective treatment.",
        alternates: [
          { rank: 1, text: "Notice may be given after disclosure when prior notice is prohibited.", risk: "yellow" },
        ],
        avoid: "A right to disclose to any regulator with no notice and no cooperation.",
        risk: "yellow",
        sample_language: COMPELLED_QUOTE,
        escalate_when: "The other side refuses notice even where the law allows it.",
        source_quote: COMPELLED_QUOTE,
        raise_mode: "either",
        confidence: 1,
        rationale: "The sample allows a legal compulsion and keeps a notice duty where the law permits it.",
      },
    ],
  };
}

/**
 * Family id to pass to save. The sample lineage is rejected so a public
 * duplicate cannot append a version onto the stored demo.
 */
export function lineageForSubmit(familyId: string | undefined): string | undefined {
  const id = (familyId ?? "").trim();
  if (!id) return undefined;
  if (id === DEMO_FAMILY_ID) {
    throw new Error("the sample playbook is stored as a demo and cannot take new versions");
  }
  return id;
}
