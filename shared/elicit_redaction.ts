import { redactSensitive, restoreRedactions } from "./redact.ts";
import type { BriefElicitation } from "./types.ts";

/** Mask recognized document spans before context elicitation and restore them for display. */
export function prepareElicitation(text: string, enabled: boolean, parties: string[] = []) {
  const result = enabled ? redactSensitive(text, { parties }) : { redacted: text, redactions: [] };
  const restore = (value: string) => restoreRedactions(value, result.redactions);
  return {
    text: result.redacted,
    restore(value: BriefElicitation): BriefElicitation {
      return {
        ...value,
        intro: restore(value.intro),
        detected_agreement_type: restore(value.detected_agreement_type),
        detected_parties: restore(value.detected_parties),
        intent_suggestion_reason: value.intent_suggestion_reason === null ? null : restore(value.intent_suggestion_reason),
        fields: value.fields.map((field) => ({
          ...field,
          label: restore(field.label),
          help: field.help === null ? null : restore(field.help),
          suggestions: field.suggestions.map(restore),
          recommended: restore(field.recommended),
        })),
      };
    },
  };
}
