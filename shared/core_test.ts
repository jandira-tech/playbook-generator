import { prepareElicitation } from "./elicit_redaction.ts";
import { pickExtractor, needsFallback } from "./ingest.ts";
import { redactSensitive, restoreRedactions } from "./redact.ts";
import { verifyQuote } from "./verify.ts";
import { latestPerFamily, nextVersion } from "./versioning.ts";
import { createLimiter } from "../backend/ratelimit.ts";
import { persistenceEnabled } from "../backend/mode.ts";
import type { BriefElicitation } from "./types.ts";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("elicitation masks the document and restores returned suggestions", () => {
  const prepared = prepareElicitation("Contact jane@example.com about the agreement.", true);
  equal(prepared.text.includes("jane@example.com"), false);
  const result: BriefElicitation = {
    intro: "Contact [EMAIL_1]", detected_agreement_type: "NDA", detected_parties: "[EMAIL_1]",
    intent_suggestion: null, intent_suggestion_reason: null,
    fields: [{ id: "our_side", label: "Side", help: null, suggestions: ["[EMAIL_1]"], recommended: "[EMAIL_1]", required: true, input_type: "text" }],
  };
  equal(prepared.restore(result).fields[0].recommended, "jane@example.com");
  equal(prepareElicitation("jane@example.com", false).text, "jane@example.com");
});

Deno.test("redactions round trip; file dispatch and fallback", () => {
  const source = "Email jane@example.com and pay $500.";
  const result = redactSensitive(source);
  equal(restoreRedactions(result.redacted, result.redactions), source);
  equal(pickExtractor("agreement.DOCX", "application/octet-stream"), "docx");
  equal(pickExtractor("document.pdf"), "pdf");
  equal(pickExtractor("old.doc"), "unsupported");
  equal(needsFallback("  "), true);
});

Deno.test("quote grounding and family version selection", () => {
  equal(verifyQuote("Payment is due in thirty days.", "due in thirty days").status, "exact");
  equal(verifyQuote("Payment is due in thirty days.", "").status, "empty");
  equal(nextVersion([1, 3, 2]), 4);
  equal(latestPerFamily([{family_id:"a", version:1}, {family_id:"b", version:1}, {family_id:"a", version:2}]), [{family_id:"a", version:2}, {family_id:"b", version:1}]);
});

Deno.test("demo persistence and model-call window", () => {
  equal(persistenceEnabled(() => " "), false);
  equal(persistenceEnabled(() => "secret"), true);
  let now = 0;
  const limiter = createLimiter(() => now);
  for (let i = 0; i < 6; i++) equal(limiter.take("a").ok, true);
  equal(limiter.take("b").ok, false);
  now = 60_001;
  equal(limiter.take("b").ok, true);
});

Deno.test("extract output restores exact redaction placeholders locally in all displayed fields", async () => {
  const { restoreExtractResponse } = await import("./extract_redaction.ts");
  const redactions = redactSensitive("Email jane@example.com about the agreement.").redactions;
  const response = {
    agreement_type: "Agreement for [EMAIL_1]",
    party_vocabulary: "[EMAIL_1] / recipient",
    summary: "Summary for [EMAIL_1]",
    ai_notes: "Note for [EMAIL_1]",
    intent_suggestion: null,
    intent_suggestion_reason: "Reason for [EMAIL_1]",
    rules: [{ id: "one", topic: "[EMAIL_1]", preferred: "[EMAIL_1]", alternates: [{ rank: 1, text: "[EMAIL_1]", risk: "green" }], avoid: "[EMAIL_1]", risk: "green", sample_language: "[EMAIL_1]", escalate_when: "[EMAIL_1]", source_quote: "[EMAIL_1]", raise_mode: "either", confidence: 1, rationale: "[EMAIL_1]" }],
  } as const;
  const restored = restoreExtractResponse(response as unknown as import("./types.ts").ExtractResponse, redactions);
  equal(restored.agreement_type, "Agreement for jane@example.com");
  equal(restored.party_vocabulary, "jane@example.com / recipient");
  equal(restored.summary, "Summary for jane@example.com");
  equal(restored.ai_notes, "Note for jane@example.com");
  equal(restored.intent_suggestion_reason, "Reason for jane@example.com");
  equal(restored.rules[0].topic, "jane@example.com");
  equal(restored.rules[0].preferred, "jane@example.com");
  equal(restored.rules[0].alternates[0].text, "jane@example.com");
  equal(restored.rules[0].source_quote, "jane@example.com");
  equal(restored.rules[0].rationale, "jane@example.com");
  equal(restored.rules[0].escalate_when, "jane@example.com");
  equal(response.party_vocabulary, "[EMAIL_1] / recipient");
});

Deno.test("unresolved redaction markers are detected for review without guessing", async () => {
  const { containsRedactionMarkers } = await import("./extract_redaction.ts");
  equal(containsRedactionMarkers("PARTY_1 / PARTY_2"), true);
  equal(containsRedactionMarkers("Contact [EMAIL_1]"), true);
  equal(containsRedactionMarkers("Acme and Recipient"), false);
});
