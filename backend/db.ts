import { sqlite } from "https://esm.town/v/std/sqlite/main.ts";
import type { PlaybookRecord, RuleLink } from "../shared/types.ts";
import { latestPerFamily, nextVersion } from "../shared/versioning.ts";

// Bump suffix when changing schema (limited ALTER on Val Town SQLite).
// v2 adds lineage (family_id/version), vault_only, and links.
const TABLE = "playbooks_v2";

let migrated = false;

export async function migrate(): Promise<void> {
  if (migrated) return;
  await sqlite.execute(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      family_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      name TEXT NOT NULL,
      intent TEXT NOT NULL,
      audience TEXT NOT NULL,
      our_side TEXT NOT NULL,
      contract_type TEXT,
      rule_count INTEGER NOT NULL,
      vault_only INTEGER NOT NULL DEFAULT 0,
      links TEXT,
      payload TEXT NOT NULL
    )
  `);
  migrated = true;
}

export interface SaveResult {
  id: number;
  family_id: string;
  version: number;
}

/**
 * Save a playbook as a new version. Pass `familyId` to record it as the next
 * version of an existing playbook lineage; omit to start a new lineage.
 */
export async function savePlaybook(
  playbook: PlaybookRecord,
  familyId?: string,
): Promise<SaveResult> {
  await migrate();
  const family = (familyId ?? "").trim() || crypto.randomUUID();

  const existing = await sqlite.execute({
    sql: `SELECT version FROM ${TABLE} WHERE family_id = ?`,
    args: [family],
  });
  const version = nextVersion(existing.rows.map((r) => Number(r[0])));

  const result = await sqlite.execute({
    sql: `INSERT INTO ${TABLE}
      (family_id, version, name, intent, audience, our_side, contract_type,
       rule_count, vault_only, links, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      family,
      version,
      playbook.name,
      playbook.brief.intent,
      playbook.brief.audience,
      playbook.brief.our_side,
      playbook.brief.contract_type || null,
      playbook.rules.length,
      playbook.vault_only ? 1 : 0,
      JSON.stringify(playbook.links ?? []),
      JSON.stringify(playbook),
    ],
  });
  return { id: Number(result.lastInsertRowid ?? 0), family_id: family, version };
}

/** Lightweight row for library/history lists (no payload). */
export interface PlaybookSummary {
  id: number;
  family_id: string;
  version: number;
  created_at: string;
  name: string;
  intent: string;
  audience: string;
  our_side: string;
  contract_type: string | null;
  rule_count: number;
  vault_only: boolean;
}

export interface PlaybookRow extends PlaybookSummary {
  links: RuleLink[];
  payload: PlaybookRecord;
}

function strOrNull(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

const SUMMARY_COLS =
  "id, family_id, version, created_at, name, intent, audience, our_side, contract_type, rule_count, vault_only";

function mapSummary(r: ArrayLike<unknown>): PlaybookSummary {
  return {
    id: Number(r[0]),
    family_id: String(r[1]),
    version: Number(r[2]),
    created_at: String(r[3]),
    name: String(r[4]),
    intent: String(r[5]),
    audience: String(r[6]),
    our_side: String(r[7]),
    contract_type: strOrNull(r[8]),
    rule_count: Number(r[9]),
    vault_only: Number(r[10]) === 1,
  };
}

function parseLinks(v: unknown): RuleLink[] {
  try {
    const parsed = JSON.parse(String(v ?? "[]"));
    return Array.isArray(parsed) ? parsed as RuleLink[] : [];
  } catch {
    return [];
  }
}

/**
 * Library view: the latest version of each playbook family, newest activity
 * first. `includeVault` gates whether private-vault playbooks are returned.
 */
export async function listPlaybooks(
  opts: { limit?: number; includeVault?: boolean } = {},
): Promise<PlaybookSummary[]> {
  await migrate();
  const { limit = 500, includeVault = true } = opts;
  const where = includeVault ? "" : "WHERE vault_only = 0";
  const result = await sqlite.execute({
    sql: `SELECT ${SUMMARY_COLS} FROM ${TABLE} ${where} ORDER BY id DESC LIMIT ?`,
    args: [limit],
  });
  return latestPerFamily(result.rows.map(mapSummary));
}

export async function getPlaybook(id: number): Promise<PlaybookRow | null> {
  await migrate();
  const result = await sqlite.execute({
    sql: `SELECT ${SUMMARY_COLS}, links, payload FROM ${TABLE} WHERE id = ? LIMIT 1`,
    args: [id],
  });
  const r = result.rows[0];
  if (!r) return null;
  return {
    ...mapSummary(r),
    links: parseLinks(r[11]),
    payload: JSON.parse(String(r[12])) as PlaybookRecord,
  };
}

/** All versions of a playbook family, newest version first (for history). */
export async function listFamilyVersions(familyId: string): Promise<PlaybookRow[]> {
  await migrate();
  const result = await sqlite.execute({
    sql: `SELECT ${SUMMARY_COLS}, links, payload FROM ${TABLE}
          WHERE family_id = ? ORDER BY version DESC`,
    args: [familyId],
  });
  return result.rows.map((r) => ({
    ...mapSummary(r),
    links: parseLinks(r[11]),
    payload: JSON.parse(String(r[12])) as PlaybookRecord,
  }));
}
