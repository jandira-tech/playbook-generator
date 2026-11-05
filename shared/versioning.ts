// Playbook versioning / library logic — pure, deterministic, browser+Deno safe.
//
// Lawyers iterate on playbooks over months. Saves that are edits of the same
// playbook share a `family_id` lineage and get an incrementing `version`, so a
// library screen can show one row per playbook (latest) and a version history
// with clause-level diffs.

import type { PlaybookRule } from "./types.ts";

/** Next version number for a family: 1 if new, else max(existing)+1. */
export function nextVersion(versions: number[]): number {
  if (versions.length === 0) return 1;
  return Math.max(...versions) + 1;
}

/** Keep only the highest-version row per family; preserve first-seen order. */
export function latestPerFamily<T extends { family_id: string; version: number }>(
  rows: T[],
): T[] {
  const best = new Map<string, T>();
  const order: string[] = [];
  for (const r of rows) {
    const cur = best.get(r.family_id);
    if (!cur) order.push(r.family_id);
    if (!cur || r.version > cur.version) best.set(r.family_id, r);
  }
  return order.map((f) => best.get(f)!);
}

export interface RuleDiff {
  /** Rule ids present in next but not prev. */
  added: string[];
  /** Rule ids present in prev but not next. */
  removed: string[];
  /** Rule ids in both whose substance changed. */
  changed: string[];
}

/** Substantive signature of a rule for change detection. */
function ruleSignature(r: PlaybookRule): string {
  return JSON.stringify({
    topic: r.topic,
    preferred: r.preferred,
    avoid: r.avoid,
    risk: r.risk,
    escalate_when: r.escalate_when,
    sample_language: r.sample_language,
    // Default to [] so a legacy payload rule that predates `alternates` (or a
    // hand-rolled record missing the field) doesn't throw on `.map`.
    alternates: (r.alternates ?? []).map((a) => [a.rank, a.text, a.risk]),
  });
}

/** Clause-level diff between two playbook versions, keyed by rule id. */
export function diffRules(prev: PlaybookRule[], next: PlaybookRule[]): RuleDiff {
  const prevById = new Map(prev.map((r) => [r.id, r]));
  const nextById = new Map(next.map((r) => [r.id, r]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const r of next) if (!prevById.has(r.id)) added.push(r.id);
  for (const r of prev) if (!nextById.has(r.id)) removed.push(r.id);
  for (const r of next) {
    const p = prevById.get(r.id);
    if (p && ruleSignature(p) !== ruleSignature(r)) changed.push(r.id);
  }
  return { added, removed, changed };
}
