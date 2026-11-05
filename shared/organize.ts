// Review-step organization primitives — pure, deterministic, browser+Deno safe.
//
// - moveRule: drag-to-reorder rule cards; order expresses negotiation priority.
// - rule links: connect related rules (e.g. arbitration ↔ forum selection) so
//   the playbook shows they move together. Links are normalized, symmetric,
//   deduped, and prunable when a rule is removed.

/** An unordered pair of linked rule ids, stored normalized (a < b). */
export interface RuleLink {
  a: string;
  b: string;
}

/** Move the rule with `id` to `toIndex` (clamped). Pure — returns a new array. */
export function moveRule<T extends { id: string }>(
  rules: T[],
  id: string,
  toIndex: number,
): T[] {
  const from = rules.findIndex((r) => r.id === id);
  if (from < 0) return rules.slice();
  const next = rules.slice();
  const [moved] = next.splice(from, 1);
  const clamped = Math.max(0, Math.min(toIndex, next.length));
  next.splice(clamped, 0, moved);
  return next;
}

/** Normalize a pair to {a, b} with a < b; null for self/empty links. */
export function normalizeLink(id1: string, id2: string): RuleLink | null {
  const x = (id1 ?? "").trim();
  const y = (id2 ?? "").trim();
  if (!x || !y || x === y) return null;
  return x < y ? { a: x, b: y } : { a: y, b: x };
}

export function areLinked(links: RuleLink[], id1: string, id2: string): boolean {
  const norm = normalizeLink(id1, id2);
  if (!norm) return false;
  return links.some((l) => l.a === norm.a && l.b === norm.b);
}

/** Add the link if absent, remove it if present. Symmetric + deduped. */
export function toggleLink(links: RuleLink[], id1: string, id2: string): RuleLink[] {
  const norm = normalizeLink(id1, id2);
  if (!norm) return links.slice();
  const exists = links.some((l) => l.a === norm.a && l.b === norm.b);
  if (exists) return links.filter((l) => !(l.a === norm.a && l.b === norm.b));
  return [...links, norm];
}

/** All rule ids linked to `id`. */
export function linkedIds(links: RuleLink[], id: string): string[] {
  const out: string[] = [];
  for (const l of links) {
    if (l.a === id) out.push(l.b);
    else if (l.b === id) out.push(l.a);
  }
  return out;
}

/** Drop any link that references an id not in `validIds` (e.g. a removed rule). */
export function pruneLinks(links: RuleLink[], validIds: Iterable<string>): RuleLink[] {
  const valid = validIds instanceof Set ? validIds : new Set(validIds);
  return links.filter((l) => valid.has(l.a) && valid.has(l.b));
}
