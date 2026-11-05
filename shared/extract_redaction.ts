import { restoreRedactions, restoreRuleFields, type Redaction } from "./redact.ts";
import type { ExtractResponse } from "./types.ts";

/** Restore exact placeholders in the model response locally, after the redacted request completes. */
export function restoreExtractResponse(response: ExtractResponse, redactions: Redaction[]): ExtractResponse {
  if (!redactions.length) return response;
  const restore = (value: string) => restoreRedactions(value, redactions);
  return {
    ...response,
    agreement_type: restore(response.agreement_type),
    party_vocabulary: restore(response.party_vocabulary),
    summary: restore(response.summary),
    ai_notes: restore(response.ai_notes),
    intent_suggestion_reason: response.intent_suggestion_reason === null ? null : restore(response.intent_suggestion_reason),
    rules: response.rules.map((rule) => ({
      ...restoreRuleFields(rule, redactions),
      topic: restore(rule.topic),
      rationale: restore(rule.rationale),
      escalate_when: restore(rule.escalate_when),
    })),
  };
}

/** Identify unresolved marker-shaped text without assigning invented meanings. */
export function containsRedactionMarkers(text: string): boolean {
  return /\b(?:PARTY|EMAIL|AMOUNT|DATE|PHONE|SSN|URL)_\d+\b/i.test(text);
}
