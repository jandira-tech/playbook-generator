// Counterparty-redline review (proposal #4b).
//
// Given a playbook you already have (its rules) plus the OTHER side's draft of
// the same kind of deal, classify — clause by clause — whether their language
// MEETS your preferred position, matches a FALLBACK, hits a NO-GO, is MISSING,
// or is UNCLEAR. Every deviation carries your escalation contact.
//
// This module is PURE: schema + prompt + repair + assert. No Deno.*, no network.
// It mirrors catalog.ts's locked-output discipline (strict json_schema, then
// repair + assert the model output — never trust free-form chat as the product).

import type { PlaybookRule, RiskLevel } from "./types.ts";

// ---------- Types ----------

/** RYG-style verdict for one of our playbook rules against their draft. */
export type CounterStatus =
  | "met" // their language satisfies our preferred position
  | "fallback" // matches one of our acceptable alternates
  | "nogo" // hits an "avoid" / deal-breaker
  | "missing" // the topic is absent from their draft
  | "unclear"; // present but ambiguous / can't tell

export interface CounterAssessment {
  /** Must equal the `id` of one of the input playbook rules. */
  rule_id: string;
  topic: string;
  status: CounterStatus;
  /** Which of our positions their text lands on (plain words for non-lawyers). */
  matched_position: string;
  /** Short quote grounded in THEIR draft (or "" when missing). */
  evidence_quote: string;
  /** How their language deviates from what we want. */
  deviation_note: string;
  /** Who to escalate to — carried from our rule for deviations. */
  escalate_when: string;
  risk: RiskLevel;
}

export interface CounterReviewResponse {
  summary: string;
  assessments: CounterAssessment[];
}

// ---------- JSON Schema (strict mode) ----------

const STATUS_ENUM = {
  type: "string",
  enum: ["met", "fallback", "nogo", "missing", "unclear"],
} as const;

const RISK_ENUM = { type: "string", enum: ["green", "yellow", "red"] } as const;

export const COUNTER_SCHEMA = {
  name: "CounterReview",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["summary", "assessments"],
    properties: {
      summary: { type: "string" },
      assessments: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "rule_id",
            "topic",
            "status",
            "matched_position",
            "evidence_quote",
            "deviation_note",
            "escalate_when",
            "risk",
          ],
          properties: {
            rule_id: { type: "string" },
            topic: { type: "string" },
            status: STATUS_ENUM,
            matched_position: { type: "string" },
            evidence_quote: { type: "string" },
            deviation_note: { type: "string" },
            escalate_when: { type: "string" },
            risk: RISK_ENUM,
          },
        },
      },
    },
  },
} as const;

// ---------- Prompt ----------

const STATUS_GUIDE = [
  "- met: their clause satisfies our PREFERRED position as-is.",
  "- fallback: their clause matches one of our acceptable ALTERNATES (a concession we can live with).",
  "- nogo: their clause hits something in our AVOID list, or is a deal-breaker.",
  "- missing: the topic is ABSENT from the counterparty draft.",
  "- unclear: the topic appears but the language is ambiguous / you cannot tell which of our positions it lands on.",
].join("\n");

/** One compact block per rule so the model classifies every one of our topics. */
function ruleBlock(r: PlaybookRule): string {
  const alts = r.alternates?.length
    ? r.alternates
      .slice()
      .sort((a, b) => a.rank - b.rank)
      .map((a) => `    ${a.rank}. ${a.text}`)
      .join("\n")
    : "    (none)";
  return [
    `- rule_id: ${r.id}`,
    `  topic: ${r.topic}`,
    `  preferred (MET if their text achieves this): ${r.preferred || "(none)"}`,
    `  acceptable fallbacks:`,
    alts,
    `  avoid / no-go: ${r.avoid || "(none stated)"}`,
    `  escalate to: ${r.escalate_when || "(not specified)"}`,
  ].join("\n");
}

/**
 * Build the system prompt: for EACH provided rule, find how the counterparty
 * document treats that topic and classify it. JSON only, grounded in their text.
 */
export function buildCounterPrompt(
  rules: PlaybookRule[],
  partyVocab?: string,
): string {
  const vocab = (partyVocab ?? "").trim();
  const vocabLine = vocab
    ? `Party vocabulary for this deal: ${vocab}. Use these labels; "we"/"our" = the side this playbook protects.`
    : `Party vocabulary not specified — infer the two sides from the counterparty text; "we"/"our" = the side this playbook protects.`;

  return `You are a contracts reviewer. We hand you OUR negotiation playbook (a list
of rules with our preferred position, acceptable fallbacks, and no-go items) and
the OTHER side's draft of the same kind of agreement. Your job is to review THEIR
draft clause by clause against OUR playbook.

You DO NOT chat. You emit ONE JSON object matching the CounterReview schema.

${vocabLine}

# What to do
For EACH rule below, locate how the counterparty draft treats that topic and set
"status" to exactly one of:
${STATUS_GUIDE}

For each rule also return:
- rule_id: copy the EXACT rule_id from the list (do not invent new ids).
- topic: copy the rule's topic.
- matched_position: one short sentence, in plain words, describing what their
  draft actually does on this topic (what we would be agreeing to).
- evidence_quote: a SHORT verbatim quote from the COUNTERPARTY DRAFT that grounds
  your verdict. Use "" when status is missing (nothing to quote).
- deviation_note: how their language differs from what we want (empty for a clean met).
- escalate_when: who to escalate to when this deviates (carry our rule's escalate contact).
- risk: green / yellow / red — how dangerous accepting their language is for us.

# Hard rules
1. Return one assessment per rule we gave you. Do NOT add rules we did not list.
2. Do NOT invent clauses that are not in the counterparty text. If you cannot find
   the topic, status = missing and evidence_quote = "".
3. evidence_quote MUST be text that appears in the counterparty draft, not our
   playbook and not a paraphrase.
4. Ground every verdict in their actual words; when unsure, use "unclear".
5. Never output markdown or prose outside the JSON object.

# Our playbook rules
${rules.map(ruleBlock).join("\n\n")}
`;
}

// ---------- Repair + assert ----------

const STATUSES: ReadonlySet<string> = new Set([
  "met",
  "fallback",
  "nogo",
  "missing",
  "unclear",
]);

function asString(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function asStatus(v: unknown): CounterStatus {
  return STATUSES.has(v as string) ? (v as CounterStatus) : "unclear";
}

function asRiskOr(v: unknown, fallback: RiskLevel): RiskLevel {
  return v === "green" || v === "yellow" || v === "red" ? v : fallback;
}

/** A "missing" assessment for a rule the model never spoke to. */
function missingAssessment(rule: PlaybookRule): CounterAssessment {
  return {
    rule_id: rule.id,
    topic: rule.topic,
    status: "missing",
    matched_position: "",
    evidence_quote: "",
    deviation_note: "This topic was not addressed in the counterparty review.",
    escalate_when: rule.escalate_when,
    risk: rule.risk,
  };
}

/**
 * Coerce raw model output into a CounterReviewResponse, aligned to the input
 * rules. Rows whose rule_id doesn't match a provided rule (or repeat one already
 * seen) are dropped; topic, escalate contact, and risk default from the matching
 * rule. The result carries EXACTLY ONE assessment per input rule — any rule the
 * model omitted is filled in as `status: "missing"` (in input order) so a
 * dropped rule can never silently vanish from the report.
 */
export function repairCounterReview(
  raw: unknown,
  rules: PlaybookRule[],
): CounterReviewResponse {
  const byId = new Map<string, PlaybookRule>();
  for (const r of rules) byId.set(r.id, r);

  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rowsIn = Array.isArray(o.assessments) ? o.assessments : [];

  const seen = new Set<string>();
  const assessments: CounterAssessment[] = [];
  for (const row of rowsIn) {
    if (!row || typeof row !== "object") continue;
    const a = row as Record<string, unknown>;
    const rule_id = asString(a.rule_id).trim();
    const rule = byId.get(rule_id);
    if (!rule) continue; // drop junk / hallucinated rows
    if (seen.has(rule_id)) continue; // one assessment per rule — drop repeats
    seen.add(rule_id);

    const status = asStatus(a.status);
    const topic = asString(a.topic).trim() || rule.topic;
    const escalate_when = asString(a.escalate_when).trim() || rule.escalate_when;
    const risk = asRiskOr(a.risk, rule.risk);

    assessments.push({
      rule_id,
      topic,
      status,
      matched_position: asString(a.matched_position).trim(),
      evidence_quote: asString(a.evidence_quote).trim(),
      deviation_note: asString(a.deviation_note).trim(),
      escalate_when,
      risk,
    });
  }

  // Backfill any rule the model omitted so every input rule is accounted for.
  for (const rule of rules) {
    if (!seen.has(rule.id)) assessments.push(missingAssessment(rule));
  }

  const summary = asString(o.summary).trim() ||
    "Counterparty review generated from the pasted draft.";

  return { summary, assessments };
}

export function assertCounterReview(res: CounterReviewResponse): void {
  if (typeof res.summary !== "string") {
    throw new Error("counter: missing summary");
  }
  if (!Array.isArray(res.assessments)) {
    throw new Error("counter: assessments must be an array");
  }
  for (const a of res.assessments) {
    if (!a.rule_id) {
      throw new Error(
        `counter: assessment missing rule_id: ${JSON.stringify(a).slice(0, 120)}`,
      );
    }
    if (!STATUSES.has(a.status)) {
      throw new Error(`counter: invalid status "${a.status}" for ${a.rule_id}`);
    }
  }
}

// ---------- UI helpers ----------

export const COUNTER_STATUS_LABEL: Record<CounterStatus, string> = {
  met: "Met",
  fallback: "Fallback",
  nogo: "No-go",
  missing: "Missing",
  unclear: "Unclear",
};

/** Tailwind chip classes per status (green / yellow / red / grey). */
export function counterStatusColor(status: CounterStatus): string {
  switch (status) {
    case "met":
      return "bg-emerald-100 text-emerald-800 border-emerald-300";
    case "fallback":
      return "bg-amber-100 text-amber-900 border-amber-300";
    case "nogo":
      return "bg-rose-100 text-rose-800 border-rose-300";
    default: // missing | unclear
      return "bg-slate-100 text-slate-600 border-slate-300";
  }
}

/** Count assessments by status, for the top summary line. */
export function counterStatusCounts(
  assessments: CounterAssessment[],
): Record<CounterStatus, number> {
  const counts: Record<CounterStatus, number> = {
    met: 0,
    fallback: 0,
    nogo: 0,
    missing: 0,
    unclear: 0,
  };
  for (const a of assessments) counts[a.status]++;
  return counts;
}
