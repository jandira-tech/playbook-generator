import { OpenAI } from "https://esm.town/v/std/openai";
import {
  assertExtract,
  buildElicitBriefPrompt,
  buildExtractPrompt,
  buildHelpPrompt,
  ELICIT_BRIEF_SCHEMA,
  EXTRACT_SCHEMA,
  repairElicitBrief,
  repairExtract,
  truncateDoc,
} from "../shared/catalog.ts";
import { annotateQuoteVerification } from "../shared/verify.ts";
import {
  assertCounterReview,
  buildCounterPrompt,
  COUNTER_SCHEMA,
  repairCounterReview,
} from "../shared/counter.ts";
import type {
  BriefElicitation,
  CounterReviewResponse,
  ExtractResponse,
  PlaybookBrief,
  PlaybookRule,
} from "../shared/types.ts";

// Free Val Town OpenAI proxy — no API key required.
const MODEL = "gpt-5-nano";
const openai = new OpenAI();

/**
 * Document + intent → AI elicits context fields (our_side, audience, …)
 * with ≥2 suggestions each. User confirms before extract.
 */
export async function elicitBrief(
  brief: PlaybookBrief,
  documentText: string,
): Promise<BriefElicitation> {
  const doc = truncateDoc(documentText);
  if (doc.length < 40) {
    throw new Error(
      "Document text is too short. Paste the agreement (or at least the key clauses).",
    );
  }

  const system = buildElicitBriefPrompt(brief);
  const user =
    `Playbook name: ${brief.name || "(untitled)"}\n` +
    `User intent: ${brief.intent}\n` +
    `Focus so far: ${brief.focus || "(none)"}\n\n` +
    `--- DOCUMENT START ---\n${doc}\n--- DOCUMENT END ---\n\n` +
    "Return JSON matching BriefElicitation. Propose alternatives for each field.";

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_schema", json_schema: ELICIT_BRIEF_SCHEMA },
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("elicit: LLM returned no content");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `elicit: invalid JSON (${raw.length} chars): ${(e as Error).message}`,
    );
  }

  return repairElicitBrief(parsed, brief);
}

/**
 * Document → ACC-style playbook rules.
 */
export async function extractPlaybook(
  brief: PlaybookBrief,
  documentText: string,
): Promise<ExtractResponse> {
  const doc = truncateDoc(documentText);
  if (doc.length < 40) {
    throw new Error(
      "Document text is too short. Paste the agreement (or at least the key clauses).",
    );
  }

  const system = buildExtractPrompt(brief);
  const user =
    `Playbook name (user-facing title): ${brief.name || "(untitled)"}\n` +
    `Our side (free-form): ${brief.our_side || "unknown"}\n\n` +
    `--- DOCUMENT START ---\n${doc}\n--- DOCUMENT END ---\n\n` +
    "Return JSON matching the PlaybookExtract schema.";

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_schema", json_schema: EXTRACT_SCHEMA },
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("extract: LLM returned no content");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `extract: invalid JSON from model (${raw.length} chars): ${(e as Error).message}`,
    );
  }

  const repaired = repairExtract(parsed);
  try {
    assertExtract(repaired);
  } catch (e) {
    console.warn("extract assert failed, retrying:", (e as Error).message);
    const retry = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        {
          role: "system",
          content:
            `Your previous output was rejected: "${(e as Error).message}". ` +
            "Re-emit a valid PlaybookExtract. Every rule needs non-empty id, topic, preferred. " +
            "ONE rule per topic. preferred must be a substantive position, not 'maintain as-is'. " +
            "Use empty string for optional text; use [] for no alternates only when allowed.",
        },
        { role: "user", content: user },
      ],
      response_format: { type: "json_schema", json_schema: EXTRACT_SCHEMA },
    });
    const raw2 = retry.choices[0]?.message?.content;
    if (!raw2) throw new Error("extract retry: no content");
    let parsed2: unknown;
    try {
      parsed2 = JSON.parse(raw2);
    } catch (e2) {
      throw new Error(
        `extract retry: invalid JSON from model (${raw2.length} chars): ${(e2 as Error).message}`,
      );
    }
    const repaired2 = repairExtract(parsed2);
    assertExtract(repaired2);
    return groundQuotes(repaired2, documentText);
  }

  return groundQuotes(repaired, documentText);
}

/**
 * Verify each rule's `source_quote` against the full document so the UI can
 * flag paraphrased or hallucinated citations. Verifies against the untruncated
 * text so quotes from later sections still resolve.
 */
function groundQuotes(res: ExtractResponse, documentText: string): ExtractResponse {
  return { ...res, rules: annotateQuoteVerification(documentText, res.rules) };
}

/**
 * Counterparty-redline review: given OUR playbook rules and the OTHER side's
 * draft, classify each rule (met / fallback / nogo / missing / unclear) with a
 * grounded evidence quote and our escalation contact for deviations.
 * Same locked-output discipline as extract: strict json_schema → repair → assert
 * (one retry). The rules come from the client (a library playbook) — no DB write.
 */
export async function reviewCounter(
  rules: PlaybookRule[],
  counterpartyText: string,
  partyVocab?: string,
): Promise<CounterReviewResponse> {
  const doc = truncateDoc(counterpartyText);
  if (doc.length < 40) {
    throw new Error(
      "Counterparty text is too short. Paste the other side's draft (or the key clauses).",
    );
  }
  if (!Array.isArray(rules) || rules.length === 0) {
    throw new Error("No playbook rules to review against.");
  }

  const system = buildCounterPrompt(rules, partyVocab);
  const user =
    `Review the following counterparty draft against the ${rules.length} ` +
    `playbook rule(s) above.\n\n` +
    `--- COUNTERPARTY DRAFT START ---\n${doc}\n--- COUNTERPARTY DRAFT END ---\n\n` +
    "Return JSON matching the CounterReview schema. One assessment per rule.";

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_schema", json_schema: COUNTER_SCHEMA },
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("review-counter: LLM returned no content");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `review-counter: invalid JSON from model (${raw.length} chars): ${(e as Error).message}`,
    );
  }

  const repaired = repairCounterReview(parsed, rules);
  try {
    assertCounterReview(repaired);
  } catch (e) {
    console.warn("review-counter assert failed, retrying:", (e as Error).message);
    const retry = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        {
          role: "system",
          content:
            `Your previous output was rejected: "${(e as Error).message}". ` +
            "Re-emit a valid CounterReview. One assessment per rule we gave you, " +
            "each with the EXACT rule_id, a status from the enum, and an " +
            "evidence_quote grounded in the counterparty draft (\"\" if missing).",
        },
        { role: "user", content: user },
      ],
      response_format: { type: "json_schema", json_schema: COUNTER_SCHEMA },
    });
    const raw2 = retry.choices[0]?.message?.content;
    if (!raw2) throw new Error("review-counter retry: no content");
    let parsed2: unknown;
    try {
      parsed2 = JSON.parse(raw2);
    } catch (e2) {
      throw new Error(
        `review-counter retry: invalid JSON from model (${raw2.length} chars): ${(e2 as Error).message}`,
      );
    }
    const repaired2 = repairCounterReview(parsed2, rules);
    assertCounterReview(repaired2);
    return repaired2;
  }

  return repaired;
}

export async function explain(
  brief: Partial<PlaybookBrief>,
  question: string,
): Promise<string> {
  const { system, user } = buildHelpPrompt(brief, question);
  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const raw = completion.choices[0]?.message?.content?.trim();
  if (!raw) {
    return "Sorry, I couldn't generate a clarification. Try rephrasing your question.";
  }
  return raw;
}
