// Session state, API callers, and record helpers. No JSX; runs in the browser.
import { defaultBrief, truncateDoc } from "../shared/catalog.ts";
import { recordLinks } from "../shared/review_session.ts";
import type {
  BriefElicitation,
  ClientSession,
  CounterReviewResponse,
  ElicitBriefResponse,
  ExtractResponse,
  FamilyVersionEntry,
  FamilyVersionsResponse,
  PlaybookBrief,
  PlaybookDetailResponse,
  PlaybookRecord,
  PlaybookRow,
  PlaybookRule,
  PlaybooksListResponse,
  PlaybookSummary,
  RiskLevel,
  RuleSelection,
  SubmitResponse,
} from "../shared/types.ts";

const STATE_KEY = "playbook-from-doc.session.v3";
const MAX_UPLOAD_CHARS = 200_000;

// ---------- session persistence ----------

function emptySession(): ClientSession {
  return {
    stage: "intent",
    brief: defaultBrief(),
    document_text: "",
    source_filename: null,
    elicitation: null,
    elicit_answers: {},
    rules: [],
    selections: {},
    edits: {},
    links: [],
    vault_only: true,
    redact_before_send: false,
    discard_source: false,
    agreement_type: "",
    party_vocabulary: "",
    summary: "",
    ai_notes: "",
    intent_suggestion: null,
    intent_suggestion_reason: null,
    saved_id: null,
    family_id: null,
    saved_version: null,
    error_message: null,
  };
}

function loadSession(): ClientSession {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const s = { ...emptySession(), ...(JSON.parse(raw) as ClientSession) };
      if (s.stage === "processing" || s.stage === "eliciting") s.stage = "document";
      // Drop legacy "context" stage if somehow present
      if ((s.stage as string) === "context") s.stage = "document";
      s.elicitation = s.elicitation ?? null;
      s.elicit_answers = s.elicit_answers ?? {};
      s.links = Array.isArray(s.links) ? s.links : [];
      s.vault_only = typeof s.vault_only === "boolean" ? s.vault_only : true;
      s.redact_before_send = typeof s.redact_before_send === "boolean" ? s.redact_before_send : false;
      s.discard_source = typeof s.discard_source === "boolean" ? s.discard_source : false;
      if (!s.brief || typeof s.brief.governing_law !== "string") {
        s.brief = { ...defaultBrief(), ...(s.brief ?? {}), governing_law: s.brief?.governing_law ?? "" };
      }
      s.family_id = s.family_id ?? null;
      s.saved_version = s.saved_version ?? null;
      s.agreement_type = s.agreement_type ?? "";
      s.party_vocabulary = s.party_vocabulary ?? "";
      if (!s.brief) s.brief = defaultBrief();
      if (typeof s.brief.our_side !== "string") s.brief.our_side = "unknown";
      return s;
    }
  } catch (_e) { /* fall through */ }
  return emptySession();
}

function persist(s: ClientSession) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(s));
  } catch (_e) { /* quota */ }
}

function resetSession(): ClientSession {
  const s = emptySession();
  localStorage.setItem(STATE_KEY, JSON.stringify(s));
  return s;
}

// ---------- API ----------

async function callElicitBrief(
  brief: PlaybookBrief,
  document_text: string,
): Promise<BriefElicitation> {
  const r = await fetch("/api/elicit-brief", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ brief, document_text }),
  });
  if (!r.ok) throw new Error(`/api/elicit-brief ${r.status}: ${await r.text()}`);
  const json = (await r.json()) as ElicitBriefResponse;
  return json.elicitation;
}

async function callExtract(
  brief: PlaybookBrief,
  document_text: string,
  source_filename: string | null,
): Promise<ExtractResponse> {
  const r = await fetch("/api/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ brief, document_text, source_filename }),
  });
  if (!r.ok) throw new Error(`/api/extract ${r.status}: ${await r.text()}`);
  return (await r.json()) as ExtractResponse;
}

async function callSubmit(
  playbook: PlaybookRecord,
  family_id: string | null,
): Promise<SubmitResponse> {
  const r = await fetch("/api/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(family_id ? { playbook, family_id } : { playbook }),
  });
  if (!r.ok) throw new Error(`/api/submit ${r.status}: ${await r.text()}`);
  return (await r.json()) as SubmitResponse;
}

// ---------- Library / version history (read-only GETs) ----------

async function fetchPlaybooks(includeVault: boolean): Promise<PlaybookSummary[]> {
  const qs = includeVault ? "" : "?vault=exclude";
  const r = await fetch(`/api/playbooks${qs}`);
  if (!r.ok) throw new Error(`/api/playbooks ${r.status}: ${await r.text()}`);
  const json = (await r.json()) as PlaybooksListResponse;
  return json.playbooks;
}

async function fetchPlaybook(id: number): Promise<PlaybookRow> {
  const r = await fetch(`/api/playbooks/${id}`);
  if (!r.ok) throw new Error(`/api/playbooks/${id} ${r.status}: ${await r.text()}`);
  const json = (await r.json()) as PlaybookDetailResponse;
  return json.playbook;
}

async function fetchFamilyVersions(familyId: string): Promise<FamilyVersionEntry[]> {
  const r = await fetch(`/api/playbooks/family/${encodeURIComponent(familyId)}`);
  if (!r.ok) {
    throw new Error(`/api/playbooks/family/${familyId} ${r.status}: ${await r.text()}`);
  }
  const json = (await r.json()) as FamilyVersionsResponse;
  return json.versions;
}

async function callReviewCounter(
  rules: PlaybookRule[],
  counterparty_text: string,
  party_vocabulary?: string,
): Promise<CounterReviewResponse> {
  const r = await fetch("/api/review-counter", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rules, counterparty_text, party_vocabulary }),
  });
  if (!r.ok) throw new Error(`/api/review-counter ${r.status}: ${await r.text()}`);
  return (await r.json()) as CounterReviewResponse;
}

async function callHelp(brief: Partial<PlaybookBrief>, question: string): Promise<string> {
  const r = await fetch("/api/help", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ brief, question }),
  });
  if (!r.ok) throw new Error(`/api/help ${r.status}: ${await r.text()}`);
  const json = (await r.json()) as { explanation: string };
  return json.explanation;
}

// ---------- helpers ----------

function riskColor(risk: RiskLevel): string {
  if (risk === "green") return "bg-emerald-100 text-emerald-800 border-emerald-300";
  if (risk === "red") return "bg-rose-100 text-rose-800 border-rose-300";
  return "bg-amber-100 text-amber-900 border-amber-300";
}

function effectiveRule(session: ClientSession, rule: PlaybookRule): PlaybookRule {
  return session.edits[rule.id] ?? rule;
}

function selectedRules(session: ClientSession): PlaybookRule[] {
  return session.rules
    .filter((r) => session.selections[r.id] !== "skipped")
    .map((r) => effectiveRule(session, r));
}

/**
 * Load a saved playbook record into a fresh, editable working session that
 * lands on the review stage. `familyId`/`fromVersion` thread the lineage so a
 * later Save continues the same playbook family (next version) instead of
 * starting a new one. Used by "Duplicate & edit" in the library.
 */
function sessionFromRecord(
  record: PlaybookRecord,
  familyId: string | null,
  fromVersion: number | null,
): ClientSession {
  const s = emptySession();
  const rules = Array.isArray(record.rules) ? record.rules : [];
  const selections: Record<string, RuleSelection> = {};
  for (const r of rules) selections[r.id] = "selected";
  s.stage = "review";
  s.brief = record.brief ?? s.brief;
  s.rules = rules;
  s.selections = selections;
  s.edits = {};
  s.links = Array.isArray(record.links) ? record.links : [];
  s.vault_only = typeof record.vault_only === "boolean" ? record.vault_only : true;
  s.agreement_type = record.agreement_type ?? "";
  s.party_vocabulary = record.party_vocabulary ?? "";
  s.summary = record.summary ?? "";
  s.ai_notes = record.ai_notes ?? "";
  s.document_text = record.source_excerpt ?? "";
  s.source_filename = record.source_filename ?? null;
  s.family_id = familyId;
  s.saved_version = fromVersion;
  return s;
}

function buildRecord(session: ClientSession): PlaybookRecord {
  return {
    name: session.brief.name.trim() || "Untitled playbook",
    brief: session.brief,
    rules: selectedRules(session),
    summary: session.summary,
    ai_notes: session.ai_notes,
    // "Save positions only" opt-out: persist no document text when discarded.
    source_excerpt: session.discard_source ? "" : truncateDoc(session.document_text, 8000),
    source_filename: session.source_filename,
    links: recordLinks(session.links, session.rules, session.selections),
    vault_only: session.vault_only,
  };
}

export {
  buildRecord,
  callElicitBrief,
  callExtract,
  callHelp,
  callReviewCounter,
  callSubmit,
  effectiveRule,
  emptySession,
  fetchFamilyVersions,
  fetchPlaybook,
  fetchPlaybooks,
  loadSession,
  MAX_UPLOAD_CHARS,
  persist,
  resetSession,
  riskColor,
  selectedRules,
  sessionFromRecord,
  STATE_KEY,
};
