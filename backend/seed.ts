import { getPlaybook, listFamilyVersions, savePlaybook } from "./db.ts";
import { DEMO_FAMILY_ID, demoPlaybook } from "../shared/demo_playbook.ts";
import type { PlaybookRow } from "../shared/types.ts";

/** Insert the public sample once. Later calls return version 1, not a visitor's copy. */
export async function ensureDemoPlaybook(): Promise<PlaybookRow> {
  const existing = await listFamilyVersions(DEMO_FAMILY_ID);
  const original = existing.find((row) => row.version === 1);
  if (original) return original;
  const saved = await savePlaybook(demoPlaybook(), DEMO_FAMILY_ID);
  const row = await getPlaybook(saved.id);
  if (!row) throw new Error("demo playbook was not stored");
  return row;
}
