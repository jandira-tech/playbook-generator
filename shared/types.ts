// Shared types — must run in both browser and Deno.
// No `Deno.*` references in this file.

import type { QuoteVerification } from "./verify.ts";
export type { QuoteStatus, QuoteVerification } from "./verify.ts";
import type { RuleLink } from "./organize.ts";
export type { RuleLink } from "./organize.ts";
import type { RuleDiff } from "./versioning.ts";
export type { RuleDiff } from "./versioning.ts";
export type {
  CounterAssessment,
  CounterReviewResponse,
  CounterStatus,
} from "./counter.ts";

/** Why is the user here? Gates how deep extraction is and which fields matter. */
export type Intent =
  | "full_playbook"
  | "format_only"
  | "single_clause"
  | "counter_paper"
  | "unsure";

/** Who will use the finished playbook. */
export type Audience =
  | "legal"
  | "procurement"
  | "sales"
  | "business"
  | "external_counsel"
  | "mixed";

/**
 * Free-form side of the table. Chips suggest common roles (buyer, borrower,
 * guarantor, landlord…); users may always type a custom role.
 */
export type OurSide = string;

/** How many / how granular the rules should be. */
export type Granularity = "low" | "default" | "high";

export type RiskLevel = "green" | "yellow" | "red";
export type RaiseMode = "proactive" | "reactive" | "either";

export interface AlternatePosition {
  rank: number;
  text: string;
  risk: RiskLevel;
}

export interface PlaybookRule {
  id: string;
  topic: string;
  preferred: string;
  alternates: AlternatePosition[];
  avoid: string;
  risk: RiskLevel;
  sample_language: string;
  escalate_when: string;
  source_quote: string;
  raise_mode: RaiseMode;
  confidence: number;
  rationale: string;
  /**
   * Server-side grounding check of `source_quote` against the document.
   * Computed after extraction (not emitted by the model). Optional so older
   * saved records and model output remain valid.
   */
  source_quote_verification?: QuoteVerification;
}

/** Intent + context the user confirmed before extraction. */
export interface PlaybookBrief {
  intent: Intent;
  /** Required for single_clause; optional hints for unsure. */
  focus: string;
  name: string;
  audience: Audience;
  /**
   * Free-form role we protect, e.g. "borrower", "lender", "guarantor",
   * "target company", "landlord". Empty / "unknown" = neutral.
   */
  our_side: OurSide;
  contract_type: string;
  granularity: Granularity;
  notes: string;
  /**
   * Governing law / jurisdiction the deal is under (e.g. "Delaware",
   * "England & Wales", "Brazil"). Free-form; empty = not specified. An INPUT to
   * the extract prompt only — never part of the model OUTPUT schema.
   */
  governing_law: string;
}

export interface PlaybookRecord {
  name: string;
  brief: PlaybookBrief;
  rules: PlaybookRule[];
  summary: string;
  ai_notes: string;
  source_excerpt: string;
  source_filename: string | null;
  agreement_type?: string;
  party_vocabulary?: string;
  /** Related-rule links (e.g. arbitration ↔ forum), normalized + symmetric. */
  links?: RuleLink[];
  /** Save to the author's private vault only (do not surface org-wide). */
  vault_only?: boolean;
}

// ---------- Elicitation (AI proposes context fields with alternatives) ----------

export type ElicitFieldId =
  | "intent"
  | "focus"
  | "audience"
  | "our_side"
  | "contract_type"
  | "granularity"
  | "notes"
  | "name";

/** One field the model asks the user to confirm — legal-intake style. */
export interface ElicitField {
  id: ElicitFieldId;
  label: string;
  help: string | null;
  /** ≥2 alternatives the user can pick; always allow custom. */
  suggestions: string[];
  /** Model's best guess (also usually first suggestion). */
  recommended: string;
  required: boolean;
  /** textarea vs single-line. */
  input_type: "text" | "textarea";
}

export interface BriefElicitation {
  intro: string;
  detected_agreement_type: string;
  detected_parties: string;
  /** Suggested intent if user picked unsure or doc mismatches. */
  intent_suggestion: Intent | null;
  intent_suggestion_reason: string | null;
  fields: ElicitField[];
}

export interface ElicitBriefRequest {
  /** Partial brief so far (intent + name at minimum). */
  brief: PlaybookBrief;
  document_text: string;
}

export interface ElicitBriefResponse {
  elicitation: BriefElicitation;
}

// ---------- Extract / submit ----------

export interface ExtractRequest {
  brief: PlaybookBrief;
  document_text: string;
  source_filename?: string | null;
}

export interface ExtractResponse {
  agreement_type: string;
  party_vocabulary: string;
  summary: string;
  ai_notes: string;
  rules: PlaybookRule[];
  intent_suggestion: Intent | null;
  intent_suggestion_reason: string | null;
}

export interface SubmitRequest {
  playbook: PlaybookRecord;
  /** Save as the next version of an existing lineage; omit to start a new one. */
  family_id?: string;
}

export interface SubmitResponse {
  ok: true;
  playbook_id: number;
  family_id: string;
  version: number;
  /** True when the full library is closed and the public page shows the sample only. */
  demo?: boolean;
}

export interface HelpRequest {
  brief: Partial<PlaybookBrief>;
  question: string;
}

export interface HelpResponse {
  explanation: string;
}

// ---------- Library / version history (GET, read-only) ----------

/** One family row in the library list (latest version), no payload. */
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

/** Full playbook row: summary + links + the stored record payload. */
export interface PlaybookRow extends PlaybookSummary {
  links: RuleLink[];
  payload: PlaybookRecord;
}

export interface PlaybooksListResponse {
  playbooks: PlaybookSummary[];
}

export interface PlaybookDetailResponse {
  playbook: PlaybookRow;
}

/** One entry in a family's version history, newest-first from the API. */
export interface FamilyVersionEntry {
  id: number;
  family_id: string;
  version: number;
  created_at: string;
  name: string;
  rule_count: number;
  vault_only: boolean;
  /** Clause-level diff vs the immediately-older version; null for the first. */
  diff_from_previous: RuleDiff | null;
}

export interface FamilyVersionsResponse {
  family_id: string;
  versions: FamilyVersionEntry[];
}

/** UI session stages. */
export type Stage =
  | "intent"
  | "document"
  | "eliciting" // AI thinking about context
  | "elicit" // user answers AI context questions
  | "processing"
  | "review"
  | "confirm"
  | "saved"
  | "error";

export type RuleSelection = "selected" | "skipped";

export interface ClientSession {
  stage: Stage;
  brief: PlaybookBrief;
  document_text: string;
  source_filename: string | null;
  /** AI context elicitation waiting for user answers. */
  elicitation: BriefElicitation | null;
  /** field_id → user's answer (string). */
  elicit_answers: Record<string, string>;
  rules: PlaybookRule[];
  selections: Record<string, RuleSelection>;
  edits: Record<string, PlaybookRule>;
  /** Related-rule links picked in review (e.g. arbitration ↔ forum). */
  links: RuleLink[];
  /** Save to the author's private vault only. Defaults to true. */
  vault_only: boolean;
  /**
   * Redact party names & other sensitive spans before sending the document to
   * the AI (Document step opt-in, default false). The redaction map is kept
   * transient in the extract call and restored for display — never persisted to
   * the saved record.
   */
  redact_before_send: boolean;
  /**
   * "Save positions only" — when true, buildRecord stores an empty
   * source_excerpt so no document text is persisted with the playbook.
   * Default false (an excerpt is stored, per the transparency notice).
   */
  discard_source: boolean;
  agreement_type: string;
  party_vocabulary: string;
  summary: string;
  ai_notes: string;
  intent_suggestion: Intent | null;
  intent_suggestion_reason: string | null;
  saved_id: number | null;
  /** Lineage of a prior save; re-saving this session creates the next version. */
  family_id: string | null;
  /** Version number returned by the last successful save. */
  saved_version: number | null;
  error_message: string | null;
}
