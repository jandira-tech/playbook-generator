/** @jsxImportSource https://esm.sh/react@18.2.0 */
import { containsRedactionMarkers } from "../shared/extract_redaction.ts";
import React, { useMemo, useState } from "https://esm.sh/react@18.2.0?deps=react@18.2.0";
import { INTENT_LABEL, positionChoices, riskForPosition } from "../shared/catalog.ts";
import { areLinked, moveRule, toggleLink } from "../shared/organize.ts";
import { visibleLinkedIds } from "../shared/review_session.ts";
import { buildRecord, callSubmit, effectiveRule, riskColor, selectedRules } from "./session.ts";
import { downloadDocx, downloadMarkdown, toMarkdown } from "./exporters.ts";
import { copyText } from "./clipboard.ts";
import { Card, Chip, ErrorBox, GhostButton, PrimaryButton } from "./ui.tsx";
import type {
  ClientSession,
  PlaybookRecord,
  PlaybookRule,
  RaiseMode,
  RiskLevel,
  RuleSelection,
  SubmitResponse,
} from "../shared/types.ts";

// ---------- Step 4: Review (elicitation) ----------

const ESCALATE_CHIPS = [
  "Legal",
  "Credit committee",
  "CFO / Treasury",
  "Business owner",
  "Privacy / Security",
  "No escalation needed",
];

function ReviewStep({
  session,
  onChange,
  onBack,
  onContinue,
}: {
  session: ClientSession;
  onChange: (patch: Partial<ClientSession>) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [filter, setFilter] = useState<"all" | RiskLevel | "customized">("all");

  const customizedIds = useMemo(() => {
    return new Set(Object.keys(session.edits));
  }, [session.edits]);

  const filtered = useMemo(() => {
    return session.rules.filter((r) => {
      const rule = effectiveRule(session, r);
      if (filter === "customized") return customizedIds.has(r.id);
      if (filter !== "all" && rule.risk !== filter) return false;
      return true;
    });
  }, [session, filter, customizedIds]);

  const selected = session.rules.filter((r) => session.selections[r.id] !== "skipped").length;
  const total = session.rules.length;
  const customizedCount = customizedIds.size;

  function toggle(id: string) {
    const cur: RuleSelection = session.selections[id] === "skipped" ? "selected" : "skipped";
    onChange({ selections: { ...session.selections, [id]: cur } });
  }

  function selectAll(sel: RuleSelection) {
    onChange({
      selections: Object.fromEntries(session.rules.map((r) => [r.id, sel])),
    });
  }

  // Drag-to-reorder (priority). Only enabled with no filter, so the visible
  // order equals session.rules order and moveRule targets the true index.
  const [dragId, setDragId] = useState<string | null>(null);
  const canReorder = filter === "all";

  function dropOnto(targetId: string) {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      return;
    }
    const toIndex = session.rules.findIndex((r) => r.id === targetId);
    onChange({ rules: moveRule(session.rules, dragId, toIndex) });
    setDragId(null);
  }

  // Rule linking (e.g. arbitration ↔ forum). Pick a source, then click a
  // partner to toggle the link. Links persist on the session.
  const [linkingId, setLinkingId] = useState<string | null>(null);

  function startLinking(id: string) {
    setLinkingId((cur) => (cur === id ? null : id));
  }

  function linkWith(id: string) {
    if (!linkingId || linkingId === id) return;
    onChange({ links: toggleLink(session.links, linkingId, id) });
  }

  /** Live-update a rule (elicitation). Stores override in edits unless equal to AI original. */
  function patchRule(id: string, next: PlaybookRule) {
    const original = session.rules.find((r) => r.id === id);
    if (!original) return;
    const edits = { ...session.edits };
    if (JSON.stringify(next) === JSON.stringify(original)) {
      delete edits[id];
    } else {
      edits[id] = next;
    }
    onChange({ edits });
  }

  function addBlank() {
    // crypto.randomUUID is unavailable outside secure contexts; fall back so the
    // "add topic" button never throws on http:// or older browsers.
    const rand = typeof crypto?.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
    const id = `custom_${rand}`;
    const rule: PlaybookRule = {
      id,
      topic: "New topic",
      preferred: "",
      alternates: [],
      avoid: "",
      risk: "yellow",
      sample_language: "",
      escalate_when: "Legal",
      source_quote: "",
      raise_mode: "either",
      confidence: 1,
      rationale: "Manually added by you",
    };
    onChange({
      rules: [...session.rules, rule],
      selections: { ...session.selections, [id]: "selected" },
      edits: { ...session.edits, [id]: rule },
    });
  }

  const topicById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of session.rules) {
      m[r.id] = effectiveRule(session, r).topic || "Untitled topic";
    }
    return m;
  }, [session.rules, session.edits]);

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-xl font-semibold mb-1">Customize positions</h2>
        <p className="text-sm text-slate-600 mb-3">
          For each topic, <strong>pick</strong> a preferred position from the AI’s
          alternatives (or write your own). Your choice is highlighted. Uncheck
          <strong> Include</strong> to drop a topic, <strong>drag ⠿</strong> to set
          priority, and <strong>Link</strong> related topics (e.g. arbitration ↔ forum).
        </p>

        {session.redact_before_send && containsRedactionMarkers(JSON.stringify({
          agreement_type: session.agreement_type,
          party_vocabulary: session.party_vocabulary,
          summary: session.summary,
          ai_notes: session.ai_notes,
          intent_suggestion_reason: session.intent_suggestion_reason,
          rules: session.rules.map((rule) => effectiveRule(session, rule)),
        })) && (
          <p role="status" className="mb-3 border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Some redaction markers remain in the AI draft. The model may have changed or invented a marker; compare the draft with your document before saving or exporting. Unmatched markers are shown as returned, not guessed.
          </p>
        )}
        {(session.agreement_type || session.party_vocabulary) && (
          <div className="flex flex-wrap gap-2 mb-3">
            {session.agreement_type && (
              <span className="text-xs font-medium px-2.5 py-1 rounded border border-slate-300 bg-white text-slate-800">
                Detected: {session.agreement_type}
              </span>
            )}
            {session.party_vocabulary && (
              <span className="text-xs font-medium px-2.5 py-1 rounded border border-slate-200 bg-slate-50 text-slate-600">
                Parties: {session.party_vocabulary}
              </span>
            )}
          </div>
        )}
        {session.summary && (
          <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 mb-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              AI summary
            </div>
            {session.summary}
          </div>
        )}
        {session.ai_notes && (
          <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 mb-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-800 mb-1">
              Notes for you
            </div>
            {session.ai_notes}
          </div>
        )}
        {session.intent_suggestion && session.intent_suggestion !== session.brief.intent && (
          <div className="rounded border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950 mb-3">
            <strong>Intent suggestion:</strong>{" "}
            {INTENT_LABEL[session.intent_suggestion] ?? session.intent_suggestion}
            {session.intent_suggestion_reason
              ? ` — ${session.intent_suggestion_reason}`
              : ""}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-slate-700">
            {selected} / {total} kept
          </span>
          {customizedCount > 0 && (
            <span className="font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded">
              {customizedCount} customized by you
            </span>
          )}
          <button type="button" className="underline text-slate-500" onClick={() => selectAll("selected")}>
            Keep all
          </button>
          <button type="button" className="underline text-slate-500" onClick={() => selectAll("skipped")}>
            Skip all
          </button>
          <span className="text-slate-300">|</span>
          {(["all", "green", "yellow", "red", "customized"] as const).map((f) => (
            <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "customized" ? "My edits" : f}
            </Chip>
          ))}
        </div>
        {!canReorder && (
          <p className="mt-2 text-[11px] text-slate-400">
            Reordering is available when the filter is set to “All”.
          </p>
        )}
      </Card>

      {linkingId && (
        <div className="flex items-center justify-between gap-3 rounded border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
          <span>
            Linking <strong>{topicById[linkingId] ?? "this rule"}</strong> — click{" "}
            <em>Link to…</em> on a related card.
          </span>
          <button
            type="button"
            className="underline shrink-0"
            onClick={() => setLinkingId(null)}
          >
            Done
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-500 text-center py-6">
            {filter === "customized"
              ? "You haven’t customized any position yet — pick a chip or write your own on a card below."
              : "No rules match this filter."}{" "}
            {filter !== "customized" && (
              <button type="button" className="underline" onClick={addBlank}>
                Add one manually
              </button>
            )}
          </p>
        </Card>
      ) : (
        filtered.map((r) => {
          const original = session.rules.find((x) => x.id === r.id) ?? r;
          const rule = effectiveRule(session, r);
          const skipped = session.selections[r.id] === "skipped";
          const customized = customizedIds.has(r.id);
          const priority = session.rules.findIndex((x) => x.id === r.id) + 1;
          const linkedTopics = visibleLinkedIds(
            session.links,
            r.id,
            session.rules,
            session.selections,
          ).map((id) => topicById[id]).filter(Boolean);
          const isLinkSource = linkingId === r.id;
          const linkedToSource = linkingId != null && linkingId !== r.id &&
            areLinked(session.links, linkingId, r.id);
          return (
            <ElicitRuleCard
              key={r.id}
              original={original}
              rule={rule}
              skipped={skipped}
              customized={customized}
              onToggle={() => toggle(r.id)}
              onPatch={(next) => patchRule(r.id, next)}
              priority={priority}
              canReorder={canReorder}
              isDragging={dragId === r.id}
              onDragStartRule={() => setDragId(r.id)}
              onDragEndRule={() => setDragId(null)}
              onDropRule={() => dropOnto(r.id)}
              linkedTopics={linkedTopics}
              linkingActive={linkingId != null}
              isLinkSource={isLinkSource}
              linkedToSource={linkedToSource}
              linkSourceTopic={linkingId != null ? topicById[linkingId] : ""}
              onStartLinking={() => startLinking(r.id)}
              onLinkWith={() => linkWith(r.id)}
            />
          );
        })
      )}

      <div className="flex flex-wrap justify-between gap-3 items-center">
        <div className="flex gap-2">
          <GhostButton onClick={onBack}>Back to document</GhostButton>
          <GhostButton onClick={addBlank}>+ Add topic</GhostButton>
        </div>
        <PrimaryButton onClick={onContinue} disabled={selected === 0}>
          Continue to confirm ({selected})
        </PrimaryButton>
      </div>
    </div>
  );
}

/**
 * Elicitation card: user always sees alternatives as chips, picks preferred,
 * can write custom, and sees a clear "Your choice" strip when customized.
 */
function ElicitRuleCard({
  original,
  rule,
  skipped,
  customized,
  onToggle,
  onPatch,
  priority,
  canReorder,
  isDragging,
  onDragStartRule,
  onDragEndRule,
  onDropRule,
  linkedTopics,
  linkingActive,
  isLinkSource,
  linkedToSource,
  linkSourceTopic,
  onStartLinking,
  onLinkWith,
}: {
  original: PlaybookRule;
  rule: PlaybookRule;
  skipped: boolean;
  customized: boolean;
  onToggle: () => void;
  onPatch: (r: PlaybookRule) => void;
  priority: number;
  canReorder: boolean;
  isDragging: boolean;
  onDragStartRule: () => void;
  onDragEndRule: () => void;
  onDropRule: () => void;
  linkedTopics: string[];
  linkingActive: boolean;
  isLinkSource: boolean;
  linkedToSource: boolean;
  linkSourceTopic: string;
  onStartLinking: () => void;
  onLinkWith: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [customOpen, setCustomOpen] = useState(
    () => rule.preferred.trim() !== "" && !positionChoices(original).includes(rule.preferred),
  );
  const [customText, setCustomText] = useState(() =>
    positionChoices(original).includes(rule.preferred) ? "" : rule.preferred,
  );

  const choices = useMemo(() => positionChoices(original), [original]);
  const selectedPreferred = rule.preferred;
  const pickedChip = choices.includes(selectedPreferred) ? selectedPreferred : null;
  const isCustomPreferred = !pickedChip && selectedPreferred.trim().length > 0;

  function choosePreferred(text: string) {
    // Promote choice to preferred; keep the remaining positions as alternates,
    // preserving each one's originally-extracted risk (not a flat yellow).
    const rest = choices.filter((c) => c !== text);
    const alternates = rest.map((t, i) => ({
      rank: i + 1,
      text: t,
      risk: riskForPosition(original, t),
    }));
    setCustomOpen(false);
    setCustomText("");
    onPatch({
      ...rule,
      preferred: text,
      alternates,
    });
  }

  function applyCustomPreferred() {
    const t = customText.trim();
    if (!t) return;
    const rest = choices.filter((c) => c !== t);
    onPatch({
      ...rule,
      preferred: t,
      alternates: rest.map((text, i) => ({
        rank: i + 1,
        text,
        risk: riskForPosition(original, text),
      })),
    });
  }

  function setRisk(risk: RiskLevel) {
    onPatch({ ...rule, risk });
  }

  function setRaise(raise_mode: RaiseMode) {
    onPatch({ ...rule, raise_mode });
  }

  function setEscalate(text: string) {
    onPatch({
      ...rule,
      escalate_when: text === "No escalation needed" ? "" : text,
    });
  }

  return (
    <div
      data-rule-card={rule.id}
      onDragOver={canReorder ? (e: React.DragEvent<HTMLDivElement>) => e.preventDefault() : undefined}
      onDrop={canReorder
        ? (e: React.DragEvent<HTMLDivElement>) => {
          e.preventDefault();
          onDropRule();
        }
        : undefined}
      className={isDragging ? "opacity-40" : ""}
    >
      <Card
        className={
          skipped
            ? "opacity-55 bg-slate-50 border-dashed"
            : customized
            ? "border-indigo-300 ring-1 ring-indigo-100"
            : ""
        }
      >
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div className="min-w-0 flex-1">
            {/* Reorder handle · priority · include checkbox */}
            <div className="flex items-center gap-2 mb-1.5">
              <span
                draggable={canReorder}
                onDragStart={canReorder ? onDragStartRule : undefined}
                // Fires on the source after ANY drag ends — including a cancel
                // (dropped outside a target) — so the card never stays faded.
                onDragEnd={canReorder ? onDragEndRule : undefined}
                title={canReorder
                  ? "Drag to reorder priority"
                  : "Clear the filter to reorder"}
                aria-label="Drag to reorder priority"
                className={"select-none text-base leading-none text-slate-400 " +
                  (canReorder
                    ? "cursor-grab active:cursor-grabbing"
                    : "cursor-not-allowed opacity-40")}
              >
                ⠿
              </span>
              <span
                className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200"
                title="Negotiation priority (drag to change)"
              >
                #{priority}
              </span>
              <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={!skipped}
                  onChange={onToggle}
                  aria-label={`Include ${rule.topic || "this rule"}`}
                  className="h-4 w-4 accent-slate-900"
                />
                Include
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-slate-900 text-base">
                {rule.topic || "Untitled topic"}
              </h3>
              <span
                className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${riskColor(rule.risk)}`}
              >
                {rule.risk}
              </span>
              {customized && (
                <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 border border-indigo-200">
                  Your edits
                </span>
              )}
              {skipped && (
                <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-200 text-slate-600">
                  Skipped
                </span>
              )}
            </div>
            {linkedTopics.length > 0 && (
              <p className="text-xs text-indigo-700 mt-1">
                🔗 Linked to: {linkedTopics.join(", ")}
              </p>
            )}
            {rule.rationale && (
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">{rule.rationale}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            {!linkingActive && (
              <button
                type="button"
                onClick={onStartLinking}
                className="text-[11px] font-semibold uppercase tracking-wider px-3 py-1.5 rounded border border-slate-300 text-slate-600 hover:border-indigo-400 hover:text-indigo-700"
              >
                Link
              </button>
            )}
            {isLinkSource && (
              <button
                type="button"
                onClick={onStartLinking}
                className="text-[11px] font-semibold uppercase tracking-wider px-3 py-1.5 rounded border border-indigo-500 bg-indigo-500 text-white"
              >
                Linking… cancel
              </button>
            )}
            {linkingActive && !isLinkSource && (
              <button
                type="button"
                onClick={onLinkWith}
                className={"text-[11px] font-semibold uppercase tracking-wider px-3 py-1.5 rounded border " +
                  (linkedToSource
                    ? "border-rose-300 text-rose-700 hover:bg-rose-50"
                    : "border-indigo-400 text-indigo-700 hover:bg-indigo-50")}
              >
                {linkedToSource
                  ? `Unlink from "${linkSourceTopic.slice(0, 24)}"`
                  : `Link to "${linkSourceTopic.slice(0, 24)}"`}
              </button>
            )}
          </div>
        </div>

      {!skipped && (
        <>
          {/* YOUR CHOICE strip — always visible so customization is obvious */}
          <div
            className={
              "rounded-lg border px-3 py-2.5 mb-4 " +
              (customized || isCustomPreferred
                ? "border-indigo-300 bg-indigo-50"
                : "border-emerald-200 bg-emerald-50/60")
            }
          >
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-1 text-slate-600">
              {customized || isCustomPreferred ? "Your preferred position" : "AI recommended (still yours until you change it)"}
            </div>
            <div className="text-sm font-medium text-slate-900 whitespace-pre-wrap">
              {selectedPreferred || (
                <span className="text-slate-400 font-normal">Pick a chip below or write your own…</span>
              )}
            </div>
          </div>

          {/* Elicitation: preferred alternatives as chips */}
          <div className="mb-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
              Pick a preferred position
            </div>
            <div className="space-y-2">
              {choices.map((c, i) => {
                const active = pickedChip === c;
                return (
                  <button
                    key={i + c.slice(0, 40)}
                    type="button"
                    onClick={() => choosePreferred(c)}
                    className={
                      "w-full text-left rounded-lg border px-3 py-2.5 text-sm transition " +
                      (active
                        ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                        : "border-slate-200 bg-white hover:border-slate-400 text-slate-800")
                    }
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className={
                          "mt-0.5 shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded " +
                          (active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500")
                        }
                      >
                        {i === 0 ? "AI #1" : `Alt ${i}`}
                      </span>
                      <span className="leading-snug">{c}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-2">
              {!customOpen ? (
                <button
                  type="button"
                  className="text-xs text-indigo-700 hover:text-indigo-900 underline font-medium"
                  onClick={() => {
                    setCustomOpen(true);
                    setCustomText(isCustomPreferred ? selectedPreferred : "");
                  }}
                >
                  + Write my own preferred position
                </button>
              ) : (
                <div className="mt-2 space-y-2">
                  <textarea
                    className="w-full border-2 border-dashed border-indigo-300 focus:border-indigo-500 rounded px-3 py-2 text-sm min-h-[72px] bg-indigo-50/30"
                    placeholder="Your preferred negotiating position…"
                    value={customText}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setCustomText(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <PrimaryButton onClick={applyCustomPreferred} disabled={!customText.trim()}>
                      Use my wording
                    </PrimaryButton>
                    <GhostButton
                      onClick={() => {
                        setCustomOpen(false);
                        setCustomText("");
                      }}
                    >
                      Cancel
                    </GhostButton>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Risk elicitation */}
          <div className="mb-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Risk (red / yellow / green)
            </div>
            <div className="flex flex-wrap gap-2">
              {(["green", "yellow", "red"] as RiskLevel[]).map((r) => (
                <Chip key={r} active={rule.risk === r} onClick={() => setRisk(r)}>
                  {r === "green" ? "Green — preferred" : r === "yellow" ? "Yellow — review" : "Red — escalate"}
                </Chip>
              ))}
            </div>
          </div>

          {/* Raise mode */}
          <div className="mb-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Raise proactively or only react?
            </div>
            <div className="flex flex-wrap gap-2">
              {([
                ["proactive", "Proactive"],
                ["reactive", "Reactive only"],
                ["either", "Either"],
              ] as [RaiseMode, string][]).map(([id, label]) => (
                <Chip key={id} active={rule.raise_mode === id} onClick={() => setRaise(id)}>
                  {label}
                </Chip>
              ))}
            </div>
          </div>

          {/* Escalate */}
          <div className="mb-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Escalate deviations to
            </div>
            <div className="flex flex-wrap gap-2">
              {ESCALATE_CHIPS.map((c) => {
                const active =
                  (c === "No escalation needed" && !rule.escalate_when) ||
                  rule.escalate_when === c;
                return (
                  <Chip key={c} active={active} onClick={() => setEscalate(c)}>
                    {c}
                  </Chip>
                );
              })}
            </div>
            {rule.escalate_when && !ESCALATE_CHIPS.includes(rule.escalate_when) && (
              <p className="text-xs text-slate-600 mt-1">Custom: {rule.escalate_when}</p>
            )}
            <input
              className="mt-2 w-full border border-dashed border-slate-300 rounded px-2 py-1.5 text-xs bg-slate-50"
              placeholder="Or type a custom escalate-to (e.g. GC + Credit)"
              value={ESCALATE_CHIPS.includes(rule.escalate_when) || !rule.escalate_when
                ? ""
                : rule.escalate_when}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onPatch({ ...rule, escalate_when: e.target.value })
              }
            />
          </div>

          {/* Avoid — editable */}
          <div className="mb-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-rose-700 mb-1">
              Positions to avoid (NO-GO)
            </div>
            <textarea
              className="w-full border border-rose-200 rounded px-2 py-1.5 text-sm min-h-[52px] bg-rose-50/40 text-rose-950"
              placeholder="What we refuse…"
              value={rule.avoid}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onPatch({ ...rule, avoid: e.target.value })}
            />
          </div>

          {/* Fallbacks left after pick */}
          {rule.alternates.length > 0 && (
            <div className="mb-3 rounded border border-slate-100 bg-slate-50 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Remaining fallbacks (if preferred is rejected in negotiation)
              </div>
              <ol className="list-decimal list-inside text-xs text-slate-600 space-y-0.5">
                {rule.alternates.map((a) => (
                  <li key={a.rank + a.text.slice(0, 24)}>{a.text}</li>
                ))}
              </ol>
            </div>
          )}

          {/* Details */}
          <button
            type="button"
            className="text-xs text-slate-500 underline"
            onClick={() => setShowDetails((v) => !v)}
          >
            {showDetails ? "Hide source & sample" : "Show source & sample language"}
          </button>
          {showDetails && (
            <div className="mt-2 space-y-2 text-xs text-slate-600">
              {rule.source_quote && (
                <div>
                  <span className="font-semibold text-slate-500">Source: </span>
                  {rule.source_quote}
                </div>
              )}
              <div>
                <span className="font-semibold text-slate-500">Sample language: </span>
                <textarea
                  className="mt-1 w-full border rounded px-2 py-1.5 font-mono text-xs min-h-[48px]"
                  value={rule.sample_language}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    onPatch({ ...rule, sample_language: e.target.value })
                  }
                  placeholder="Optional clause language…"
                />
              </div>
              <div>
                <span className="font-semibold text-slate-500">Topic name: </span>
                <input
                  className="mt-1 w-full border rounded px-2 py-1 text-sm"
                  value={rule.topic}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => onPatch({ ...rule, topic: e.target.value })}
                />
              </div>
            </div>
          )}
        </>
      )}
      </Card>
    </div>
  );
}

// ---------- Step 5: Confirm ----------

function ConfirmStep({
  session,
  onChange,
  onBack,
  onSaved,
}: {
  session: ClientSession;
  onChange: (patch: Partial<ClientSession>) => void;
  onBack: () => void;
  onSaved: (res: SubmitResponse) => void;
}) {
  const rules = selectedRules(session);
  const [askingSure, setAskingSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byRisk = {
    green: rules.filter((r) => r.risk === "green").length,
    yellow: rules.filter((r) => r.risk === "yellow").length,
    red: rules.filter((r) => r.risk === "red").length,
  };

  async function reallySave() {
    setBusy(true);
    setError(null);
    try {
      const res = await callSubmit(buildRecord(session), session.family_id);
      onSaved(res);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : String(e)));
      setAskingSure(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-1">
        Final check
      </div>
      <h2 className="text-2xl font-semibold mb-2">Confirm this playbook</h2>
      <p className="text-sm text-slate-600 mb-5">
        Nothing is saved until you confirm. What you see here is what will be stored.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <Stat label="Name" value={session.brief.name || "—"} />
        <Stat
          label="Agreement"
          value={session.agreement_type || session.brief.contract_type || "—"}
        />
        <Stat label="Rules kept" value={String(rules.length)} />
        <Stat
          label="Customized"
          value={String(Object.keys(session.edits).length)}
        />
      </div>
      <p className="text-xs text-slate-500 mb-4">
        RYG: {byRisk.green} green · {byRisk.yellow} yellow · {byRisk.red} red
        {session.party_vocabulary ? ` · Parties: ${session.party_vocabulary}` : ""}
      </p>

      <div className="max-h-[360px] overflow-y-auto border border-slate-200 rounded bg-slate-50 p-3 mb-4">
        {rules.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-8">No rules selected.</p>
        ) : (
          <ul className="space-y-3 m-0 p-0 list-none">
            {rules.map((r) => {
              const wasEdited = !!session.edits[r.id];
              return (
                <li key={r.id} className="text-sm flex gap-2 items-start">
                  <span
                    className={`mt-0.5 shrink-0 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${riskColor(r.risk)}`}
                  >
                    {r.risk[0]}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900">{r.topic}</span>
                      {wasEdited && (
                        <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800">
                          Your edit
                        </span>
                      )}
                    </div>
                    <div className="text-slate-700 text-xs mt-0.5 whitespace-pre-wrap">
                      {r.preferred}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {session.family_id && (
        <div className="mb-3 rounded border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          Saving will create <strong>version {(session.saved_version ?? 0) + 1}</strong>{" "}
          of this playbook lineage.
        </div>
      )}

      <label className="mb-4 flex items-start gap-2.5 rounded border border-slate-200 bg-slate-50 px-3 py-2.5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={session.vault_only}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ vault_only: e.target.checked })}
          aria-label="Leave out of the shared library list"
          className="mt-0.5 h-4 w-4 accent-slate-900"
        />
        <span className="text-sm text-slate-700">
          <span className="font-medium text-slate-900">Leave out of the shared library list.</span>{" "}
          It is still stored with the other playbooks and readable by whoever holds the admin token.
        </span>
      </label>

      <label className="mb-4 flex items-start gap-2.5 rounded border border-slate-200 bg-slate-50 px-3 py-2.5 cursor-pointer select-none">
        <input
          type="checkbox"
          data-testid="discard-source-toggle"
          checked={session.discard_source}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ discard_source: e.target.checked })}
          aria-label="Save positions only, discard document text"
          className="mt-0.5 h-4 w-4 accent-slate-900"
        />
        <span className="text-sm text-slate-700">
          <span className="font-medium text-slate-900">
            Save positions only (discard document text).
          </span>{" "}
          By default a short excerpt of the document is stored with the playbook.
          Check this to store <strong>no</strong> document text at all.
        </span>
      </label>

      {error && <ErrorBox message={error} />}

      <div className="mt-6 flex items-center justify-between gap-3">
        <GhostButton onClick={onBack} disabled={busy}>
          Back to review
        </GhostButton>
        {askingSure ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-700">Are you sure?</span>
            <GhostButton onClick={() => setAskingSure(false)} disabled={busy}>
              Not yet
            </GhostButton>
            <PrimaryButton onClick={reallySave} disabled={busy || rules.length === 0}>
              {busy ? "Saving…" : "Yes, save playbook"}
            </PrimaryButton>
          </div>
        ) : (
          <PrimaryButton onClick={() => setAskingSure(true)} disabled={rules.length === 0}>
            Save playbook
          </PrimaryButton>
        )}
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="text-sm font-medium text-slate-900 mt-0.5 break-words">{value}</div>
    </div>
  );
}

// ---------- Saved ----------

function SavedStep({
  id,
  version,
  record,
  onNewVersion,
  onAgain,
  onOpenLibrary,
}: {
  id: number;
  version: number | null;
  record: PlaybookRecord;
  onNewVersion: () => void;
  onAgain: () => void;
  onOpenLibrary?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const ruleCount = record.rules.length;

  async function copyMarkdown() {
    if (await copyText(toMarkdown(record))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <Card className="text-center py-10">
      <div className="text-emerald-600 text-sm font-semibold uppercase tracking-wider mb-2">
        {id === 0 ? "Demo" : `Saved${version ? ` · version ${version}` : ""}`}
      </div>
      <h2 className="text-2xl font-semibold mb-2">{record.name}</h2>
      <p className="text-sm text-slate-600 mb-1">
        {id === 0 ? "Not saved" : `Playbook #${id}`}
        {id !== 0 && version ? ` · v${version}` : ""} · {ruleCount} rule{ruleCount === 1 ? "" : "s"}
        {record.vault_only ? " · not listed" : ""}
      </p>
      <p className="text-xs text-slate-400 mb-6">
        {id === 0
          ? "Demo: nothing was stored. Download the playbook below to keep it."
          : "Stored in this val’s SQLite; reading it back needs the admin token."}
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <GhostButton onClick={() => downloadMarkdown(record)}>Download .md</GhostButton>
        <GhostButton onClick={() => downloadDocx(record)}>Download .docx</GhostButton>
        <GhostButton onClick={copyMarkdown}>{copied ? "Copied ✓" : "Copy Markdown"}</GhostButton>
        <GhostButton onClick={onNewVersion}>Edit &amp; save new version</GhostButton>
        {onOpenLibrary && (
          <GhostButton onClick={onOpenLibrary}>My playbooks</GhostButton>
        )}
        <PrimaryButton onClick={onAgain}>Create another</PrimaryButton>
      </div>
    </Card>
  );
}


export { ConfirmStep, ReviewStep, SavedStep };
