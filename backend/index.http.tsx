import { Hono } from "npm:hono";
import { readFile, serveFile } from "https://esm.town/v/std/utils/index.ts";
import { getPlaybook, listFamilyVersions, listPlaybooks, savePlaybook } from "./db.ts";
import { diffRules } from "../shared/versioning.ts";
import { elicitBrief, explain, extractPlaybook, reviewCounter } from "./llm.ts";
import { assertPlaybookRecord, isSafeAssetPath, truncateDoc } from "../shared/catalog.ts";
import { readJsonBody } from "./http_util.ts";
import { protectReads } from "./auth.ts";
import { persistenceEnabled } from "./mode.ts";
import { createLimiter, limitModelCalls } from "./ratelimit.ts";
import type {
  CounterReviewResponse,
  ElicitBriefRequest,
  ElicitBriefResponse,
  ExtractRequest,
  ExtractResponse,
  HelpRequest,
  HelpResponse,
  PlaybookBrief,
  PlaybookRule,
  SubmitRequest,
  SubmitResponse,
} from "../shared/types.ts";

const app = new Hono();

app.onError((err, _c) => {
  throw err;
});

// Stored records are readable only with ADMIN_TOKEN (fails closed when unset).
// Must be registered before the routes it protects.
protectReads(app, () => Deno.env.get("ADMIN_TOKEN"));
// One visitor must not spend the shared model quota (backend/ratelimit.ts).
limitModelCalls(
  app,
  ["/api/elicit-brief", "/api/extract", "/api/review-counter", "/api/help"],
  createLimiter(),
  256 * 1024,
);

/** Upper bound on rules sent to /api/review-counter in one call. */
const MAX_REVIEW_RULES = 200;

// ---------- Static frontend ----------

app.get("/frontend/*", (c) => {
  if (!isSafeAssetPath(c.req.path)) return c.text("Forbidden", 403);
  return serveFile(c.req.path, import.meta.url);
});
app.get("/shared/*", (c) => {
  if (!isSafeAssetPath(c.req.path)) return c.text("Forbidden", 403);
  return serveFile(c.req.path, import.meta.url);
});

app.get("/", async (c) => {
  const html = await readFile("/frontend/index.html", import.meta.url);
  return c.html(html);
});

// ---------- Validation ----------

const INTENTS = new Set([
  "full_playbook",
  "format_only",
  "single_clause",
  "counter_paper",
  "unsure",
]);
const AUDIENCES = new Set([
  "legal",
  "procurement",
  "sales",
  "business",
  "external_counsel",
  "mixed",
]);
const GRANS = new Set(["low", "default", "high"]);

function validateBrief(b: unknown): PlaybookBrief | string {
  if (!b || typeof b !== "object") return "missing brief";
  const o = b as Record<string, unknown>;
  if (!INTENTS.has(String(o.intent))) return "invalid brief.intent";
  const audience = String(o.audience ?? "legal");
  if (!AUDIENCES.has(audience)) return "invalid brief.audience";
  const gran = String(o.granularity ?? "default");
  if (!GRANS.has(gran)) return "invalid brief.granularity";
  // our_side is free-form (custom roles allowed)
  const our_side = String(o.our_side ?? "unknown").trim() || "unknown";
  return {
    intent: o.intent as PlaybookBrief["intent"],
    focus: String(o.focus ?? ""),
    name: String(o.name ?? "").trim(),
    audience: audience as PlaybookBrief["audience"],
    our_side,
    contract_type: String(o.contract_type ?? ""),
    granularity: gran as PlaybookBrief["granularity"],
    notes: String(o.notes ?? ""),
    governing_law: String(o.governing_law ?? ""),
  };
}

// ---------- API ----------

/**
 * POST /api/elicit-brief
 * After document paste: AI proposes context fields with alternatives.
 */
app.post("/api/elicit-brief", async (c) => {
  const body = await readJsonBody<ElicitBriefRequest>(c);
  if (body === null) return c.json({ error: "invalid JSON body" }, 400);
  const briefOrErr = validateBrief(body?.brief);
  if (typeof briefOrErr === "string") {
    return c.json({ error: briefOrErr }, 400);
  }
  const text = typeof body.document_text === "string" ? body.document_text : "";
  if (text.trim().length < 40) {
    return c.json({ error: "document_text too short" }, 400);
  }

  console.log(
    "[elicit-brief] intent=",
    briefOrErr.intent,
    "chars=",
    text.length,
  );

  const elicitation = await elicitBrief(briefOrErr, text);
  const response: ElicitBriefResponse = { elicitation };
  return c.json(response);
});

/**
 * POST /api/extract
 */
app.post("/api/extract", async (c) => {
  const body = await readJsonBody<ExtractRequest>(c);
  if (body === null) return c.json({ error: "invalid JSON body" }, 400);
  const briefOrErr = validateBrief(body?.brief);
  if (typeof briefOrErr === "string") {
    return c.json({ error: briefOrErr }, 400);
  }
  const text = typeof body.document_text === "string" ? body.document_text : "";
  if (text.trim().length < 40) {
    return c.json(
      {
        error:
          "document_text too short — paste the agreement or key clauses (≥ ~40 chars).",
      },
      400,
    );
  }
  if (briefOrErr.intent === "single_clause" && !briefOrErr.focus.trim()) {
    return c.json(
      { error: "focus is required when intent is single_clause" },
      400,
    );
  }

  console.log(
    "[extract] intent=",
    briefOrErr.intent,
    "chars=",
    text.length,
    "gran=",
    briefOrErr.granularity,
  );

  const result = await extractPlaybook(briefOrErr, text);
  console.log(
    "[extract] rules=",
    result.rules.length,
    "type=",
    result.agreement_type,
  );

  const response: ExtractResponse = result;
  return c.json(response);
});

/**
 * POST /api/review-counter
 * Review the OTHER side's draft against a playbook's rules (which come from the
 * client — e.g. a library playbook opened for review). No DB write.
 */
app.post("/api/review-counter", async (c) => {
  const body = await readJsonBody<{
    rules?: unknown;
    counterparty_text?: unknown;
    party_vocabulary?: unknown;
  }>(c);
  if (body === null) return c.json({ error: "invalid JSON body" }, 400);
  const rules = Array.isArray(body?.rules) ? (body.rules as PlaybookRule[]) : [];
  if (rules.length === 0) {
    return c.json({ error: "rules must be a non-empty array" }, 400);
  }
  if (rules.length > MAX_REVIEW_RULES) {
    return c.json({ error: `at most ${MAX_REVIEW_RULES} rules per review` }, 400);
  }
  const text = typeof body.counterparty_text === "string" ? body.counterparty_text : "";
  if (text.trim().length < 40) {
    return c.json(
      {
        error:
          "counterparty_text too short — paste the other side's draft or key clauses (≥ ~40 chars).",
      },
      400,
    );
  }
  const partyVocab =
    typeof body.party_vocabulary === "string" ? body.party_vocabulary : undefined;

  console.log(
    "[review-counter] rules=",
    rules.length,
    "chars=",
    text.length,
  );

  const result = await reviewCounter(rules, text, partyVocab);
  console.log(
    "[review-counter] assessments=",
    result.assessments.length,
  );
  const response: CounterReviewResponse = result;
  return c.json(response);
});

// The page shows a "public demo, nothing stored" banner when this says demo.
app.get("/api/mode", (c) => c.json({ demo: !persistenceEnabled(() => Deno.env.get("ADMIN_TOKEN")) }));

app.post("/api/submit", async (c) => {
  const body = await readJsonBody<SubmitRequest>(c);
  if (body === null) return c.json({ error: "invalid JSON body" }, 400);
  try {
    assertPlaybookRecord(body?.playbook);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
  const playbook = {
    ...body.playbook,
    source_excerpt: truncateDoc(body.playbook.source_excerpt || "", 8000),
  };
  if (!persistenceEnabled(() => Deno.env.get("ADMIN_TOKEN"))) {
    // Public demo: validated, not stored (backend/mode.ts).
    const demo: SubmitResponse = { ok: true, demo: true, playbook_id: 0, family_id: "demo", version: 1 };
    return c.json(demo);
  }
  const saved = await savePlaybook(playbook, body.family_id);
  const response: SubmitResponse = {
    ok: true,
    playbook_id: saved.id,
    family_id: saved.family_id,
    version: saved.version,
  };
  return c.json(response);
});

app.post("/api/help", async (c) => {
  const body = await readJsonBody<HelpRequest>(c);
  if (body === null) return c.json({ error: "invalid JSON body" }, 400);
  if (!body?.question || typeof body.question !== "string" || !body.question.trim()) {
    return c.json({ error: "missing question" }, 400);
  }
  const explanation = await explain(body.brief ?? {}, body.question.trim());
  const response: HelpResponse = { explanation };
  return c.json(response);
});

// Library: latest version per family. `?vault=exclude` hides private-vault ones.
app.get("/api/playbooks", async (c) => {
  const includeVault = c.req.query("vault") !== "exclude";
  const rows = await listPlaybooks({ includeVault });
  return c.json({ playbooks: rows });
});

// Version history for a family, newest first, with a clause-level diff against
// the immediately-older version.
app.get("/api/playbooks/family/:familyId", async (c) => {
  const familyId = c.req.param("familyId");
  const rows = await listFamilyVersions(familyId);
  if (rows.length === 0) return c.json({ error: "not found" }, 404);
  const versions = rows.map((row, i) => {
    const older = rows[i + 1]; // rows are newest-first
    return {
      id: row.id,
      family_id: row.family_id,
      version: row.version,
      created_at: row.created_at,
      name: row.name,
      rule_count: row.rule_count,
      vault_only: row.vault_only,
      diff_from_previous: older
        ? diffRules(older.payload.rules, row.payload.rules)
        : null,
    };
  });
  return c.json({ family_id: familyId, versions });
});

app.get("/api/playbooks/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "bad id" }, 400);
  const row = await getPlaybook(id);
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ playbook: row });
});

export default app.fetch;
