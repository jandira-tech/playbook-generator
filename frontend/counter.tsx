/** @jsxImportSource https://esm.sh/react@18.2.0 */
import React, { useMemo, useState } from "https://esm.sh/react@18.2.0?deps=react@18.2.0";
import {
  COUNTER_STATUS_LABEL,
  counterStatusColor,
  counterStatusCounts,
} from "../shared/counter.ts";
import { fallbackMessage, needsFallback, pickExtractor } from "../shared/ingest.ts";
import { callReviewCounter, MAX_UPLOAD_CHARS } from "./session.ts";
import { extractDocxText, extractPdfText } from "./fileextract.ts";
import { Card, ErrorBox, GhostButton, PrimaryButton } from "./ui.tsx";
import type {
  CounterAssessment,
  CounterReviewResponse,
  CounterStatus,
  PlaybookRule,
} from "../shared/types.ts";

// Counterparty-redline review mode. Opened from a saved library playbook: paste
// the OTHER side's draft, get a clause-by-clause report of which of OUR positions
// are met / need a fallback / hit a no-go, with the escalation contact per
// deviation. A renderer of structured assessments — not a chat UI.

const STATUS_ORDER: CounterStatus[] = ["nogo", "fallback", "unclear", "missing", "met"];

function CounterReviewScreen({
  rules,
  playbookName,
  partyVocabulary,
  onClose,
}: {
  rules: PlaybookRule[];
  playbookName: string;
  partyVocabulary?: string;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [filename, setFilename] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<CounterReviewResponse | null>(null);

  function acceptText(body: string, fname: string | null) {
    setText(body.length > MAX_UPLOAD_CHARS ? body.slice(0, MAX_UPLOAD_CHARS) : body);
    setFilename(fname);
  }

  async function readFile(file: File) {
    setError(null);
    if (file.size > 15 * 1024 * 1024) {
      setError("File is larger than 15 MB — paste the key clauses instead.");
      return;
    }
    const fname = file.name;
    const kind = pickExtractor(fname, file.type);
    if (kind === "unsupported") {
      setError(fallbackMessage("unsupported", fname));
      return;
    }
    setExtracting(true);
    try {
      let body = "";
      if (kind === "text") {
        body = await file.text();
      } else {
        body = kind === "docx" ? await extractDocxText(file) : await extractPdfText(file);
      }
      if (needsFallback(body)) {
        setError(fallbackMessage("empty", fname));
        return;
      }
      acceptText(body, fname);
    } catch (_e) {
      setError(fallbackMessage("error", fname));
    } finally {
      setExtracting(false);
    }
  }

  async function runReview() {
    if (text.trim().length < 40) {
      setError("Paste the counterparty draft (or its key clauses) — at least ~40 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const res = await callReviewCounter(rules, text, partyVocabulary);
      setReport(res);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="playbook-theme max-w-3xl mx-auto px-4 py-8" data-testid="counter-screen">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-1">
            Counterparty review
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            Review a counterparty draft
          </h1>
          <p className="text-slate-600 mt-2 text-sm leading-relaxed max-w-xl">
            Paste the other side's draft of{" "}
            <span className="font-medium text-slate-800">{playbookName}</span>. We
            check it, clause by clause, against your {rules.length} saved
            position{rules.length === 1 ? "" : "s"} — what's met, what's a fallback,
            and what's a no-go, with who to escalate to.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          data-testid="counter-close"
          className="text-xs text-slate-500 hover:text-slate-900 underline shrink-0 mt-1"
        >
          Close
        </button>
      </header>

      <Card>
        <label
          htmlFor="counter-paste"
          className="text-[10px] font-semibold uppercase tracking-wider text-slate-500"
        >
          Counterparty draft
        </label>
        <textarea
          id="counter-paste"
          data-testid="counter-textarea"
          value={text}
          // Clamp typed/pasted text to the same ceiling the file-attach path
          // enforces, so a huge paste can't slip past MAX_UPLOAD_CHARS.
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value.slice(0, MAX_UPLOAD_CHARS))}
          rows={10}
          placeholder="Paste the other side's agreement text here…"
          className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm font-mono leading-relaxed focus:border-slate-500 focus:outline-none"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="text-xs text-slate-600 border border-slate-300 hover:border-slate-500 rounded px-3 py-2 cursor-pointer">
            Attach .docx / .pdf / .txt
            <input
              data-testid="counter-file"
              type="file"
              accept=".docx,.pdf,.txt,.md,.markdown,.rtf,.csv"
              className="hidden"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const f = e.target.files?.[0];
                if (f) void readFile(f);
              }}
            />
          </label>
          {extracting && (
            <span className="text-xs text-slate-500" data-testid="counter-extracting">
              Extracting text from {filename ?? "your file"}…
            </span>
          )}
          {filename && !extracting && (
            <span className="text-xs font-medium text-slate-700">Attached: {filename}</span>
          )}
          <span className="text-[11px] text-slate-400 ml-auto">
            Parsed in your browser — the file is not uploaded.
          </span>
        </div>

        {error && <ErrorBox message={error} />}

        <div className="mt-5 flex flex-wrap gap-3">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={runReview} disabled={busy || extracting}>
            {busy ? "Reviewing…" : "Review draft"}
          </PrimaryButton>
        </div>
      </Card>

      {report && <ReportView report={report} />}
    </div>
  );
}

function ReportView({ report }: { report: CounterReviewResponse }) {
  const counts = useMemo(
    () => counterStatusCounts(report.assessments),
    [report.assessments],
  );
  const ordered = useMemo(
    () =>
      report.assessments
        .slice()
        .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)),
    [report.assessments],
  );

  // Compact counts line, e.g. "3 met · 2 fallback · 1 no-go".
  const countParts = STATUS_ORDER.filter((s) => counts[s] > 0).map(
    (s) => `${counts[s]} ${COUNTER_STATUS_LABEL[s].toLowerCase()}`,
  );

  return (
    <div className="mt-6 space-y-4" data-testid="counter-report">
      <Card>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
          Review summary
        </div>
        <p className="text-sm text-slate-800 leading-relaxed" data-testid="counter-summary">
          {report.summary}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="counter-counts">
          {STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => (
            <span
              key={s}
              data-status={s}
              className={`text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${counterStatusColor(s)}`}
            >
              {counts[s]} {COUNTER_STATUS_LABEL[s]}
            </span>
          ))}
          {countParts.length > 0 && (
            <span className="sr-only" data-testid="counter-counts-text">
              {countParts.join(" · ")}
            </span>
          )}
        </div>
        <p className="mt-3 text-[11px] text-slate-400 leading-relaxed" data-testid="counter-caveat">
          AI-assisted — review before relying on it. Quotes are the model's reading
          of the pasted draft; confirm against the source document.
        </p>
      </Card>

      {ordered.map((a) => <AssessmentCard key={a.rule_id} assessment={a} />)}
    </div>
  );
}

function AssessmentCard({ assessment: a }: { assessment: CounterAssessment }) {
  const deviation = a.status !== "met";
  return (
    <div data-testid="counter-assessment" data-rule={a.rule_id} data-status={a.status}>
      <Card>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <h3 className="font-semibold text-slate-900 text-base">
            {a.topic || "Untitled topic"}
          </h3>
          <span
            data-testid="counter-status-chip"
            className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${counterStatusColor(a.status)}`}
          >
            {COUNTER_STATUS_LABEL[a.status]}
          </span>
        </div>

        {a.matched_position && (
          <div className="mb-3 rounded border border-slate-100 bg-slate-50 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              What their draft does
            </div>
            <p className="text-sm text-slate-800 whitespace-pre-wrap" data-testid="counter-matched">
              {a.matched_position}
            </p>
          </div>
        )}

        {a.evidence_quote
          ? (
            <div className="mb-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Their language
              </div>
              <blockquote
                data-testid="counter-evidence"
                className="border-l-2 border-slate-300 pl-3 text-sm italic text-slate-600 whitespace-pre-wrap"
              >
                {a.evidence_quote}
              </blockquote>
            </div>
          )
          : (
            <p className="mb-3 text-xs text-slate-400" data-testid="counter-no-evidence">
              No matching language found in their draft.
            </p>
          )}

        {a.deviation_note && (
          <div className="mb-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              How it deviates
            </div>
            <p className="text-sm text-slate-700 whitespace-pre-wrap" data-testid="counter-deviation">
              {a.deviation_note}
            </p>
          </div>
        )}

        {deviation && a.escalate_when && (
          <div
            className="text-xs text-slate-600"
            data-testid="counter-escalate"
          >
            <span className="font-semibold text-slate-500">Escalate to:</span> {a.escalate_when}
          </div>
        )}
      </Card>
    </div>
  );
}

export { CounterReviewScreen };
