/** @jsxImportSource https://esm.sh/react@18.2.0 */
import React, { useState } from "https://esm.sh/react@18.2.0?deps=react@18.2.0";
import { callHelp } from "./session.ts";
import type { PlaybookBrief, Stage } from "../shared/types.ts";

function Shell({
  stage,
  children,
  onReset,
}: {
  stage: Stage;
  children: React.ReactNode;
  onReset: () => void;
}) {
  const steps: { id: Stage; label: string }[] = [
    { id: "intent", label: "1. Intent" },
    { id: "document", label: "2. Document" },
    { id: "elicit", label: "3. AI context" },
    { id: "review", label: "4. Positions" },
    { id: "confirm", label: "5. Confirm" },
  ];
  const order: Stage[] = [
    "intent",
    "document",
    "eliciting",
    "elicit",
    "processing",
    "review",
    "confirm",
    "saved",
  ];
  const idx = order.indexOf(
    stage === "error" ? "document" : stage === "eliciting" ? "elicit" : stage,
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-1">
            Contracts playbook
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            From agreement → positions
          </h1>
          <p className="text-slate-600 mt-2 text-sm leading-relaxed max-w-xl">
            Paste any agreement. The AI first elicits your side and context
            (with alternatives you can customize), then drafts preferred /
            fallback / avoid positions. You confirm before save.
          </p>
        </div>
        {stage !== "intent" && stage !== "saved" && (
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-slate-500 hover:text-slate-900 underline shrink-0 mt-1"
          >
            Start over
          </button>
        )}
      </header>

      {stage !== "saved" && stage !== "error" && (
        <nav className="flex flex-wrap gap-2 mb-6" aria-label="Progress">
          {steps.map((s) => {
            const sIdx = order.indexOf(s.id === "elicit" ? "elicit" : s.id);
            const active =
              s.id === stage ||
              (stage === "processing" && s.id === "elicit") ||
              (stage === "eliciting" && s.id === "elicit");
            const done = sIdx < idx && s.id !== "review";
            return (
              <span
                key={s.id}
                className={
                  "text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded border " +
                  (active
                    ? "bg-slate-900 text-white border-slate-900"
                    : done
                    ? "bg-white text-slate-700 border-slate-300"
                    : "bg-transparent text-slate-400 border-slate-200")
                }
              >
                {s.label}
              </span>
            );
          })}
        </nav>
      )}

      {children}
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white border border-slate-200 shadow-sm rounded-lg p-6 sm:p-8 ${className}`}>
      {children}
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold uppercase tracking-[0.14em] px-5 py-2.5 rounded"
    >
      {children}
    </button>
  );
}

function GhostButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="border border-slate-300 hover:border-slate-500 text-slate-700 text-xs font-semibold uppercase tracking-[0.14em] px-4 py-2.5 rounded disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="mt-4 rounded border border-rose-300 bg-rose-50 text-rose-900 text-sm px-3 py-2">
      {message}
    </div>
  );
}

function HelpInline({ brief }: { brief: Partial<PlaybookBrief> }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [ans, setAns] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function ask() {
    if (!q.trim()) return;
    setBusy(true);
    setAns(null);
    try {
      setAns(await callHelp(brief, q.trim()));
    } catch (e: any) {
      setAns(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 border-t border-slate-100 pt-4">
      <button
        type="button"
        className="text-xs text-slate-500 hover:text-slate-900 underline"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide help" : "Stuck? Ask what this means"}
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          <input
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
            placeholder='e.g. "What is a fallback position?"'
            value={q}
            onChange={(e: any) => setQ(e.target.value)}
            onKeyDown={(e: any) => {
              if (e.key === "Enter") {
                e.preventDefault();
                ask();
              }
            }}
          />
          <PrimaryButton onClick={ask} disabled={busy || !q.trim()}>
            {busy ? "Thinking…" : "Explain"}
          </PrimaryButton>
          {ans && (
            <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded p-3 leading-relaxed">
              {ans}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "text-xs px-3 py-1.5 rounded-full border transition " +
        (active
          ? "bg-slate-900 text-white border-slate-900"
          : "bg-white text-slate-700 border-slate-300 hover:border-slate-500")
      }
    >
      {children}
    </button>
  );
}

export { Card, Chip, ErrorBox, GhostButton, HelpInline, PrimaryButton, Shell };
