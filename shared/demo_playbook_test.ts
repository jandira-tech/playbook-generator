import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { assertPlaybookRecord } from "./catalog.ts";
import { DEMO_FAMILY_ID, demoPlaybook, lineageForSubmit } from "./demo_playbook.ts";

Deno.test("the sample playbook is a storable record whose quotes sit in the excerpt", () => {
  const playbook = demoPlaybook();
  assertPlaybookRecord(playbook);
  assertEquals(playbook.vault_only, false);
  assertEquals(playbook.name, "Sample mutual NDA");
  for (const rule of playbook.rules) {
    if (!playbook.source_excerpt.includes(rule.source_quote)) {
      throw new Error(`source quote for ${rule.id} is not in the excerpt`);
    }
  }
});

Deno.test("a save cannot version the sample lineage", () => {
  assertEquals(lineageForSubmit(undefined), undefined);
  assertEquals(lineageForSubmit("  "), undefined);
  assertEquals(lineageForSubmit("family-1"), "family-1");
  assertThrows(() => lineageForSubmit(DEMO_FAMILY_ID), Error, "sample playbook");
});
