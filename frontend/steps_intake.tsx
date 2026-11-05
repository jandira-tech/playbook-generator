/** @jsxImportSource https://esm.sh/react@18.2.0 */
import React, { useEffect, useRef, useState } from "https://esm.sh/react@18.2.0?deps=react@18.2.0";
import { GOVERNING_LAW_OPTIONS, INTENT_LABEL, INTENT_OPTIONS } from "../shared/catalog.ts";
import { fallbackMessage, needsFallback, pickExtractor } from "../shared/ingest.ts";
import { MAX_UPLOAD_CHARS } from "./session.ts";
import { SAMPLE_DOC, SAMPLE_DOC_NAME } from "./sample.ts";
import { extractDocxText, extractPdfText } from "./fileextract.ts";
import { Card, Chip, ErrorBox, GhostButton, HelpInline, PrimaryButton } from "./ui.tsx";
import type { ClientSession, PlaybookBrief } from "../shared/types.ts";

// ---------- Step 1: Intent ----------

function IntentStep({
  brief,
  onNext,
  onOpenLibrary,
}: {
  brief: PlaybookBrief;
  onNext: (patch: Partial<PlaybookBrief>) => void;
  onOpenLibrary?: () => void;
}) {
  const [intent, setIntent] = useState(brief.intent);
  const [focus, setFocus] = useState(brief.focus);

  // Public demo (no ADMIN_TOKEN on the server): say plainly that nothing is stored.
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    fetch("/api/mode")
      .then((r) => (r.ok ? r.json() : { demo: false }))
      .then((m: { demo?: boolean }) => setDemo(m.demo === true))
      .catch(() => {});
  }, []);

  return (
    <Card>
      {demo && (
        <p className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          Public demo. Do not enter real names or confidential facts. What you type is sent to
          OpenAI through Val Town to generate suggestions. Nothing is stored on this server.
        </p>
      )}
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-xl font-semibold">What do you need?</h2>
        {onOpenLibrary && (
          <button
            type="button"
            onClick={onOpenLibrary}
            data-testid="open-library"
            className="text-xs font-semibold text-slate-600 hover:text-slate-900 underline shrink-0 mt-1"
          >
            My playbooks →
          </button>
        )}
      </div>
      <p className="text-sm text-slate-600 mb-5">
        Customers arrive with different goals. Pick the closest match — this
        steers how deep the AI goes so you are not stuck with a 30-rule
        playbook when you only wanted one clause.
      </p>
      <div className="space-y-2">
        {INTENT_OPTIONS.map((o) => {
          const active = intent === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => setIntent(o.id)}
              aria-pressed={active}
              className={
                "intent-choice w-full text-left rounded-lg border px-4 py-3 transition " +
                (active
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white hover:border-slate-400")
              }
            >
              <div className="font-medium text-sm">{o.label}</div>
              <div className={"text-xs mt-0.5 " + (active ? "text-slate-300" : "text-slate-500")}>
                {o.help}
              </div>
            </button>
          );
        })}
      </div>

      {(intent === "single_clause" || intent === "unsure") && (
        <div className="mt-5">
          <label className="block text-sm font-medium mb-1">
            {intent === "single_clause" ? "Which clause / topic?" : "What are you trying to do? (optional)"}
            {intent === "single_clause" && <span className="text-rose-600"> *</span>}
          </label>
          <input
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
            placeholder={
              intent === "single_clause"
                ? "e.g. Limitation of liability, IP ownership, Termination"
                : "e.g. Vendor sent their MSA and I don't know where to start"
            }
            value={focus}
            onChange={(e: any) => setFocus(e.target.value)}
          />
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <PrimaryButton
          onClick={() => {
            if (intent === "single_clause" && !focus.trim()) return;
            onNext({ intent, focus: focus.trim() });
          }}
          disabled={intent === "single_clause" && !focus.trim()}
        >
          Continue — paste document
        </PrimaryButton>
      </div>
      <HelpInline brief={{ intent, focus }} />
    </Card>
  );
}

// ---------- Step 3: AI context elicitation ----------

function ElicitStep({
  session,
  onBack,
  onAnswers,
}: {
  session: ClientSession;
  onBack: () => void;
  onAnswers: (answers: Record<string, string>) => void;
}) {
  const elicitation = session.elicitation;
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    if (session.elicit_answers && Object.keys(session.elicit_answers).length) {
      return { ...session.elicit_answers };
    }
    const init: Record<string, string> = {};
    if (elicitation) {
      for (const f of elicitation.fields) {
        init[f.id] = f.recommended || "";
      }
    }
    return init;
  });
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [govLaw, setGovLaw] = useState<string>(session.brief.governing_law ?? "");
  const [govLawCustom, setGovLawCustom] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  if (!elicitation) {
    return (
      <Card>
        <p className="text-sm text-slate-600">No elicitation loaded.</p>
        <GhostButton onClick={onBack}>Back</GhostButton>
      </Card>
    );
  }

  function setAnswer(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
    setCustom((prev) => ({ ...prev, [id]: "" }));
  }

  function submit() {
    const merged: Record<string, string> = { ...answers };
    for (const f of elicitation!.fields) {
      const c = (custom[f.id] ?? "").trim();
      if (c) merged[f.id] = c;
    }
    // Governing law is a standalone context input (not an AI-elicited field).
    // Always convey it (even ""), so clearing the field actually clears it in
    // the brief rather than leaving the prior value stuck.
    merged.governing_law = govLawCustom.trim() || govLaw.trim();
    for (const f of elicitation!.fields) {
      if (f.required && !(merged[f.id] ?? "").trim()) {
        setErr(`“${f.label}” is required — pick a chip or write your own.`);
        return;
      }
    }
    // our_side always required effectively
    if (!(merged.our_side ?? "").trim()) {
      setErr("Tell us your side of the table — pick a role or type a custom one.");
      return;
    }
    setErr(null);
    onAnswers(merged);
  }

  return (
    <Card>
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-1">
        AI elicitation
      </div>
      <h2 className="text-xl font-semibold mb-1">Confirm context</h2>
      <p className="text-sm text-slate-600 mb-4">{elicitation.intro}</p>

      <div className="flex flex-wrap gap-2 mb-5">
        <span className="text-xs font-medium px-2.5 py-1 rounded border border-slate-300 bg-white">
          Detected: {elicitation.detected_agreement_type}
        </span>
        <span className="text-xs font-medium px-2.5 py-1 rounded border border-slate-200 bg-slate-50 text-slate-600">
          Parties: {elicitation.detected_parties}
        </span>
        <span className="text-xs font-medium px-2.5 py-1 rounded border border-indigo-200 bg-indigo-50 text-indigo-900">
          Intent: {INTENT_LABEL[session.brief.intent] ?? session.brief.intent}
        </span>
      </div>

      {elicitation.intent_suggestion &&
        elicitation.intent_suggestion !== session.brief.intent && (
        <div className="rounded border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950 mb-4">
          <strong>AI thinks intent should be:</strong>{" "}
          {INTENT_LABEL[elicitation.intent_suggestion] ?? elicitation.intent_suggestion}
          {elicitation.intent_suggestion_reason
            ? ` — ${elicitation.intent_suggestion_reason}`
            : ""}
          {elicitation.fields.some((f) => f.id === "intent")
            ? " (pick below)"
            : ""}
        </div>
      )}

      <div className="space-y-6">
        {elicitation.fields.map((f) => {
          const picked = answers[f.id] ?? "";
          const customVal = custom[f.id] ?? "";
          const display = customVal.trim() || picked;
          return (
            <div key={f.id} className="border border-slate-200 rounded-lg p-4">
              <label className="block font-medium text-sm mb-0.5">
                {f.label}
                {f.required && <span className="text-rose-600"> *</span>}
              </label>
              {f.help && (
                <p className="text-xs text-slate-500 mb-2">{f.help}</p>
              )}

              {/* Your current answer */}
              <div
                className={
                  "mb-3 rounded border px-3 py-2 text-sm " +
                  (display
                    ? "border-indigo-200 bg-indigo-50 text-indigo-950"
                    : "border-slate-100 bg-slate-50 text-slate-400")
                }
              >
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-0.5">
                  Your answer
                </div>
                {display || "Pick a suggestion or write your own…"}
              </div>

              {f.suggestions.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {f.suggestions.map((s) => {
                    const active = !customVal.trim() && picked === s;
                    return (
                      <Chip key={s} active={active} onClick={() => setAnswer(f.id, s)}>
                        {s}
                        {s === f.recommended ? " ★" : ""}
                      </Chip>
                    );
                  })}
                </div>
              )}

              {f.input_type === "textarea" ? (
                <textarea
                  className="w-full border-2 border-dashed border-slate-300 focus:border-indigo-500 rounded px-3 py-2 text-sm min-h-[72px] bg-slate-50"
                  placeholder={
                    f.id === "our_side"
                      ? "Or type a custom role (e.g. guarantor, franchisee, target board…)"
                      : "Or write your own"
                  }
                  value={customVal}
                  onChange={(e: any) => {
                    const v = e.target.value;
                    setCustom((prev) => ({ ...prev, [f.id]: v }));
                    if (v.trim()) {
                      setAnswers((prev) => ({ ...prev, [f.id]: v }));
                    } else {
                      // Custom text cleared: drop the stale answer so it isn't submitted.
                      setAnswers((prev) => {
                        const next = { ...prev };
                        delete next[f.id];
                        return next;
                      });
                    }
                  }}
                />
              ) : (
                <input
                  className="w-full border-2 border-dashed border-slate-300 focus:border-indigo-500 rounded px-3 py-2 text-sm bg-slate-50"
                  placeholder={
                    f.id === "our_side"
                      ? "Or type a custom role (e.g. guarantor, mezz lender, JV partner…)"
                      : "Or write your own"
                  }
                  value={customVal}
                  onChange={(e: any) => {
                    const v = e.target.value;
                    setCustom((prev) => ({ ...prev, [f.id]: v }));
                    if (v.trim()) {
                      setAnswers((prev) => ({ ...prev, [f.id]: v }));
                    } else {
                      // Custom text cleared: drop the stale answer so it isn't submitted.
                      setAnswers((prev) => {
                        const next = { ...prev };
                        delete next[f.id];
                        return next;
                      });
                    }
                  }}
                />
              )}
            </div>
          );
        })}

        <div className="border border-slate-200 rounded-lg p-4" data-testid="governing-law">
          <label className="block font-medium text-sm mb-0.5">Governing law (optional)</label>
          <p className="text-xs text-slate-500 mb-2">
            Which law governs the deal? Steers jurisdiction-specific norms
            (non-compete, liability caps, penalty enforceability). Leave blank if unsure.
          </p>
          <div
            className={
              "mb-3 rounded border px-3 py-2 text-sm " +
              ((govLawCustom.trim() || govLaw)
                ? "border-indigo-200 bg-indigo-50 text-indigo-950"
                : "border-slate-100 bg-slate-50 text-slate-400")
            }
          >
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-0.5">
              Your answer
            </div>
            {govLawCustom.trim() || govLaw || "No jurisdiction selected"}
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            {GOVERNING_LAW_OPTIONS.map((s) => (
              <Chip
                key={s}
                active={!govLawCustom.trim() && govLaw === s}
                onClick={() => {
                  setGovLaw(s);
                  setGovLawCustom("");
                }}
              >
                {s}
              </Chip>
            ))}
          </div>
          <input
            data-testid="governing-law-custom"
            className="w-full border-2 border-dashed border-slate-300 focus:border-indigo-500 rounded px-3 py-2 text-sm bg-slate-50"
            placeholder="Or type a jurisdiction (e.g. Singapore, Ontario, Germany)"
            value={govLawCustom}
            onChange={(e: any) => {
              const v = e.target.value;
              setGovLawCustom(v);
              // Mirror the elicited-field custom fix: clearing the custom text
              // clears the selection too, so the value can actually be removed.
              setGovLaw(v.trim() ? v : "");
            }}
          />
        </div>
      </div>

      {err && <ErrorBox message={err} />}

      <div className="mt-6 flex justify-between gap-3">
        <GhostButton onClick={onBack}>Back to document</GhostButton>
        <PrimaryButton onClick={submit}>Generate playbook positions</PrimaryButton>
      </div>
      <HelpInline brief={session.brief} />
    </Card>
  );
}

// ---------- Step 3: Document ----------

const NOTICE_KEY = "playbook-from-doc.notice.data-handling.dismissed";

function DocumentStep({
  session,
  onBack,
  onContinue,
}: {
  session: ClientSession;
  onBack: () => void;
  /** name + text + filename + redact-opt-in → AI elicit (not full extract yet). */
  onContinue: (
    name: string,
    text: string,
    filename: string | null,
    redact: boolean,
  ) => void;
}) {
  const [name, setName] = useState(session.brief.name);
  const [text, setText] = useState(session.document_text);
  const [filename, setFilename] = useState<string | null>(session.source_filename);
  const [err, setErr] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [redact, setRedact] = useState<boolean>(session.redact_before_send);
  const [noticeOpen, setNoticeOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(NOTICE_KEY) !== "1";
    } catch {
      return true;
    }
  });
  const inputRef = useRef<HTMLInputElement>(null);

  function dismissNotice() {
    setNoticeOpen(false);
    try {
      localStorage.setItem(NOTICE_KEY, "1");
    } catch { /* ignore quota */ }
  }

  /** Accept extracted text into the paste box (respecting the char cap). */
  function acceptText(body: string, fname: string) {
    setText(body.length > MAX_UPLOAD_CHARS ? body.slice(0, MAX_UPLOAD_CHARS) : body);
    setFilename(fname);
    setErr(null);
  }

  async function readFile(file: File) {
    // Binary docs (.docx/.pdf) can be larger than plain text; allow up to 15 MB.
    if (file.size > 15 * 1024 * 1024) {
      setErr("File too large (max 15 MB). Paste the text instead.");
      return;
    }
    const fname = file.name;
    const kind = pickExtractor(fname, file.type);
    setFilename(fname);

    if (kind === "text") {
      try {
        acceptText(await file.text(), fname);
      } catch {
        setErr(fallbackMessage("error", fname));
      }
      return;
    }

    if (kind === "unsupported") {
      setErr(fallbackMessage("unsupported", fname));
      return;
    }

    // .docx / .pdf → parse CLIENT-SIDE (never uploaded). Any failure or a
    // text-less (scanned/image) result falls back to the always-present paste box.
    setExtracting(true);
    setErr(null);
    try {
      const body = kind === "docx"
        ? await extractDocxText(file)
        : await extractPdfText(file);
      if (needsFallback(body)) {
        setErr(fallbackMessage("empty", fname));
      } else {
        acceptText(body, fname);
      }
    } catch (_e) {
      setErr(fallbackMessage("error", fname));
    } finally {
      setExtracting(false);
    }
  }

  function submit() {
    if (!name.trim()) {
      setErr("Give the playbook a short name.");
      return;
    }
    if (text.trim().length < 40) {
      setErr("Paste at least a few clauses (≈40+ characters).");
      return;
    }
    if (session.brief.intent === "single_clause" && !session.brief.focus.trim()) {
      setErr("Single-clause intent needs a focus topic — go back and set it.");
      return;
    }
    setErr(null);
    onContinue(name.trim(), text, filename, redact);
  }

  const intentLabel = INTENT_LABEL[session.brief.intent] ?? session.brief.intent;

  return (
    <Card>
      <h2 className="text-xl font-semibold mb-1">Your document</h2>
      <p className="text-sm text-slate-600 mb-2">
        Paste the agreement. Next, the AI will <strong>elicit</strong> your side
        of the table and related context (with alternatives you can customize) —
        matched to your intent: <em>{intentLabel}</em>
        {session.brief.focus ? ` · focus: ${session.brief.focus}` : ""}.
      </p>
      <p className="text-xs text-slate-500 mb-4">
        Loans, leases, NDAs, M&A, employment, SaaS… the model must follow{" "}
        <em>this</em> document, not invent SaaS defaults.
      </p>

      {noticeOpen && (
        <div
          data-testid="data-handling-notice"
          className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-950"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="font-semibold text-amber-900">How your document is handled</div>
            <button
              type="button"
              data-testid="dismiss-data-handling-notice"
              onClick={dismissNotice}
              className="shrink-0 text-amber-700 hover:text-amber-900 underline text-[11px] font-semibold"
            >
              Dismiss
            </button>
          </div>
          <ul className="mt-1.5 list-disc pl-4 space-y-1">
            <li>
              The pasted / extracted text is <strong>sent to the AI model</strong> to
              generate negotiating positions.
            </li>
            <li>
              <strong>.docx and PDF files are parsed in your browser</strong> — the file
              itself is never uploaded.
            </li>
            <li>
              By default an ~8,000-character <strong>excerpt is stored</strong> with the
              saved playbook. You can turn this off at the save step
              (“Save positions only”).
            </li>
          </ul>
        </div>
      )}

      <label className="block text-sm font-medium mb-1">
        Playbook name <span className="text-rose-600">*</span>
      </label>
      <input
        className="w-full border border-slate-300 rounded px-3 py-2 text-sm mb-4"
        placeholder="e.g. Term loan positions v1 · NDA review guide"
        value={name}
        onChange={(e: any) => setName(e.target.value)}
      />

      <div
        className={
          "border-2 border-dashed rounded-lg px-4 py-6 text-center mb-4 transition " +
          (dragging ? "border-slate-900 bg-slate-50" : "border-slate-300 bg-slate-50/50")
        }
        onDragOver={(e: any) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e: any) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer?.files?.[0];
          if (f) void readFile(f);
        }}
      >
        <p className="text-sm text-slate-600 mb-2">
          Drop a <strong>.docx, .pdf, or .txt</strong> file, or{" "}
          <button
            type="button"
            className="underline text-slate-900"
            onClick={() => inputRef.current?.click()}
          >
            browse
          </button>
        </p>
        <p className="text-xs text-slate-400">
          .docx and PDF are read <strong>in your browser</strong> — nothing is
          uploaded. Scanned/image PDFs can't be read; paste those instead.
        </p>
        {extracting && (
          <p
            data-testid="extracting-indicator"
            className="mt-2 inline-flex items-center gap-2 text-xs font-medium text-slate-700"
          >
            <span className="h-3 w-3 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin" />
            Extracting text from {filename ?? "your file"}…
          </p>
        )}
        <p className="mt-2 text-xs text-slate-500">
          No document handy?{" "}
          <button
            type="button"
            className="underline font-medium text-indigo-700 hover:text-indigo-900"
            onClick={() => {
              setText(SAMPLE_DOC);
              setFilename(null);
              if (!name.trim()) setName(SAMPLE_DOC_NAME);
              setErr(null);
            }}
          >
            Try a sample NDA
          </button>
        </p>
        <input
          ref={inputRef}
          data-testid="file-input"
          type="file"
          accept=".docx,.pdf,.txt,.md,.rtf,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          className="hidden"
          onChange={(e: any) => {
            const f = e.target.files?.[0];
            if (f) void readFile(f);
          }}
        />
        {filename && (
          <p className="mt-2 text-xs font-medium text-slate-700">Attached: {filename}</p>
        )}
      </div>

      <label className="block text-sm font-medium mb-1">Agreement text</label>
      <textarea
        data-testid="document-text"
        className="w-full border border-slate-300 rounded px-3 py-2 text-sm min-h-[220px] font-mono leading-relaxed"
        placeholder="Paste clauses here…"
        value={text}
        // Clamp typed/pasted text to the same ceiling the file-attach path
        // enforces, so a huge paste can't slip past MAX_UPLOAD_CHARS.
        onChange={(e: any) => setText(e.target.value.slice(0, MAX_UPLOAD_CHARS))}
      />
      <div className="mt-1 text-xs text-slate-400">
        {text.length.toLocaleString()} characters
        {text.length > 14000 && " — long docs are truncated for the free model"}
      </div>

      <label className="mt-4 flex items-start gap-2.5 rounded border border-slate-200 bg-slate-50 px-3 py-2.5 cursor-pointer select-none">
        <input
          type="checkbox"
          data-testid="redact-toggle"
          checked={redact}
          onChange={(e: any) => setRedact(e.target.checked)}
          aria-label="Redact party names and sensitive details before sending to AI"
          className="mt-0.5 h-4 w-4 accent-slate-900"
        />
        <span className="text-sm text-slate-700">
          <span className="font-medium text-slate-900">
            Redact party names &amp; sensitive details before sending to AI.
          </span>{" "}
          Emails, amounts, dates and party names are replaced with placeholders
          before the text leaves your browser; real values are restored in the
          results you see.
        </span>
      </label>

      {err && <ErrorBox message={err} />}

      <div className="mt-6 flex justify-between gap-3">
        <GhostButton onClick={onBack}>Back</GhostButton>
        <PrimaryButton onClick={submit} disabled={text.trim().length < 40 || !name.trim()}>
          Continue — AI will ask about context
        </PrimaryButton>
      </div>
      <HelpInline brief={session.brief} />
    </Card>
  );
}

// ---------- Processing / eliciting spinners ----------

function ProcessingStep({
  name,
  mode,
}: {
  name: string;
  mode: "elicit" | "extract";
}) {
  return (
    <Card className="text-center py-12">
      <div className="inline-block h-8 w-8 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin mb-4" />
      <h2 className="text-lg font-semibold">
        {mode === "elicit" ? "Reading the agreement…" : "Drafting positions…"}
      </h2>
      <p className="text-sm text-slate-600 mt-2 max-w-md mx-auto">
        {mode === "elicit" ? (
          <>
            Detecting agreement type and preparing context questions (your side,
            audience, focus…) for <strong>{name || "your playbook"}</strong>.
          </>
        ) : (
          <>
            Proposing preferred / fallback / avoid language for{" "}
            <strong>{name || "your playbook"}</strong>. Usually 10–40s on the free
            model.
          </>
        )}
      </p>
    </Card>
  );
}


export { DocumentStep, ElicitStep, IntentStep, ProcessingStep };
