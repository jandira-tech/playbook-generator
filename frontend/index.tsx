/** @jsxImportSource https://esm.sh/react@18.2.0 */
import React, { useState } from "https://esm.sh/react@18.2.0?deps=react@18.2.0";
import { createRoot } from "https://esm.sh/react-dom@18.2.0/client?deps=react@18.2.0,react-dom@18.2.0";
import { applyElicitAnswers } from "../shared/catalog.ts";
import { prepareElicitation } from "../shared/elicit_redaction.ts";
import { type Redaction, redactSensitive } from "../shared/redact.ts";
import { restoreExtractResponse } from "../shared/extract_redaction.ts";
import {
  buildRecord,
  callElicitBrief,
  callExtract,
  loadSession,
  persist,
  resetSession,
  sessionFromRecord,
  STATE_KEY,
} from "./session.ts";
import { Card, ErrorBox, GhostButton, PrimaryButton, Shell } from "./ui.tsx";
import { DocumentStep, ElicitStep, IntentStep, ProcessingStep } from "./steps_intake.tsx";
import { ConfirmStep, ReviewStep, SavedStep } from "./steps_review.tsx";
import { DEMO_FAMILY_ID } from "../shared/demo_playbook.ts";
import { LibraryScreen } from "./library.tsx";
import { CounterReviewScreen } from "./counter.tsx";
import type {
  ClientSession,
  PlaybookBrief,
  PlaybookRecord,
  RuleSelection,
  Stage,
} from "../shared/types.ts";

// ---------- App ----------

/**
 * Best-effort exact party names to mask, drawn from detected party vocabulary /
 * detected parties and our_side. redactSensitive also auto-detects org names,
 * emails, amounts, dates, etc., so this only widens coverage for bare names.
 */
function collectParties(session: ClientSession): string[] {
  const raw = [
    session.party_vocabulary,
    session.elicitation?.detected_parties ?? "",
    session.brief.our_side,
  ].join(" / ");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of raw.split(/\s*(?:\/|,|;|\band\b|&)\s*/i)) {
    const t = piece.trim();
    if (t.length < 3) continue;
    if (/^(parties as named|unknown|either|neutral|not sure yet)$/i.test(t)) continue;
    if (seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

function App() {
  const [session, setSession] = useState<ClientSession>(() => loadSession());
  // "My playbooks" library is a self-contained overlay, not a persisted stage.
  const [libraryOpen, setLibraryOpen] = useState(false);
  // Access token stays only in component memory; it is never persisted with drafts.
  const [libraryToken, setLibraryToken] = useState("");
  // Counterparty-review overlay: a saved playbook whose rules we check a draft
  // against. Held transiently (not persisted) — it is a review tool, not a draft.
  const [counterRecord, setCounterRecord] = useState<PlaybookRecord | null>(null);
  // Show a one-time notice when a previous draft was restored from localStorage.
  const [resumed, setResumed] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (!raw) return false;
      const st = (JSON.parse(raw) as ClientSession).stage;
      return !!st && st !== "intent" && st !== "saved";
    } catch {
      return false;
    }
  });

  function update(patch: Partial<ClientSession>) {
    setSession((prev) => {
      const next = { ...prev, ...patch };
      persist(next);
      return next;
    });
  }

  function go(stage: Stage) {
    update({ stage, error_message: null });
  }

  function onReset() {
    setSession(resetSession());
  }

  // Duplicate a saved playbook into a fresh, editable session (review stage),
  // threading family_id so a later Save continues that lineage as a new version.
  function onDuplicate(record: PlaybookRecord, familyId: string, version: number) {
    const lineage = familyId === DEMO_FAMILY_ID ? null : familyId;
    const next = sessionFromRecord(record, lineage, lineage ? version : null);
    setSession(next);
    persist(next);
    setLibraryOpen(false);
  }

  async function runElicit(
    name: string,
    text: string,
    filename: string | null,
    redact?: boolean,
  ) {
    const brief = { ...session.brief, name };
    update({
      brief,
      document_text: text,
      source_filename: filename,
      // Redaction is a Document-step opt-in; carry it forward if provided.
      ...(typeof redact === "boolean" ? { redact_before_send: redact } : {}),
      stage: "eliciting",
      error_message: null,
      elicitation: null,
      elicit_answers: {},
    });
    try {
      const prepared = prepareElicitation(text, redact ?? session.redact_before_send, collectParties(session));
      const elicitation = prepared.restore(await callElicitBrief(brief, prepared.text));
      const answers: Record<string, string> = {};
      for (const f of elicitation.fields) {
        answers[f.id] = f.recommended || "";
      }
      update({
        stage: "elicit",
        elicitation,
        elicit_answers: answers,
        agreement_type: elicitation.detected_agreement_type,
        party_vocabulary: elicitation.detected_parties,
      });
    } catch (e: unknown) {
      update({
        stage: "error",
        error_message: (e instanceof Error ? e.message : String(e)),
      });
    }
  }

  async function runExtract(briefOverride?: PlaybookBrief) {
    const brief = briefOverride ?? session.brief;
    const filename = session.source_filename;
    update({
      brief,
      stage: "processing",
      error_message: null,
    });
    try {
      // Confidentiality: optionally redact before the document leaves the browser.
      // The AI only ever sees placeholders; we restore real values for display.
      // Quote verification runs server-side against the redacted text (placeholders
      // present on both sides, so it still matches).
      let text = session.document_text;
      let redactions: Redaction[] = [];
      if (session.redact_before_send) {
        const out = redactSensitive(text, { parties: collectParties(session) });
        text = out.redacted;
        redactions = out.redactions;
      }
      const res = restoreExtractResponse(await callExtract(brief, text, filename), redactions);
      const rules = res.rules;
      const selections: Record<string, RuleSelection> = {};
      for (const r of rules) selections[r.id] = "selected";
      update({
        stage: "review",
        rules,
        selections,
        edits: {},
        agreement_type: res.agreement_type ?? session.agreement_type,
        party_vocabulary: res.party_vocabulary ?? session.party_vocabulary,
        summary: res.summary,
        ai_notes: res.ai_notes,
        intent_suggestion: res.intent_suggestion,
        intent_suggestion_reason: res.intent_suggestion_reason,
      });
    } catch (e: unknown) {
      update({
        stage: "error",
        error_message: (e instanceof Error ? e.message : String(e)),
      });
    }
  }

  function onElicitAnswers(answers: Record<string, string>) {
    const brief = applyElicitAnswers(
      session.brief,
      answers,
      session.elicitation,
    );
    update({ brief, elicit_answers: answers });
    void runExtract(brief);
  }

  const stage = session.stage;

  // Counter-review takes precedence over the library overlay it was opened from,
  // so closing it returns the user to wherever they came from (usually library).
  if (counterRecord) {
    return (
      <CounterReviewScreen
        rules={Array.isArray(counterRecord.rules) ? counterRecord.rules : []}
        playbookName={counterRecord.name}
        partyVocabulary={counterRecord.party_vocabulary}
        onClose={() => setCounterRecord(null)}
      />
    );
  }

  if (libraryOpen) {
    return (
      <LibraryScreen
        token={libraryToken}
        onTokenChange={setLibraryToken}
        onClose={() => setLibraryOpen(false)}
        onDuplicate={onDuplicate}
        onReviewCounter={(record) => setCounterRecord(record)}
      />
    );
  }

  return (
    <Shell stage={stage} onReset={onReset}>
      {resumed && stage !== "intent" && stage !== "saved" && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
          <span>Welcome back — we restored your draft from last time. Use “Start over” to discard it.</span>
          <button
            type="button"
            className="underline shrink-0"
            onClick={() => setResumed(false)}
          >
            Dismiss
          </button>
        </div>
      )}
      {stage === "intent" && (
        <IntentStep
          brief={session.brief}
          onOpenLibrary={() => setLibraryOpen(true)}
          onNext={(patch) => {
            setSession((prev) => {
              const next = {
                ...prev,
                brief: { ...prev.brief, ...patch },
                stage: "document" as Stage,
              };
              persist(next);
              return next;
            });
          }}
        />
      )}

      {stage === "document" && (
        <DocumentStep
          session={session}
          onBack={() => go("intent")}
          onContinue={runElicit}
        />
      )}

      {stage === "eliciting" && (
        <ProcessingStep name={session.brief.name} mode="elicit" />
      )}

      {stage === "elicit" && (
        <ElicitStep
          session={session}
          onBack={() => go("document")}
          onAnswers={onElicitAnswers}
        />
      )}

      {stage === "processing" && (
        <ProcessingStep name={session.brief.name} mode="extract" />
      )}

      {stage === "review" && (
        <ReviewStep
          session={session}
          onChange={update}
          onBack={() => go("elicit")}
          onContinue={() => go("confirm")}
        />
      )}

      {stage === "confirm" && (
        <ConfirmStep
          session={session}
          onChange={update}
          onBack={() => go("review")}
          onSaved={(res) =>
            update({
              stage: "saved",
              saved_id: res.playbook_id,
              family_id: res.family_id,
              saved_version: res.version,
            })}
        />
      )}

      {stage === "saved" && (
        <SavedStep
          id={session.saved_id ?? 0}
          version={session.saved_version}
          record={buildRecord(session)}
          onNewVersion={() => go("review")}
          onAgain={onReset}
          onOpenLibrary={() => setLibraryOpen(true)}
        />
      )}

      {stage === "error" && (
        <Card>
          <h2 className="text-xl font-semibold text-rose-800 mb-2">Something went wrong</h2>
          <ErrorBox message={session.error_message ?? "Unknown error"} />
          <div className="mt-6 flex gap-3">
            <GhostButton onClick={() => go("document")}>Back to document</GhostButton>
            <PrimaryButton
              onClick={() => {
                if (!session.document_text) {
                  go("document");
                } else if (session.elicitation) {
                  // Elicitation already ran (so the failure was in extraction);
                  // re-run extraction with the answered brief instead of
                  // discarding the user's elicitation answers.
                  void runExtract(session.brief);
                } else {
                  void runElicit(
                    session.brief.name,
                    session.document_text,
                    session.source_filename,
                  );
                }
              }}
            >
              Retry
            </PrimaryButton>
          </div>
        </Card>
      )}
    </Shell>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
