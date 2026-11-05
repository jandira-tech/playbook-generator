// Catalog: fixed schemas + prompts that lock the model output.
// Mirrors legal-intake's json-render-style approach.
// ACC 2012 "Play-by-Play Guide to Creating a Contracts Playbook" is the
// domain source of truth for what a rule row looks like.
//
// Customers are VARIED: loans, leases, NDAs, M&A, employment, SaaS, real
// estate, etc. Never default the model to SaaS/procurement mental models.

import type {
  Audience,
  BriefElicitation,
  ElicitField,
  ElicitFieldId,
  ExtractResponse,
  Granularity,
  Intent,
  PlaybookBrief,
  PlaybookRecord,
  PlaybookRule,
  RaiseMode,
  RiskLevel,
} from "./types.ts";

// ---------- Intent / context catalogs (UI + prompts) ----------

export const INTENT_OPTIONS: ReadonlyArray<{
  id: Intent;
  label: string;
  help: string;
  /** How the AI should behave for this intent. */
  ai_hint: string;
}> = [
  {
    id: "full_playbook",
    label: "Full playbook from this agreement",
    help: "Extract preferred positions, ordered fallbacks, and deal-breakers across the main clauses.",
    ai_hint:
      "Produce a full ACC-style playbook: one rule per material clause topic in THIS document's actual structure, with preferred, ranked alternates, avoid, risk (RYG), sample language, and escalate_when. Match the agreement type you detect (loan ≠ SaaS ≠ lease).",
  },
  {
    id: "format_only",
    label: "Just the structure / format",
    help: "Topic list and risk tags only — light on sample language. Good when you want a skeleton to fill later.",
    ai_hint:
      "Produce a skeleton playbook from THIS document's headings/topics only. Short preferred one-liners + risk tags. Sample language may be empty. Favor breadth of topics that appear (or are standard for this agreement type) — do not import SaaS topics into a loan, or loan covenants into an NDA.",
  },
  {
    id: "single_clause",
    label: "One clause / topic only",
    help: "Deep dive on a single issue (e.g. liability, IP, termination, covenants). Use the focus field.",
    ai_hint:
      "Focus ONLY on the topic named in brief.focus (and closely related sub-issues in THIS document). Emit 1–6 deep rules for that area. Skip unrelated clauses. Use the vocabulary of this agreement type.",
  },
  {
    id: "counter_paper",
    label: "Counter-party paper / redline guide",
    help: "The document is the other side's form. Propose our pushbacks, fallbacks, and redlines.",
    ai_hint:
      "Treat the document as the OTHER SIDE's paper. For each material clause, preferred = what WE want instead; alternates = ordered concessions we can live with; avoid = what we must not accept. Use correct party labels for this deal (borrower/lender, buyer/seller, landlord/tenant, etc.) — not generic vendor/customer unless the doc uses those words.",
  },
  {
    id: "unsure",
    label: "Not sure — help me figure it out",
    help: "Paste anything; the AI will infer intent and propose a sensible first draft.",
    ai_hint:
      "First identify what kind of agreement this actually is from the text. Then infer the best of full_playbook / format_only / single_clause / counter_paper. Set intent_suggestion + reason. Produce a moderate full_playbook-style result unless the doc is clearly a single clause or clearly one-sided paper. NEVER invent a vertical (SaaS, etc.) that is not in the document.",
  },
];

export const AUDIENCE_OPTIONS: ReadonlyArray<{ id: Audience; label: string }> = [
  { id: "legal", label: "Internal legal" },
  { id: "procurement", label: "Procurement / purchasing" },
  { id: "sales", label: "Sales / commercial" },
  { id: "business", label: "Business / deal owners" },
  { id: "external_counsel", label: "External counsel" },
  { id: "mixed", label: "Mixed audience" },
];

/**
 * Suggested sides only — our_side is FREE-FORM. Always allow custom
 * (guarantor, target company, franchisee, sublandlord, etc.).
 */
export const SIDE_SUGGESTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "buyer / customer / licensee", label: "We buy / customer / licensee" },
  { value: "seller / vendor / licensor", label: "We sell / vendor / licensor" },
  { value: "borrower / obligor", label: "We borrow / obligor" },
  { value: "lender / financing party", label: "We lend / financing party" },
  { value: "guarantor", label: "We guarantee" },
  { value: "landlord / lessor", label: "We are landlord / lessor" },
  { value: "tenant / lessee", label: "We are tenant / lessee" },
  { value: "employer", label: "We are employer" },
  { value: "either / neutral", label: "Either side (neutral)" },
  { value: "unknown", label: "Not sure yet" },
];

/** @deprecated use SIDE_SUGGESTIONS — kept so older imports don't break mid-edit */
export const SIDE_OPTIONS = SIDE_SUGGESTIONS.map((s) => ({
  id: s.value,
  label: s.label,
  help: s.label,
}));

/**
 * Which brief fields the AI should elicit for a given intent.
 * Intent MUST stay consistent with later steps — don't ask granularity on
 * single_clause; always ask focus there; always ask our_side (customizable).
 */
export function fieldsForIntent(intent: Intent): ElicitFieldId[] {
  switch (intent) {
    case "single_clause":
      return ["focus", "our_side", "audience", "contract_type", "notes"];
    case "format_only":
      return ["our_side", "audience", "contract_type", "granularity", "notes"];
    case "counter_paper":
      return ["our_side", "audience", "contract_type", "granularity", "notes"];
    case "unsure":
      return ["intent", "focus", "our_side", "audience", "contract_type", "granularity", "notes"];
    case "full_playbook":
    default:
      return ["our_side", "audience", "contract_type", "granularity", "notes"];
  }
}

export function intentDefaultGranularity(intent: Intent): Granularity {
  if (intent === "single_clause" || intent === "format_only") return "low";
  return "default";
}

export const GRANULARITY_OPTIONS: ReadonlyArray<{
  id: Granularity;
  label: string;
  help: string;
  target_rules: string;
}> = [
  {
    id: "low",
    label: "Low — hot-button only",
    help: "5–10 high-impact topics (ACC: start with hot-button issues).",
    target_rules: "5–10",
  },
  {
    id: "default",
    label: "Default — solid coverage",
    help: "10–20 material clauses covering the usual risk areas for THIS agreement type.",
    target_rules: "10–20",
  },
  {
    id: "high",
    label: "High — comprehensive",
    help: "20–35 topics; include secondary and jurisdictional items.",
    target_rules: "20–35",
  },
];

/**
 * Chips for contract type — deliberately diverse. Order is NOT priority for the
 * model; empty user choice means "infer from the document only".
 */
export const COMMON_CONTRACT_TYPES = [
  // Finance / credit
  "Loan / credit facility",
  "Promissory note",
  "Security / pledge / guarantee",
  "Intercreditor / subordination",
  // Commercial
  "NDA / confidentiality",
  "Master services agreement (MSA)",
  "Statement of work (SOW)",
  "Procurement / purchase agreement",
  "Vendor / supplier agreement",
  "SaaS / subscription",
  "Professional services",
  "License agreement",
  "Distribution / reseller",
  // Data / employment / corp
  "Data processing agreement (DPA)",
  "Employment / contractor",
  "Consulting agreement",
  // Property / M&A / other
  "Lease (real estate)",
  "Equipment lease / financing",
  "M&A / SPA / APA",
  "Shareholders / JV agreement",
  "Settlement / release",
  "Partnership / collaboration",
  "Other / mixed",
] as const;

/**
 * Suggested governing-law chips for the context step. Free-form still allowed;
 * "Other/unsure" simply leaves the field for the user to type or skip.
 */
export const GOVERNING_LAW_OPTIONS: ReadonlyArray<string> = [
  "Delaware",
  "New York",
  "England & Wales",
  "California",
  "Brazil",
  "Other/unsure",
];

export function defaultBrief(): PlaybookBrief {
  return {
    intent: "full_playbook",
    focus: "",
    name: "",
    audience: "legal",
    our_side: "unknown",
    contract_type: "",
    granularity: "default",
    notes: "",
    governing_law: "",
  };
}

// ---------- JSON Schema for extraction (strict mode) ----------

const RISK_ENUM = { type: "string", enum: ["green", "yellow", "red"] };
const RAISE_ENUM = { type: "string", enum: ["proactive", "reactive", "either"] };
const INTENT_ENUM = {
  type: "string",
  enum: [
    "full_playbook",
    "format_only",
    "single_clause",
    "counter_paper",
    "unsure",
  ],
};

export const EXTRACT_SCHEMA = {
  name: "PlaybookExtract",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "agreement_type",
      "party_vocabulary",
      "summary",
      "ai_notes",
      "rules",
      "intent_suggestion",
      "intent_suggestion_reason",
    ],
    properties: {
      /**
       * Short grounded label, e.g. "senior secured term loan", "mutual NDA",
       * "commercial lease". MUST come from the document (or user contract_type).
       * NEVER invent "SaaS" for a loan.
       */
      agreement_type: { type: "string" },
      /**
       * Party labels actually used or correct for this deal, e.g.
       * "Lender / Borrower", "Buyer / Seller", "Landlord / Tenant".
       */
      party_vocabulary: { type: "string" },
      summary: { type: "string" },
      ai_notes: { type: "string" },
      intent_suggestion: { anyOf: [INTENT_ENUM, { type: "null" }] },
      intent_suggestion_reason: { type: ["string", "null"] },
      rules: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "id",
            "topic",
            "preferred",
            "alternates",
            "avoid",
            "risk",
            "sample_language",
            "escalate_when",
            "source_quote",
            "raise_mode",
            "confidence",
            "rationale",
          ],
          properties: {
            id: { type: "string" },
            topic: { type: "string" },
            preferred: { type: "string" },
            alternates: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["rank", "text", "risk"],
                properties: {
                  rank: { type: "number" },
                  text: { type: "string" },
                  risk: RISK_ENUM,
                },
              },
            },
            avoid: { type: "string" },
            risk: RISK_ENUM,
            sample_language: { type: "string" },
            escalate_when: { type: "string" },
            source_quote: { type: "string" },
            raise_mode: RAISE_ENUM,
            confidence: { type: "number" },
            rationale: { type: "string" },
          },
        },
      },
    },
  },
} as const;

// ---------- Prompts ----------

/** Max chars of source document sent to the model (keeps nano reliable). */
export const MAX_DOC_CHARS = 14000;

/**
 * Guard static-asset routes against path traversal. Rejects any request path
 * that, once percent-decoded, contains a `..` parent-directory segment (or is
 * malformed). Pure string check so it can be unit-tested offline and reused by
 * the Hono `/frontend/*` and `/shared/*` handlers.
 */
export function isSafeAssetPath(path: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false; // malformed encoding → refuse
  }
  const normalized = decoded.replace(/\\/g, "/");
  return !normalized.includes("..");
}

export function truncateDoc(text: string, max = MAX_DOC_CHARS): string {
  const t = text.replace(/\r\n/g, "\n").trim();
  if (t.length <= max) return t;
  const head = Math.floor(max * 0.7);
  const tail = max - head - 80;
  return (
    t.slice(0, head) +
    "\n\n…[middle truncated for length]…\n\n" +
    t.slice(-tail)
  );
}

function sideGuidance(side: string): string {
  const s = (side || "unknown").toLowerCase().trim();
  if (!s || s === "unknown" || s === "not sure yet") {
    return (
      "Side unknown/neutral. Infer only if the document makes it obvious; " +
      "otherwise stay balanced. NEVER default to buyer/vendor SaaS framing."
    );
  }
  if (/\beither\b|\bneutral\b/.test(s)) {
    return "Neutral playbook — state both sides' interests without favoring either.";
  }
  if (/\bborrow|obligor|debtor\b/.test(s)) {
    return (
      `User side: "${side}". Protect the party taking funds (narrow covenants, ` +
      "cure rights, materiality, limited EoDs). Use Lender/Borrower vocabulary — never SaaS/vendor."
    );
  }
  if (/\blend|creditor|financing party|bank\b/.test(s)) {
    return (
      `User side: "${side}". Protect the party advancing funds (CP, reporting, covenants, ` +
      "EoDs, remedies, security). Use Lender/Borrower vocabulary."
    );
  }
  if (/\bbuy|customer|licensee|purchaser\b/.test(s)) {
    return (
      `User side: "${side}". Protect the receiving commercial party. If the document is a LOAN, ` +
      "do NOT force buyer/SaaS framing — map to the natural obligor role and note the mismatch."
    );
  }
  if (/\bsell|vendor|licensor|supplier\b/.test(s)) {
    return `User side: "${side}". Protect the providing commercial party; stay document-true.`;
  }
  if (/\bguarant/.test(s)) {
    return `User side: "${side}". Protect the guarantor (cap, duration, defenses, release).`;
  }
  if (/\blandlord|lessor\b/.test(s)) {
    return `User side: "${side}". Protect landlord/lessor positions on rent, default, remedies.`;
  }
  if (/\btenant|lessee\b/.test(s)) {
    return `User side: "${side}". Protect tenant/lessee (use, assignment, cure, soft damages).`;
  }
  return (
    `User described their side as: "${side}". Bias preferred positions to protect that role. ` +
    "Use the document's party vocabulary. Never invent SaaS framing."
  );
}

// ---------- Brief elicitation schema (AI proposes context with alternatives) ----------

export const ELICIT_BRIEF_SCHEMA = {
  name: "BriefElicitation",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "intro",
      "detected_agreement_type",
      "detected_parties",
      "intent_suggestion",
      "intent_suggestion_reason",
      "fields",
    ],
    properties: {
      intro: { type: "string" },
      detected_agreement_type: { type: "string" },
      detected_parties: { type: "string" },
      intent_suggestion: {
        anyOf: [
          {
            type: "string",
            enum: [
              "full_playbook",
              "format_only",
              "single_clause",
              "counter_paper",
              "unsure",
            ],
          },
          { type: "null" },
        ],
      },
      intent_suggestion_reason: { type: ["string", "null"] },
      fields: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "id",
            "label",
            "help",
            "suggestions",
            "recommended",
            "required",
            "input_type",
          ],
          properties: {
            id: {
              type: "string",
              enum: [
                "intent",
                "focus",
                "audience",
                "our_side",
                "contract_type",
                "granularity",
                "notes",
                "name",
              ],
            },
            label: { type: "string" },
            help: { type: ["string", "null"] },
            suggestions: { type: "array", items: { type: "string" } },
            recommended: { type: "string" },
            required: { type: "boolean" },
            input_type: { type: "string", enum: ["text", "textarea"] },
          },
        },
      },
    },
  },
} as const;

export function buildElicitBriefPrompt(brief: PlaybookBrief): string {
  const needed = fieldsForIntent(brief.intent);
  return `You are a contracts playbook assistant. The user already chose an intent
and pasted a document. You ELICIT missing context so extraction is accurate.
You DO NOT extract playbook rules yet. Emit ONE JSON BriefElicitation.

# STEP 0 — Read the document
Identify agreement type and party labels from the text (loan ≠ SaaS ≠ lease).
Set detected_agreement_type and detected_parties from the document ONLY.

# User intent so far
intent = ${brief.intent}
focus so far = ${brief.focus || "(none)"}
name so far = ${brief.name || "(none)"}
notes so far = ${brief.notes || "(none)"}

# Fields you MUST emit (and ONLY these ids, in a sensible order)
${needed.map((id) => `- ${id}`).join("\n")}

Intent ↔ field rules (non-negotiable):
- single_clause → focus is REQUIRED; suggest concrete clause topics from the doc.
  Do NOT emit granularity.
- format_only → keep positions light; suggest granularity low as recommended.
- counter_paper → our_side is critical (who WE are when redlining THEIR paper);
  suggestions must be roles, not "vendor vs buyer" mashups.
- unsure → emit intent field with ≥2 alternatives (full_playbook, counter_paper, …)
  grounded in the doc; recommended = best guess.
- full_playbook → standard context fields.

# our_side (CRITICAL)
- Free-form role. suggestions MUST include ≥3 realistic options for THIS document
  (e.g. for a loan: "borrower / obligor", "lender / financing party", "guarantor",
  "either / neutral" — NOT SaaS buyer/seller unless the doc is commercial purchase).
- recommended = best guess from the document + intent.
- Always allow the user to type a custom role later (you still provide chips).

# Other fields
- audience: legal, procurement, sales, business, external_counsel, mixed (as labels).
- contract_type: short grounded label matching the document (loan, NDA, lease…).
- granularity: only if listed above — labels like "low", "default", "high" or
  human "Low — hot-button only" etc.; recommended must be parseable.
- notes: optional tips; suggestions can be empty array ONLY if nothing useful —
  prefer 2 short optional note starters.
- Every field: suggestions length ≥ 2 (except notes may be ≥ 0); recommended
  should usually equal suggestions[0].

# Forbidden
- Never invent SaaS for a loan. Never vendor-vs-buyer on Lender/Borrower paper.
- Never chat. JSON only matching the schema.`;
}

export function repairElicitBrief(
  raw: unknown,
  brief: PlaybookBrief,
): BriefElicitation {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const needed = new Set(fieldsForIntent(brief.intent));
  const fieldsIn = Array.isArray(o.fields) ? o.fields : [];
  const fields: ElicitField[] = [];
  const seen = new Set<string>();

  for (const f of fieldsIn) {
    const row = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
    const id = String(row.id ?? "") as ElicitFieldId;
    if (!needed.has(id) || seen.has(id)) continue;
    seen.add(id);
    let suggestions = (Array.isArray(row.suggestions) ? row.suggestions : [])
      .map((s) => String(s).trim())
      .filter(Boolean);
    let recommended = String(row.recommended ?? "").trim();

    // Seed defaults if model skimped.
    if (id === "our_side" && suggestions.length < 2) {
      suggestions = SIDE_SUGGESTIONS.slice(0, 6).map((s) => s.value);
    }
    if (id === "audience" && suggestions.length < 2) {
      suggestions = AUDIENCE_OPTIONS.map((a) => a.id);
    }
    if (id === "granularity" && suggestions.length < 2) {
      suggestions = GRANULARITY_OPTIONS.map((g) => g.id);
    }
    if (id === "intent" && suggestions.length < 2) {
      suggestions = INTENT_OPTIONS.filter((i) => i.id !== "unsure").map((i) => i.id);
    }
    if (!recommended && suggestions[0]) recommended = suggestions[0];
    if (recommended && !suggestions.includes(recommended)) {
      suggestions = [recommended, ...suggestions];
    }

    fields.push({
      id,
      label: String(row.label ?? id),
      help: row.help == null ? null : String(row.help),
      suggestions,
      recommended,
      required: Boolean(row.required) ||
        id === "our_side" ||
        (id === "focus" && brief.intent === "single_clause") ||
        (id === "intent" && brief.intent === "unsure"),
      input_type: row.input_type === "textarea" || id === "notes" || id === "focus"
        ? "textarea"
        : "text",
    });
  }

  // Ensure required field ids exist even if model omitted them.
  for (const id of fieldsForIntent(brief.intent)) {
    if (seen.has(id)) continue;
    fields.push(fallbackElicitField(id, brief));
  }

  // Stable order = fieldsForIntent order.
  const order = fieldsForIntent(brief.intent);
  fields.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  const intentRaw = o.intent_suggestion;
  const intent_suggestion =
    intentRaw === "full_playbook" ||
    intentRaw === "format_only" ||
    intentRaw === "single_clause" ||
    intentRaw === "counter_paper" ||
    intentRaw === "unsure"
      ? intentRaw
      : null;

  return {
    intro: String(o.intro ?? "").trim() ||
      "Confirm a few details so the playbook matches your side and this document.",
    detected_agreement_type: String(o.detected_agreement_type ?? "").trim() ||
      "agreement",
    detected_parties: String(o.detected_parties ?? "").trim() || "parties as named",
    intent_suggestion,
    intent_suggestion_reason: o.intent_suggestion_reason == null
      ? null
      : String(o.intent_suggestion_reason).trim() || null,
    fields,
  };
}

function fallbackElicitField(id: ElicitFieldId, brief: PlaybookBrief): ElicitField {
  switch (id) {
    case "our_side":
      return {
        id,
        label: "Our side of the table",
        help: "Who we protect. Pick a chip or type a custom role (guarantor, target, subtenant…).",
        suggestions: SIDE_SUGGESTIONS.map((s) => s.value),
        recommended: brief.our_side || "unknown",
        required: true,
        input_type: "text",
      };
    case "focus":
      return {
        id,
        label: brief.intent === "single_clause" ? "Which clause / topic?" : "Focus (optional)",
        help: "What to prioritize in this document.",
        suggestions: [
          "Governing law & dispute resolution",
          "Limitation of liability",
          "Termination & remedies",
          "Payment / fees",
        ],
        recommended: brief.focus || "",
        required: brief.intent === "single_clause",
        input_type: "textarea",
      };
    case "audience":
      return {
        id,
        label: "Who will use this playbook?",
        help: null,
        suggestions: AUDIENCE_OPTIONS.map((a) => a.id),
        recommended: brief.audience || "legal",
        required: false,
        input_type: "text",
      };
    case "contract_type":
      return {
        id,
        label: "Contract type",
        help: "Leave blank to rely on document detection — or refine it.",
        suggestions: [...COMMON_CONTRACT_TYPES.slice(0, 8)],
        recommended: brief.contract_type || "",
        required: false,
        input_type: "text",
      };
    case "granularity":
      return {
        id,
        label: "How deep?",
        help: null,
        suggestions: GRANULARITY_OPTIONS.map((g) => g.id),
        recommended: intentDefaultGranularity(brief.intent),
        required: false,
        input_type: "text",
      };
    case "intent":
      return {
        id,
        label: "What should we build?",
        help: "You were unsure — pick the closest fit for this document.",
        suggestions: INTENT_OPTIONS.filter((i) => i.id !== "unsure").map((i) => i.id),
        recommended: "full_playbook",
        required: true,
        input_type: "text",
      };
    case "notes":
      return {
        id,
        label: "Anything else we should know?",
        help: "Hard stops, house policies, must-haves.",
        suggestions: [
          "Always escalate unlimited liability",
          "Prefer Delaware / New York law",
          "No comments — proceed",
        ],
        recommended: brief.notes || "",
        required: false,
        input_type: "textarea",
      };
    case "name":
    default:
      return {
        id: "name",
        label: "Playbook name",
        help: null,
        suggestions: [brief.name || "Playbook draft", "Negotiation positions v1"],
        recommended: brief.name || "Playbook draft",
        required: true,
        input_type: "text",
      };
  }
}

/** Map free-form elicit answers onto a PlaybookBrief (intent-aware). */
export function applyElicitAnswers(
  brief: PlaybookBrief,
  answers: Record<string, string>,
  elicitation: BriefElicitation | null,
): PlaybookBrief {
  const next: PlaybookBrief = { ...brief };
  const get = (id: string) => (answers[id] ?? "").trim();

  if (get("intent")) {
    const v = get("intent");
    if (
      v === "full_playbook" ||
      v === "format_only" ||
      v === "single_clause" ||
      v === "counter_paper" ||
      v === "unsure"
    ) {
      next.intent = v;
    }
  } else if (
    brief.intent === "unsure" &&
    elicitation?.intent_suggestion &&
    elicitation.intent_suggestion !== "unsure"
  ) {
    next.intent = elicitation.intent_suggestion;
  }

  if (get("focus") || next.intent === "single_clause") {
    next.focus = get("focus") || next.focus;
  }
  if (get("our_side")) next.our_side = get("our_side");
  if (get("audience")) {
    const a = get("audience").toLowerCase().replace(/\s+/g, "_");
    const map: Record<string, Audience> = {
      legal: "legal",
      internal_legal: "legal",
      procurement: "procurement",
      procurement_purchasing: "procurement",
      sales: "sales",
      sales_commercial: "sales",
      business: "business",
      business_deal_owners: "business",
      external_counsel: "external_counsel",
      mixed: "mixed",
    };
    next.audience = map[a] ??
      (["legal", "procurement", "sales", "business", "external_counsel", "mixed"]
          .includes(get("audience"))
        ? get("audience") as Audience
        : next.audience);
    // Also accept "Internal legal" style from chips
    for (const opt of AUDIENCE_OPTIONS) {
      if (
        get("audience").toLowerCase() === opt.label.toLowerCase() ||
        get("audience").toLowerCase() === opt.id
      ) {
        next.audience = opt.id;
      }
    }
  }
  if (get("contract_type")) next.contract_type = get("contract_type");
  // Present-but-empty means the user CLEARED it (deselected chip + emptied the
  // custom input), so honor the clear. Absent means "not asked" → keep as-is.
  if ("governing_law" in answers) {
    next.governing_law = normalizeGoverningLaw(get("governing_law"));
  }
  if (get("granularity")) {
    const g = get("granularity").toLowerCase();
    if (g.startsWith("low")) next.granularity = "low";
    else if (g.startsWith("high")) next.granularity = "high";
    else if (g.startsWith("default") || g.includes("solid")) next.granularity = "default";
  } else {
    next.granularity = intentDefaultGranularity(next.intent);
  }
  if (get("notes")) next.notes = get("notes");
  if (get("name")) next.name = get("name");

  // Intent consistency cleanup.
  if (next.intent === "single_clause") {
    // single_clause needs a focus; /api/extract rejects it otherwise. If we
    // resolved into single_clause (e.g. from an "unsure" suggestion) without a
    // clause to focus on, fall back to full_playbook rather than stranding the
    // user in a state the next step will 400 on.
    if (!next.focus.trim()) {
      next.intent = "full_playbook";
    } else {
      next.granularity = "low";
    }
  }
  if (next.intent === "format_only" && next.granularity === "high") {
    // allow but ok
  }
  if (!next.our_side) next.our_side = "unknown";

  // Prefer detected type if user left contract_type blank.
  if (!next.contract_type && elicitation?.detected_agreement_type) {
    next.contract_type = elicitation.detected_agreement_type;
  }

  return next;
}

/** "Other/unsure" is a UI escape hatch, not a real jurisdiction. */
function normalizeGoverningLaw(raw: string): string {
  const g = (raw || "").trim();
  if (!g || /^other\s*\/?\s*unsure$/i.test(g)) return "";
  return g;
}

export function buildExtractPrompt(brief: PlaybookBrief): string {
  const intentMeta = INTENT_OPTIONS.find((o) => o.id === brief.intent);
  const granMeta = GRANULARITY_OPTIONS.find((o) => o.id === brief.granularity);
  const userType = brief.contract_type.trim();
  const govLaw = normalizeGoverningLaw(brief.governing_law);
  const govLawBlock = govLaw
    ? `Governing law / jurisdiction: ${govLaw}
  → Reflect jurisdiction-specific norms for this law (e.g. non-compete, ` +
      `liability-cap, and penalty / liquidated-damages enforceability), and ` +
      `note in the rule when a position is jurisdiction-dependent.`
    : `Governing law / jurisdiction: (none specified — infer only if the ` +
      `document states it; do NOT assume a jurisdiction).`;

  return `You are a contracts playbook author for varied organizations — banks,
borrowers, buyers, sellers, landlords, employers, and more. You are NOT a
SaaS-only or procurement-only assistant.
You DO NOT chat. You emit ONE JSON object matching the PlaybookExtract schema.

# STEP 0 — Identify the document (MANDATORY, do this first)
Before writing any rule:
1. Read the title, recitals, parties, and defined terms.
2. Set agreement_type to a short grounded label from the document itself
   (examples of CORRECT labels: "senior secured term loan", "revolving credit
   facility", "mutual NDA", "commercial office lease", "asset purchase agreement",
   "master services agreement", "SaaS subscription" ONLY if the doc is actually SaaS).
3. Set party_vocabulary to the party labels THIS deal uses
   (e.g. "Lender / Borrower", "Buyer / Seller", "Landlord / Tenant",
   "Employer / Employee", "Licensor / Licensee").
4. If user-supplied contract_type is non-empty, prefer it when consistent with
   the text; if it conflicts with the document, TRUST THE DOCUMENT and note the
   conflict in ai_notes.

## FORBIDDEN hallucinations (zero tolerance)
- NEVER call a loan, credit agreement, promissory note, security agreement, or
  guarantee a "SaaS", "subscription", "vendor", or "procurement" playbook.
- NEVER write "SaaS/subscription loan" or similar mashups.
- NEVER import software/SaaS topics (uptime, SLAs, data processing as primary
  theme, usage metrics) into a finance document unless those words appear.
- NEVER import loan covenants into an NDA or lease unless they appear.
- NEVER use "vendor vs buyer" as the frame when the document says Lender/Borrower
  (or Landlord/Tenant, etc.).
- Do NOT invent dollar amounts, covenant ratios, jurisdictions, or party names
  absent from the document or user notes.

# Domain model (ACC contracts playbook)
A playbook rule is a negotiating-position row, NOT a free essay:
  Term (topic) | Preferred (default) | Alternates (ordered fallbacks) |
  Positions to Avoid | Escalate / resources | Sample language

Risk uses red / yellow / green:
- green  = preferred default; often no legal review if used as-is
- yellow = acceptable fallback; may need light review / business judgment
- red    = deal-breaker, NO-GO, or always escalate to legal

Also capture (ACC best practices):
- must-haves vs nice-to-haves vs can't-haves → preferred / yellow alt / avoid
- raise_mode: proactive vs reactive
- escalate_when — role names that fit the deal (Legal, Credit committee, CFO,
  Treasury, Privacy — only if relevant)
- source_quote grounded in the document
- short rationale for non-lawyers

Topics MUST reflect THIS agreement type. Examples:
- Loan/credit: conditions precedent, use of proceeds, interest/fees, financial
  covenants, affirmative/negative covenants, reporting, events of default,
  remedies, security/collateral, assignment, amendments, notices
- SaaS (only if doc is SaaS): service levels, data protection, fees, term,
  liability, IP, suspension
- Lease: premises, rent, term, maintenance, assignment, default, surrender
- NDA: definition of confidential info, term, residuals, compelled disclosure
Do NOT mix toolkits across agreement types.

# Intent for this run
intent = ${brief.intent}
${intentMeta?.ai_hint ?? ""}

Focus (may be empty): ${brief.focus || "(none)"}
Audience: ${brief.audience}
Our side: ${brief.our_side}
  → ${sideGuidance(brief.our_side)}
Contract type from user: ${userType || "(none — you MUST infer only from the document text)"}
Granularity: ${brief.granularity} → target roughly ${granMeta?.target_rules ?? "10–20"} rules
User notes: ${brief.notes || "(none)"}
${govLawBlock}

# Hard rules — quality bar (the user will pick among your alternatives)
1. **ONE rule per topic.** Never emit separate rules titled
   "X (Alternate)", "X (Rationale)", "X (Sample)", or "untitled".
   Rationale is the \`rationale\` field on the same rule — not its own card.
2. **preferred is a substantive negotiating POSITION**, 1–3 sentences that
   state what we want (who, what, when). FORBIDDEN as preferred:
   - "Maintain as stated in Section …"
   - "Keep the clause as-is" / "No change" / "N/A" / "as described above"
   - Meta-commentary ("This rule is foundational…")
   Restating the section number alone is NOT a position. Say the substance
   (e.g. "New York law; mutual jury-trial waiver; equitable relief carve-out").
3. **alternates: 1–3 ordered fallbacks** (rank 1 = best concession) for every
   rule except pure format_only skeletons. Each alternate must be a different
   position the user could adopt — not a rephrase of preferred.
   Empty [] only when format_only or genuinely nothing to concede.
4. **avoid** = concrete NO-GO (what we refuse), not "careful risk assessment".
5. Ground in the document; if inventing market-standard preferred because the
   doc is silent, say so in rationale and set confidence ≤ 0.55.
6. Use party_vocabulary consistently (Lender/Borrower not vendor/customer on a loan).
7. id: short stable slug for the topic once (e.g. "governing_law", "events_of_default").
8. confidence 0–1. counter_paper → preferred is OUR pushback.
9. intent_suggestion only if intent is "unsure" OR clearly wrong; else both null.
10. summary first sentence MUST include agreement_type. No SaaS unless it is SaaS.
11. Never output markdown or prose outside the JSON object.

# Output
Fill every required field. Use empty string "" for optional text you cannot fill.
Use [] for empty alternates only when allowed above.`;
}

export function buildHelpPrompt(
  brief: Partial<PlaybookBrief>,
  question: string,
): { system: string; user: string } {
  return {
    system:
      "You help a colleague build a contracts playbook from an agreement. " +
      "Customers deal with many agreement types (loans, leases, NDAs, M&A, SaaS, " +
      "employment, etc.) — never assume SaaS or procurement. " +
      "Explain in 2–4 short sentences. Plain text only — no markdown, no bullets. " +
      "NEVER ask a question back. Use ACC playbook vocabulary: preferred, " +
      "fallback, red/yellow/green, escalate, audience. " +
      `Current brief: ${JSON.stringify(brief)}.`,
    user: question,
  };
}

// ---------- Repair + assert ----------

function asString(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function asRisk(v: unknown): RiskLevel {
  if (v === "green" || v === "yellow" || v === "red") return v;
  return "yellow";
}

function asRaise(v: unknown): RaiseMode {
  if (v === "proactive" || v === "reactive" || v === "either") return v;
  return "either";
}

function asNumber(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function slugId(topic: string, index: number): string {
  const base = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  return base || `rule_${index + 1}`;
}

const JUNK_PREFERRED =
  /^(n\/a|na|none|no change|as[- ]?is|maintain|keep (the )?clause|as (stated|described|set forth)|this rule is foundational|\(preferred position not specified\))/i;
const META_TOPIC =
  /\((alternate|rationale|sample|notes?|why it matters|fallback)\)\s*$/i;
const SECTION_ONLY =
  /^(maintain|keep|preserve).{0,40}(section|§|clause)\b/i;

function normalizeTopicKey(topic: string): string {
  return topic
    .toLowerCase()
    .replace(META_TOPIC, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isJunkRule(rule: PlaybookRule): boolean {
  const topic = rule.topic.trim();
  const pref = rule.preferred.trim();
  if (!topic || topic === "(untitled)" || /^topic \d+$/i.test(topic)) return true;
  if (META_TOPIC.test(topic)) return true;
  // Guard only truly empty/degenerate positions. A hard `< 12` threshold
  // discarded legitimate short positions ("Net 30", "No residuals"); the
  // JUNK_PREFERRED / SECTION_ONLY patterns below catch the real placeholders.
  if (!pref || pref.length < 4) return true;
  if (JUNK_PREFERRED.test(pref)) return true;
  if (SECTION_ONLY.test(pref) && pref.length < 100) return true;
  if (/^n\/a$/i.test(rule.sample_language) && JUNK_PREFERRED.test(pref)) return true;
  return false;
}

/** Merge near-duplicate topics; keep the richest preferred + union alternates. */
function dedupeRules(rules: PlaybookRule[]): PlaybookRule[] {
  const byKey = new Map<string, PlaybookRule>();
  for (const r of rules) {
    const key = normalizeTopicKey(r.topic) || r.id;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        ...r,
        topic: r.topic.replace(META_TOPIC, "").trim() || r.topic,
      });
      continue;
    }
    // Prefer longer substantive preferred; absorb alternates.
    const preferExisting = existing.preferred.length >= r.preferred.length &&
      !JUNK_PREFERRED.test(existing.preferred);
    const base = preferExisting ? existing : r;
    const other = preferExisting ? r : existing;
    const texts = new Set<string>();
    const alternates = [...base.alternates, ...other.alternates]
      .filter((a) => {
        const t = a.text.trim();
        if (!t || t === base.preferred) return false;
        if (texts.has(t)) return false;
        texts.add(t);
        return true;
      })
      .map((a, i) => ({ ...a, rank: i + 1 }));
    // If other preferred differs, demote it to alternate.
    if (other.preferred && other.preferred !== base.preferred && !texts.has(other.preferred)) {
      alternates.unshift({
        rank: 1,
        text: other.preferred,
        risk: other.risk === "green" ? "yellow" : other.risk,
      });
      alternates.forEach((a, i) => {
        a.rank = i + 1;
      });
    }
    byKey.set(key, {
      ...base,
      topic: base.topic.replace(META_TOPIC, "").trim() || base.topic,
      alternates: alternates.slice(0, 4),
      avoid: base.avoid || other.avoid,
      sample_language: base.sample_language || other.sample_language,
      escalate_when: base.escalate_when || other.escalate_when,
      source_quote: base.source_quote || other.source_quote,
      rationale: base.rationale || other.rationale,
      confidence: Math.max(base.confidence, other.confidence),
    });
  }
  return Array.from(byKey.values());
}

function scrubSaasMashup(text: string): string {
  return text
    .replace(/\bSaaS\/subscription\s+/gi, "")
    .replace(/\bSaaS\s+and\s+subscription\s+/gi, "")
    .replace(/\bModerate\s+SaaS[^\n.]{0,40}loan\b/gi, "Loan")
    .replace(/\bSaaS\/subscription\s+loan\b/gi, "loan")
    .replace(/\bSaaS\s+loan\b/gi, "loan")
    .replace(/\bsubscription\s+loan\b/gi, "loan")
    .replace(/\bSaaS\s+/gi, "")
    .replace(/\bvendor-vs-buyer\b/gi, "lender-borrower")
    .replace(/\bvendor vs buyer\b/gi, "lender-borrower")
    .replace(/\bbuyer-friendly\b/gi, "party-protective")
    .replace(/\bbuyer-relevant\b/gi, "commercially relevant");
}

/** Coerce messy model output into a valid ExtractResponse shape. */
export function repairExtract(raw: unknown): ExtractResponse {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rulesIn = Array.isArray(o.rules) ? o.rules : [];
  const seenIds = new Set<string>();
  let mapped: PlaybookRule[] = rulesIn.map((r, i) => {
    const row = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    let topic = asString(row.topic, "").trim();
    topic = topic.replace(META_TOPIC, "").trim();
    if (!topic) topic = `Topic ${i + 1}`;
    let id = asString(row.id, slugId(topic, i)).trim() || slugId(topic, i);
    if (seenIds.has(id)) id = `${id}_${i + 1}`;
    seenIds.add(id);

    const altsRaw = Array.isArray(row.alternates) ? row.alternates : [];
    const alternates = altsRaw.map((a, j) => {
      const alt = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
      return {
        rank: asNumber(alt.rank, j + 1),
        text: asString(alt.text).trim(),
        risk: asRisk(alt.risk),
      };
    }).filter((a) => a.text.length > 0);

    let confidence = asNumber(row.confidence, 0.6);
    if (confidence > 1) confidence = confidence / 100;
    confidence = Math.max(0, Math.min(1, confidence));

    let preferred = asString(row.preferred).trim();
    // If preferred is junk but an alternate is good, promote first alternate.
    if ((!preferred || JUNK_PREFERRED.test(preferred) || SECTION_ONLY.test(preferred)) &&
      alternates.length > 0) {
      preferred = alternates[0].text;
      alternates.shift();
      alternates.forEach((a, j) => {
        a.rank = j + 1;
      });
    }

    return {
      id,
      topic,
      preferred: preferred || "(preferred position not specified)",
      alternates,
      avoid: asString(row.avoid).trim().replace(/^n\/a$/i, ""),
      risk: asRisk(row.risk),
      sample_language: asString(row.sample_language).trim().replace(/^n\/a$/i, ""),
      escalate_when: asString(row.escalate_when).trim().replace(/^n\/a$/i, ""),
      source_quote: asString(row.source_quote).trim(),
      raise_mode: asRaise(row.raise_mode),
      confidence,
      rationale: asString(row.rationale).trim(),
    };
  });

  mapped = dedupeRules(mapped.filter((r) => !isJunkRule(r)));

  const intentRaw = o.intent_suggestion;
  const intent_suggestion =
    intentRaw === "full_playbook" ||
    intentRaw === "format_only" ||
    intentRaw === "single_clause" ||
    intentRaw === "counter_paper" ||
    intentRaw === "unsure"
      ? intentRaw
      : null;

  let agreement_type = scrubSaasMashup(asString(o.agreement_type).trim());
  const party_vocabulary = asString(o.party_vocabulary).trim();

  let summary = scrubSaasMashup(
    asString(o.summary).trim() ||
      "Playbook draft generated from the uploaded agreement.",
  );
  let ai_notes = scrubSaasMashup(asString(o.ai_notes).trim());

  // If model omitted agreement_type but summary names a loan, fix the type.
  if (!agreement_type || /saas/i.test(agreement_type)) {
    const blob = `${summary} ${ai_notes}`.toLowerCase();
    if (/\b(loan|credit facility|lender|borrower)\b/.test(blob)) {
      agreement_type = "loan / credit agreement";
    }
  }

  return {
    agreement_type: agreement_type || "agreement (type not stated by model)",
    party_vocabulary: party_vocabulary || "parties as named in the document",
    summary,
    ai_notes,
    rules: mapped,
    intent_suggestion,
    intent_suggestion_reason: o.intent_suggestion_reason == null
      ? null
      : asString(o.intent_suggestion_reason).trim() || null,
  };
}

/** Build chip choices for elicitation: preferred + alternates, de-duped. */
export function positionChoices(rule: PlaybookRule): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    const t = s.trim();
    if (!t || out.includes(t)) return;
    out.push(t);
  };
  add(rule.preferred);
  for (const a of rule.alternates) add(a.text);
  return out;
}

/**
 * Risk of a position (preferred or an alternate) as originally extracted for a
 * rule, matched by text. Lets the review UI rebuild the alternates list when the
 * user re-picks a preferred position WITHOUT flattening every fallback to
 * "yellow". Unknown/custom text is "yellow" (needs review) by default.
 */
export function riskForPosition(rule: PlaybookRule, text: string): RiskLevel {
  const t = text.trim();
  if (rule.preferred.trim() === t) return rule.risk;
  const alt = rule.alternates.find((a) => a.text.trim() === t);
  return alt ? alt.risk : "yellow";
}

export function assertExtract(res: ExtractResponse): void {
  if (!res.summary) throw new Error("extract: missing summary");
  if (!Array.isArray(res.rules)) throw new Error("extract: rules must be array");
  if (res.rules.length === 0) {
    throw new Error(
      "extract: no usable rules after cleanup (model returned only empty/meta rows)",
    );
  }
  for (const r of res.rules) {
    if (!r.id || !r.topic || !r.preferred) {
      throw new Error(`extract: rule missing id/topic/preferred: ${JSON.stringify(r).slice(0, 120)}`);
    }
  }
}

export function assertPlaybookRecord(p: PlaybookRecord): void {
  if (!p || typeof p !== "object") throw new Error("playbook missing");
  if (!p.name?.trim()) throw new Error("playbook.name required");
  if (!p.brief?.intent) throw new Error("playbook.brief.intent required");
  // audience + our_side back NOT NULL columns in db.ts — reject empties here so
  // a bad record fails with a clear 400 instead of a SQLite constraint error.
  if (!p.brief?.audience?.trim()) throw new Error("playbook.brief.audience required");
  if (!p.brief?.our_side?.trim()) throw new Error("playbook.brief.our_side required");
  if (!Array.isArray(p.rules) || p.rules.length === 0) {
    throw new Error("playbook.rules must be a non-empty array");
  }
  for (const r of p.rules) {
    if (!r.id || !r.topic || !r.preferred) {
      throw new Error(`invalid rule: ${JSON.stringify(r).slice(0, 120)}`);
    }
  }
}

/** Human labels for UI. */
export const RISK_LABEL: Record<RiskLevel, string> = {
  green: "Green — preferred",
  yellow: "Yellow — fallback / review",
  red: "Red — escalate / avoid",
};

export const INTENT_LABEL: Record<Intent, string> = Object.fromEntries(
  INTENT_OPTIONS.map((o) => [o.id, o.label]),
) as Record<Intent, string>;
