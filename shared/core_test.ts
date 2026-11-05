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
