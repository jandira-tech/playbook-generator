// Pure library / version-history formatting helpers. Deterministic and
// browser+Deno safe (no Deno.* here). Keeps display formatting out of the JSX
// so it can be unit-tested. Consumed by frontend/library.tsx.

import type { RuleDiff } from "./versioning.ts";

/** Human version tag, e.g. versionLabel(3) → "v3". */
export function versionLabel(n: number): string {
  return `v${n}`;
}

/**
 * Compact clause-level diff summary for a version-history row.
 * - `null` (the first version has no predecessor) → "Initial version".
 * - all buckets empty → "No changes".
 * - otherwise the non-empty buckets, e.g. "+2 added, -1 removed, ~3 changed".
 */
export function summarizeDiff(diff: RuleDiff | null): string {
  if (!diff) return "Initial version";
  const parts: string[] = [];
  if (diff.added.length) parts.push(`+${diff.added.length} added`);
  if (diff.removed.length) parts.push(`-${diff.removed.length} removed`);
  if (diff.changed.length) parts.push(`~${diff.changed.length} changed`);
  return parts.length ? parts.join(", ") : "No changes";
}

const DAY_MS = 86_400_000;

/**
 * Relative-ish date for library cards: "today", "yesterday", "N days ago",
 * "N weeks ago", falling back to "on YYYY-MM-DD" past ~8 weeks. Unparseable
 * input returns "" so the caller can omit it. `now` is injectable for tests.
 */
export function relativeDate(iso: string, now: Date = new Date()): string {
  // Guard falsy input up front: `new Date(null)`/`new Date(0)` silently become
  // 1970 (a finite time that would otherwise render "on 1970-01-01"), and empty
  // string is not a real date either. `typeof` keeps us safe if a non-string
  // sneaks past the type checker at runtime.
  if (!iso || typeof iso !== "string") return "";
  const then = new Date(iso);
  const ms = then.getTime();
  if (!Number.isFinite(ms)) return "";
  const days = Math.floor((now.getTime() - ms) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 56) {
    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  }
  return `on ${then.toISOString().slice(0, 10)}`;
}
