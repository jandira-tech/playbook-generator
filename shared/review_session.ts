// Review-step session helpers — pure, deterministic, browser+Deno safe.
//
// These express the consistency rules the review UI must enforce:
//   - a rule is "kept" unless explicitly skipped (include is checked by default),
//   - saved links only connect two kept rules (skipping a rule prunes its links
//     from the record, non-destructively — re-including restores them),
//   - a rule's "linked to" badge lists only partners that are still kept.
//
// Order is significant: rule order expresses negotiation priority, so keptIds
// preserves the current array order.

import { linkedIds, pruneLinks, type RuleLink } from "./organize.ts";
import type { RuleSelection } from "./types.ts";

/** Ids of rules that are not skipped, in current (priority) order. */
export function keptIds(
  rules: { id: string }[],
  selections: Record<string, RuleSelection>,
): string[] {
  return rules.filter((r) => selections[r.id] !== "skipped").map((r) => r.id);
}

/** Links to persist: only those between two kept rules. Non-destructive. */
export function recordLinks(
  links: RuleLink[],
  rules: { id: string }[],
  selections: Record<string, RuleSelection>,
): RuleLink[] {
  return pruneLinks(links, keptIds(rules, selections));
}

/** Linked partners of `id` that are still kept (for the badge). */
export function visibleLinkedIds(
  links: RuleLink[],
  id: string,
  rules: { id: string }[],
  selections: Record<string, RuleSelection>,
): string[] {
  const kept = new Set(keptIds(rules, selections));
  return linkedIds(links, id).filter((pid) => kept.has(pid));
}
